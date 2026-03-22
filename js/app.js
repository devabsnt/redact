window.BLKOUT = window.BLKOUT || {};

BLKOUT.App = (function () {
  // ── State ──
  var state = {
    docType: null,    // 'image' | 'pdf'
    mode: 'auto',     // 'auto' | 'manual'
    style: 'pixelate', // 'pixelate' | 'blackbox'
    currentPage: 0,
    redactions: {}    // { pageIndex: [ {type, rect, style} ] }
  };

  // Manual mode drag state
  var drag = { active: false, startX: 0, startY: 0, canvas: null, pageIndex: 0 };

  // Pad a bounding box so redactions fully cover text
  var PAD = 6;
  function padRect(bbox) {
    return {
      x: bbox.x - PAD,
      y: bbox.y - PAD,
      w: bbox.w + PAD * 2,
      h: bbox.h + PAD * 2
    };
  }

  // ── DOM refs ──
  var dom = {};

  // ── Init ──
  function init() {
    dom.fileInput = document.getElementById('fileInput');
    dom.dropzone = document.getElementById('dropzone');
    dom.viewer = document.getElementById('viewer');
    dom.pagesContainer = document.getElementById('pagesContainer');
    dom.sidebar = document.getElementById('sidebar');
    dom.thumbnailList = document.getElementById('thumbnailList');
    dom.findBar = document.getElementById('findBar');
    dom.canvasArea = document.getElementById('canvasArea');
    dom.contextPopup = document.getElementById('contextPopup');
    dom.selectionRect = document.getElementById('selectionRect');
    dom.analysisOverlay = document.getElementById('analysisOverlay');
    dom.analysisText = document.getElementById('analysisText');
    dom.progressOverlay = document.getElementById('progressOverlay');
    dom.progressText = document.getElementById('progressText');
    dom.toast = document.getElementById('toast');

    bindToolbar();
    bindFileInput();
    bindDragDrop();
    bindPaste();
    bindCanvasEvents();
    bindPopup();
    bindKeyboard();
    BLKOUT.FindRedact.init();

    dom.canvasArea.classList.add('mode-auto');
  }

  // ── Toolbar ──
  function bindToolbar() {
    document.getElementById('uploadBtn').addEventListener('click', function () {
      dom.fileInput.click();
    });
    document.getElementById('dropzoneUploadBtn').addEventListener('click', function () {
      dom.fileInput.click();
    });
    document.getElementById('undoBtn').addEventListener('click', doUndo);
    document.getElementById('redoBtn').addEventListener('click', doRedo);
    document.getElementById('exportBtn').addEventListener('click', doExport);

    // Mode toggle
    document.getElementById('modeToggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      var mode = btn.dataset.mode;
      if (!mode || mode === state.mode) return;
      state.mode = mode;
      this.querySelectorAll('.toggle-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      dom.canvasArea.className = 'canvas-area mode-' + mode;
      hidePopup();
    });

    // Style toggle
    document.getElementById('styleToggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      var style = btn.dataset.style;
      if (!style || style === state.style) return;
      state.style = style;
      this.querySelectorAll('.toggle-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  }

  // ── File Input ──
  function bindFileInput() {
    dom.fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
      }
      e.target.value = '';
    });
  }

  // ── Drag & Drop ──
  function bindDragDrop() {
    var dz = dom.dropzone;
    var ca = dom.canvasArea;

    ['dragenter', 'dragover'].forEach(function (evt) {
      ca.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (dz) dz.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(function (evt) {
      ca.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (dz) dz.classList.remove('drag-over');
      });
    });

    ca.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) handleFile(files[0]);
    });
  }

  // ── Paste ──
  function bindPaste() {
    document.addEventListener('paste', function (e) {
      // Don't intercept if focused on text input
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;

      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          var blob = items[i].getAsFile();
          if (blob) handleFile(blob);
          return;
        }
      }
    });
  }

  // ── Handle File ──
  async function handleFile(file) {
    var name = file.name || '';
    var type = file.type || '';
    var isPDF = type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
    var isImage = type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name);

    if (!isPDF && !isImage) {
      showToast('Unsupported file type');
      return;
    }

    resetState();

    if (isPDF) {
      state.docType = 'pdf';
      await loadPDF(file);
    } else {
      state.docType = 'image';
      await loadImage(file);
    }
  }

  async function loadImage(file) {
    showAnalysis('Loading image...');
    try {
      if (file instanceof Blob && !file.name) {
        // Pasted image — read as data URL
        var reader = new FileReader();
        var dataURL = await new Promise(function (res, rej) {
          reader.onload = function (e) { res(e.target.result); };
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        await BLKOUT.ImageHandler.loadFromDataURL(dataURL, 'pasted-image.png');
      } else {
        await BLKOUT.ImageHandler.load(file);
      }

      dom.dropzone.hidden = true;
      dom.viewer.hidden = false;
      dom.findBar.hidden = false;
      document.getElementById('exportBtn').disabled = false;

      BLKOUT.ImageHandler.createCanvas(dom.pagesContainer);
      state.redactions[0] = [];

      BLKOUT.Undo.init(false);

      // Run OCR for text detection
      hideAnalysis();
      showAnalysis('Analyzing text...');
      try {
        await BLKOUT.OCR.init();
        var items = await BLKOUT.Detection.runOCR(0, BLKOUT.ImageHandler.getCanvas());
        hideAnalysis();
        if (items.length) {
          showToast('Detected ' + items.length + ' text elements');
        }
      } catch (e) {
        console.warn('OCR failed:', e);
        hideAnalysis();
      }

      // Try face detection in background
      tryFaceDetection(0, BLKOUT.ImageHandler.getCanvas());

    } catch (e) {
      hideAnalysis();
      showToast('Failed to load image');
      console.error(e);
    }
  }

  async function loadPDF(file) {
    showAnalysis('Loading PDF...');
    try {
      await BLKOUT.PDFHandler.load(file);

      dom.dropzone.hidden = true;
      dom.viewer.hidden = false;
      dom.findBar.hidden = false;
      document.getElementById('exportBtn').disabled = false;

      var pageCount = BLKOUT.PDFHandler.getPageCount();
      for (var i = 0; i < pageCount; i++) {
        state.redactions[i] = [];
      }

      BLKOUT.Undo.init(true);

      BLKOUT.PDFHandler.setupViewer(dom.pagesContainer);

      // Show sidebar for multi-page PDFs
      if (pageCount > 1) {
        dom.sidebar.hidden = false;
        BLKOUT.PDFHandler.generateThumbnails(dom.thumbnailList);
      }

      // Store PDF.js text items in detection system
      var allText = BLKOUT.PDFHandler.getAllTextItems();
      var totalItems = 0;
      allText.forEach(function (pageData) {
        BLKOUT.Detection.setItems(pageData.pageIndex, pageData.items);
        totalItems += pageData.items.length;
      });

      hideAnalysis();

      if (totalItems > 0) {
        showToast(totalItems + ' text elements detected across ' + pageCount + ' pages');
      } else {
        // Scanned PDF — need OCR
        showToast('No selectable text found. OCR will run on visible pages.');
      }

    } catch (e) {
      hideAnalysis();
      showToast('Failed to load PDF');
      console.error(e);
    }
  }

  async function tryFaceDetection(pageIndex, canvas) {
    try {
      var faces = await BLKOUT.Detection.detectFaces(canvas);
      if (faces.length) {
        var existing = BLKOUT.Detection.getItems(pageIndex);
        BLKOUT.Detection.setItems(pageIndex, existing.concat(faces));
      }
    } catch (e) {
      // Face detection is optional
    }
  }

  // ── Canvas Events ──
  function bindCanvasEvents() {
    dom.canvasArea.addEventListener('mousedown', onPointerDown);
    dom.canvasArea.addEventListener('mousemove', onPointerMove);
    dom.canvasArea.addEventListener('mouseup', onPointerUp);

    // Touch support
    dom.canvasArea.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        var touch = e.touches[0];
        onPointerDown({ clientX: touch.clientX, clientY: touch.clientY, target: touch.target, preventDefault: function () { e.preventDefault(); } });
      }
    }, { passive: false });
    dom.canvasArea.addEventListener('touchend', function (e) {
      if (e.changedTouches.length === 1) {
        var touch = e.changedTouches[0];
        onPointerUp({ clientX: touch.clientX, clientY: touch.clientY, target: touch.target });
      }
    });
  }

  function getCanvasFromEvent(e) {
    var target = e.target;
    if (target.classList.contains('redact-canvas')) return target;
    var wrapper = target.closest('.page-wrapper');
    if (wrapper) return wrapper.querySelector('.redact-canvas');
    return null;
  }

  function getPageIndexFromEvent(e) {
    var wrapper = e.target.closest('.page-wrapper');
    if (wrapper) return parseInt(wrapper.dataset.pageIndex) || 0;
    return 0;
  }

  function canvasCoords(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width;
    var sy = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy
    };
  }

  function onPointerDown(e) {
    var canvas = getCanvasFromEvent(e);
    if (!canvas) return;

    hidePopup();

    if (state.mode === 'manual') {
      e.preventDefault && e.preventDefault();
      var pageIndex = getPageIndexFromEvent(e);
      var coords = canvasCoords(canvas, e.clientX, e.clientY);
      drag.active = true;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.canvasStartX = coords.x;
      drag.canvasStartY = coords.y;
      drag.canvas = canvas;
      drag.pageIndex = pageIndex;
      dom.selectionRect.hidden = false;
      updateSelectionRect(e.clientX, e.clientY);
    }
  }

  function onPointerMove(e) {
    if (!drag.active) return;
    updateSelectionRect(e.clientX, e.clientY);
  }

  function updateSelectionRect(clientX, clientY) {
    var x1 = Math.min(drag.startX, clientX);
    var y1 = Math.min(drag.startY, clientY);
    var x2 = Math.max(drag.startX, clientX);
    var y2 = Math.max(drag.startY, clientY);
    dom.selectionRect.style.left = x1 + 'px';
    dom.selectionRect.style.top = y1 + 'px';
    dom.selectionRect.style.width = (x2 - x1) + 'px';
    dom.selectionRect.style.height = (y2 - y1) + 'px';
  }

  function onPointerUp(e) {
    if (state.mode === 'manual' && drag.active) {
      drag.active = false;
      dom.selectionRect.hidden = true;

      var canvas = drag.canvas;
      var pageIndex = drag.pageIndex;
      var end = canvasCoords(canvas, e.clientX, e.clientY);

      var x = Math.min(drag.canvasStartX, end.x);
      var y = Math.min(drag.canvasStartY, end.y);
      var w = Math.abs(end.x - drag.canvasStartX);
      var h = Math.abs(end.y - drag.canvasStartY);

      // Minimum size check
      if (w < 4 && h < 4) return;

      BLKOUT.Undo.pushState(pageIndex, getRedactions(pageIndex));
      addRedaction(pageIndex, { type: 'box', rect: { x: x, y: y, w: w, h: h }, style: state.style });
      redraw(pageIndex);
      return;
    }

    if (state.mode === 'auto') {
      var canvas = getCanvasFromEvent(e);
      if (!canvas) return;
      var pageIndex = getPageIndexFromEvent(e);
      var coords = canvasCoords(canvas, e.clientX, e.clientY);
      var hit = BLKOUT.Detection.hitTest(pageIndex, coords.x, coords.y);

      if (hit) {
        showPopup(e.clientX, e.clientY, pageIndex, hit);
      }
    }
  }

  // ── Context Popup ──
  function bindPopup() {
    document.getElementById('popupCancel').addEventListener('click', hidePopup);
    document.addEventListener('click', function (e) {
      if (!dom.contextPopup.hidden && !dom.contextPopup.contains(e.target)) {
        if (Date.now() - popupState.openedAt < 300) return;
        hidePopup();
      }
    });
  }

  var popupState = { pageIndex: 0, item: null, openedAt: 0 };

  function showPopup(clientX, clientY, pageIndex, item) {
    popupState.pageIndex = pageIndex;
    popupState.item = item;
    popupState.openedAt = Date.now();

    var popup = dom.contextPopup;
    var wordEl = document.getElementById('popupWord');
    var countEl = document.getElementById('popupCount');
    var redactAllBtn = document.getElementById('redactAllWord');
    var redactSimilarBtn = document.getElementById('redactSimilar');

    var isFace = item.source === 'face';

    if (isFace) {
      wordEl.textContent = 'face';
      var faceCount = BLKOUT.Detection.getItems(pageIndex).filter(function (i) { return i.source === 'face'; }).length;
      countEl.textContent = '(' + faceCount + ' found)';
      redactAllBtn.style.display = faceCount > 1 ? '' : 'none';
      redactSimilarBtn.style.display = 'none';
    } else {
      var word = item.text;
      wordEl.textContent = word.length > 20 ? word.substring(0, 20) + '...' : word;
      var globalCount = BLKOUT.Detection.countGlobal(word);
      countEl.textContent = '(' + globalCount + ' found)';
      redactAllBtn.style.display = globalCount > 1 ? '' : 'none';

      var similar = BLKOUT.Detection.findSimilar(pageIndex, item);
      redactSimilarBtn.style.display = similar.length > 0 ? '' : 'none';
    }

    // Position popup
    popup.hidden = false;
    var pw = popup.offsetWidth;
    var ph = popup.offsetHeight;
    var left = Math.min(clientX + 8, window.innerWidth - pw - 12);
    var top = Math.min(clientY + 8, window.innerHeight - ph - 12);
    popup.style.left = Math.max(4, left) + 'px';
    popup.style.top = Math.max(4, top) + 'px';

    // Bind actions (replace listeners to avoid stacking)
    replaceClickHandler('redactThis', function () {
      hidePopup();
      BLKOUT.Undo.pushState(popupState.pageIndex, getRedactions(popupState.pageIndex));
      addRedaction(popupState.pageIndex, {
        type: 'box',
        rect: padRect(popupState.item.bbox),
        style: state.style
      });
      redraw(popupState.pageIndex);
    });

    replaceClickHandler('redactAllWord', function () {
      hidePopup();
      var isFace = popupState.item.source === 'face';
      if (isFace) {
        redactAllFaces(popupState.pageIndex);
      } else {
        redactAllInstances(popupState.item.text);
      }
    });

    replaceClickHandler('redactSimilar', function () {
      hidePopup();
      redactSimilarItems(popupState.pageIndex, popupState.item);
    });
  }

  function hidePopup() {
    dom.contextPopup.hidden = true;
  }

  function replaceClickHandler(id, handler) {
    var el = document.getElementById(id);
    var clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', handler);
  }

  // ── Redaction Actions ──
  function redactAllInstances(text) {
    var matches = BLKOUT.Detection.findAllByTextGlobal(text);
    var byPage = {};
    matches.forEach(function (m) {
      if (!byPage[m.pageIndex]) byPage[m.pageIndex] = [];
      byPage[m.pageIndex].push(m.item);
    });

    Object.keys(byPage).forEach(function (key) {
      var pi = parseInt(key);
      BLKOUT.Undo.pushState(pi, getRedactions(pi));
      byPage[key].forEach(function (item) {
        addRedaction(pi, { type: 'box', rect: padRect(item.bbox), style: state.style });
      });
      redraw(pi);
    });

    showToast('Redacted ' + matches.length + ' instances of "' + text + '"');
  }

  function redactAllFaces(pageIndex) {
    var faces = BLKOUT.Detection.getItems(pageIndex).filter(function (i) { return i.source === 'face'; });
    if (!faces.length) return;

    BLKOUT.Undo.pushState(pageIndex, getRedactions(pageIndex));
    faces.forEach(function (face) {
      addRedaction(pageIndex, { type: 'box', rect: padRect(face.bbox), style: state.style });
    });
    redraw(pageIndex);
    showToast('Redacted ' + faces.length + ' faces');
  }

  function redactSimilarItems(pageIndex, targetItem) {
    var similar = BLKOUT.Detection.findSimilar(pageIndex, targetItem);
    similar.push(targetItem);

    BLKOUT.Undo.pushState(pageIndex, getRedactions(pageIndex));
    similar.forEach(function (item) {
      addRedaction(pageIndex, { type: 'box', rect: padRect(item.bbox), style: state.style });
    });
    redraw(pageIndex);
    showToast('Redacted ' + similar.length + ' similar elements');
  }

  // ── Undo / Redo ──
  function doUndo() {
    var page = state.currentPage;
    var prev = BLKOUT.Undo.undo(page);
    if (prev !== null) {
      state.redactions[page] = prev;
      redraw(page);
    }
  }

  function doRedo() {
    var page = state.currentPage;
    var next = BLKOUT.Undo.redo(page);
    if (next !== null) {
      state.redactions[page] = next;
      redraw(page);
    }
  }

  // ── Export ──
  async function doExport() {
    if (state.docType === 'image') {
      var dataURL = BLKOUT.ImageHandler.exportImage(state.redactions[0] || []);
      var baseName = BLKOUT.ImageHandler.getFileName().replace(/\.[^.]+$/, '');
      downloadDataURL(dataURL, 'redacted-' + baseName + '-' + timestamp() + '.png');
      showToast('Image exported');
    } else if (state.docType === 'pdf') {
      showProgress('Preparing export...');
      try {
        var pdf = await BLKOUT.PDFHandler.exportPDF(state.redactions, function (msg) {
          dom.progressText.textContent = msg;
        });
        hideProgress();
        var baseName = BLKOUT.PDFHandler.getFileName().replace(/\.[^.]+$/, '');
        pdf.save('redacted-' + baseName + '-' + timestamp() + '.pdf');
        showToast('PDF exported (image-based for permanent redactions)');
      } catch (e) {
        hideProgress();
        showToast('Export failed');
        console.error(e);
      }
    }
  }

  function downloadDataURL(dataURL, filename) {
    // Try navigator.share on mobile
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      fetch(dataURL)
        .then(function (res) { return res.blob(); })
        .then(function (blob) {
          var file = new File([blob], filename, { type: 'image/png' });
          navigator.share({ files: [file] }).catch(function () {
            fallbackDownload(dataURL, filename);
          });
        })
        .catch(function () {
          fallbackDownload(dataURL, filename);
        });
    } else {
      fallbackDownload(dataURL, filename);
    }
  }

  function fallbackDownload(dataURL, filename) {
    var a = document.createElement('a');
    a.href = dataURL;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  }

  // ── Keyboard ──
  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      // Don't intercept when typing in input
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

      var isMac = /Mac|iPhone/.test(navigator.platform);
      var mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        doUndo();
      } else if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        doRedo();
      }
    });
  }

  // ── State Access ──
  function getRedactions(pageIndex) {
    return state.redactions[pageIndex] || [];
  }

  function addRedaction(pageIndex, redaction) {
    if (!state.redactions[pageIndex]) state.redactions[pageIndex] = [];
    state.redactions[pageIndex].push(redaction);
  }

  function setRedactions(pageIndex, redactions) {
    state.redactions[pageIndex] = redactions;
  }

  function getCurrentPage() {
    return state.currentPage;
  }

  function getStyle() {
    return state.style;
  }

  function getDocType() {
    return state.docType;
  }

  // ── Redraw ──
  function redraw(pageIndex) {
    var redactions = state.redactions[pageIndex] || [];
    if (state.docType === 'image') {
      BLKOUT.ImageHandler.redraw(redactions);
    } else if (state.docType === 'pdf') {
      BLKOUT.PDFHandler.redrawPage(pageIndex, redactions);
    }
    BLKOUT.Undo.updateButtons();
  }

  // ── Reset ──
  function resetState() {
    state.docType = null;
    state.currentPage = 0;
    state.redactions = {};
    BLKOUT.Detection.clearAll();
    BLKOUT.FindRedact.reset();
    BLKOUT.ImageHandler.reset();
    BLKOUT.PDFHandler.reset();
    dom.pagesContainer.innerHTML = '';
    dom.sidebar.hidden = true;
    dom.thumbnailList.innerHTML = '';
    document.getElementById('exportBtn').disabled = true;
    hidePopup();
  }

  // ── UI Helpers ──
  function showAnalysis(text) {
    dom.analysisText.textContent = text || 'Analyzing...';
    dom.analysisOverlay.hidden = false;
  }

  function hideAnalysis() {
    dom.analysisOverlay.hidden = true;
  }

  function showProgress(text) {
    dom.progressText.textContent = text || 'Processing...';
    dom.progressOverlay.hidden = false;
  }

  function hideProgress() {
    dom.progressOverlay.hidden = true;
  }

  var toastTimer = null;
  function showToast(msg) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.hidden = true; }, 3000);
  }

  // ── Boot ──
  document.addEventListener('DOMContentLoaded', init);

  return {
    getRedactions: getRedactions,
    addRedaction: addRedaction,
    setRedactions: setRedactions,
    getCurrentPage: getCurrentPage,
    getStyle: getStyle,
    getDocType: getDocType,
    redraw: redraw,
    showToast: showToast,
    showProgress: showProgress,
    hideProgress: hideProgress
  };
})();
