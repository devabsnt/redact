window.BLKOUT = window.BLKOUT || {};

BLKOUT.PDFHandler = (function () {
  var pdfDoc = null;
  var pages = [];
  var fileName = '';
  var renderScale = 2;
  var container = null;
  var scrollTimeout = null;
  var BUFFER = 1;

  async function load(file) {
    fileName = file.name || 'document.pdf';
    var arrayBuffer = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    pages = [];
    for (var i = 0; i < pdfDoc.numPages; i++) {
      pages.push({
        pageNum: i + 1,
        canvas: null,
        ctx: null,
        textItems: null,
        viewport: null,
        rendered: false,
        rendering: false
      });
    }

    await extractAllText();
    return pdfDoc;
  }

  async function extractAllText() {
    var promises = pages.map(async function (pageInfo, index) {
      var page = await pdfDoc.getPage(index + 1);
      var viewport = page.getViewport({ scale: renderScale });
      var textContent = await page.getTextContent();
      pageInfo.viewport = viewport;
      pageInfo.textItems = processTextItems(textContent, viewport);
    });
    await Promise.all(promises);
  }

  // Multiply two 6-element 2D transform matrices [a,b,c,d,e,f]
  function combineMat(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function processTextItems(textContent, viewport) {
    var items = [];
    var styles = textContent.styles || {};

    // Measurement canvas for accurate per-word widths and font metrics
    var mCtx = document.createElement('canvas').getContext('2d');
    var metricsCache = {};

    function getFontInfo(fontName, fontSize) {
      var key = fontName + '|' + Math.round(fontSize);
      if (metricsCache[key]) return metricsCache[key];

      var style = styles[fontName];
      var fontFamily = (style && style.fontFamily) || 'sans-serif';
      mCtx.font = fontSize + 'px ' + fontFamily;

      var m = mCtx.measureText('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
      var asc = m.fontBoundingBoxAscent !== undefined
        ? m.fontBoundingBoxAscent
        : (m.actualBoundingBoxAscent !== undefined ? m.actualBoundingBoxAscent : fontSize * 0.85);
      var desc = m.fontBoundingBoxDescent !== undefined
        ? m.fontBoundingBoxDescent
        : (m.actualBoundingBoxDescent !== undefined ? m.actualBoundingBoxDescent : fontSize * 0.25);

      var info = { fontFamily: fontFamily, ascent: asc, descent: desc, font: fontSize + 'px ' + fontFamily };
      metricsCache[key] = info;
      return info;
    }

    textContent.items.forEach(function (item) {
      if (!item.str || !item.str.trim()) return;

      // Combined transform: viewport * item gives canvas-space matrix
      var ct = combineMat(viewport.transform, item.transform);

      // Font height from the combined matrix
      var fontHeight = Math.hypot(ct[2], ct[3]);
      if (fontHeight < 1) fontHeight = 10;

      // Position: ct[4]=x, ct[5]=baseline y
      var canvasX = ct[4];
      var baselineY = ct[5];

      // Total item width in canvas pixels
      var hScale = Math.hypot(ct[0], ct[1]);
      var itemScale = Math.hypot(item.transform[0], item.transform[1]) || 1;
      var textWidth = item.width * (hScale / itemScale);

      // Accurate font metrics via canvas measurement
      var fi = getFontInfo(item.fontName, fontHeight);
      var canvasTop = baselineY - fi.ascent;
      var totalHeight = fi.ascent + fi.descent;

      // Use canvas.measureText for proportional per-word widths
      mCtx.font = fi.font;
      var measuredTotal = mCtx.measureText(item.str).width;
      var wScale = measuredTotal > 0 ? (textWidth / measuredTotal) : 1;

      // Split into words with proportionally-measured widths
      var rawWords = item.str.split(/(\s+)/);
      var currentX = canvasX;

      rawWords.forEach(function (segment) {
        var segW = mCtx.measureText(segment).width * wScale;
        if (!segment.trim()) {
          currentX += segW;
          return;
        }
        items.push({
          text: segment,
          bbox: { x: currentX, y: canvasTop, w: segW, h: totalHeight },
          fontSize: fontHeight
        });
        currentX += segW;
      });
    });
    return items;
  }

  function setupViewer(containerEl) {
    container = containerEl;
    container.innerHTML = '';

    pages.forEach(function (pageInfo, index) {
      var wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper pdf-page';
      wrapper.dataset.pageIndex = index;

      if (pageInfo.viewport) {
        var vw = pageInfo.viewport.width;
        var vh = pageInfo.viewport.height;
        var displayScale = getDisplayScaleForPage(vw);
        wrapper.style.width = Math.round(vw * displayScale) + 'px';
        wrapper.style.height = Math.round(vh * displayScale) + 'px';
      }

      var pageNum = document.createElement('div');
      pageNum.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#333;font-size:24px;';
      pageNum.textContent = index + 1;
      wrapper.appendChild(pageNum);

      container.appendChild(wrapper);
    });

    container.removeEventListener('scroll', onScroll);
    container.addEventListener('scroll', onScroll);
    updateVisiblePages();
  }

  function getDisplayScaleForPage(vpWidth) {
    if (!container) return 0.5;
    var maxW = container.clientWidth - 40;
    return Math.min(1, maxW / vpWidth);
  }

  function onScroll() {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function () {
      updateVisiblePages();
      updateActiveThumbnail();
    }, 80);
  }

  function updateVisiblePages() {
    if (!container) return;
    var cRect = container.getBoundingClientRect();
    var wrappers = container.querySelectorAll('.page-wrapper');
    var toRender = new Set();

    wrappers.forEach(function (wrapper, index) {
      var rect = wrapper.getBoundingClientRect();
      var visible = rect.bottom > cRect.top - cRect.height &&
                    rect.top < cRect.bottom + cRect.height;
      if (visible) {
        toRender.add(index);
        for (var b = 1; b <= BUFFER; b++) {
          if (index - b >= 0) toRender.add(index - b);
          if (index + b < pages.length) toRender.add(index + b);
        }
      }
    });

    toRender.forEach(function (idx) {
      if (!pages[idx].rendered && !pages[idx].rendering) {
        renderPage(idx);
      }
    });
  }

  async function renderPage(index) {
    var pageInfo = pages[index];
    if (pageInfo.rendering || pageInfo.rendered) return;
    pageInfo.rendering = true;

    var page = await pdfDoc.getPage(index + 1);
    var viewport = pageInfo.viewport || page.getViewport({ scale: renderScale });
    pageInfo.viewport = viewport;

    var canvas = document.createElement('canvas');
    canvas.className = 'redact-canvas';
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    var displayScale = getDisplayScaleForPage(viewport.width);
    canvas.style.width = Math.round(viewport.width * displayScale) + 'px';
    canvas.style.height = Math.round(viewport.height * displayScale) + 'px';

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    pageInfo.canvas = canvas;
    pageInfo.ctx = ctx;
    pageInfo.rendered = true;
    pageInfo.rendering = false;

    // Apply existing redactions
    var redactions = BLKOUT.App.getRedactions(index);
    if (redactions && redactions.length) {
      BLKOUT.Redaction.applyAll(ctx, redactions);
    }

    var wrapper = container.querySelectorAll('.page-wrapper')[index];
    if (wrapper) {
      wrapper.innerHTML = '';
      wrapper.appendChild(canvas);
    }
  }

  async function redrawPage(index, redactions) {
    var pageInfo = pages[index];
    if (!pageInfo || !pageInfo.canvas) return;

    var page = await pdfDoc.getPage(index + 1);
    await page.render({ canvasContext: pageInfo.ctx, viewport: pageInfo.viewport }).promise;

    if (redactions && redactions.length) {
      BLKOUT.Redaction.applyAll(pageInfo.ctx, redactions);
    }
  }

  function getPageCount() { return pages.length; }
  function getPage(index) { return pages[index] || null; }
  function getFileName() { return fileName; }
  function getRenderScale() { return renderScale; }

  function getTextItems(pageIndex) {
    return pages[pageIndex] ? (pages[pageIndex].textItems || []) : [];
  }

  function getAllTextItems() {
    return pages.map(function (p, i) {
      return { pageIndex: i, items: p.textItems || [] };
    });
  }

  function hasText() {
    return pages.some(function (p) {
      return p.textItems && p.textItems.length > 0;
    });
  }

  var thumbnailSidebar = null;

  async function generateThumbnails(sidebar) {
    thumbnailSidebar = sidebar;
    sidebar.innerHTML = '';
    for (var i = 0; i < pages.length; i++) {
      await renderThumbnail(sidebar, i);
    }
  }

  async function renderThumbnail(sidebar, index) {
    var thumb = document.createElement('div');
    thumb.className = 'thumbnail' + (index === 0 ? ' active' : '');
    thumb.dataset.pageIndex = index;

    var page = await pdfDoc.getPage(index + 1);
    var thumbViewport = page.getViewport({ scale: 0.4 });
    var tc = document.createElement('canvas');
    tc.width = thumbViewport.width;
    tc.height = thumbViewport.height;
    var tctx = tc.getContext('2d');
    await page.render({ canvasContext: tctx, viewport: thumbViewport }).promise;
    thumb.appendChild(tc);

    thumb.addEventListener('click', function () {
      scrollToPage(index);
      sidebar.querySelectorAll('.thumbnail').forEach(function (t) { t.classList.remove('active'); });
      thumb.classList.add('active');
    });
    sidebar.appendChild(thumb);
  }

  function updateActiveThumbnail() {
    if (!thumbnailSidebar || !container) return;
    var cRect = container.getBoundingClientRect();
    var centerY = cRect.top + cRect.height / 2;
    var wrappers = container.querySelectorAll('.page-wrapper');
    var closest = 0;
    var closestDist = Infinity;

    wrappers.forEach(function (wrapper, index) {
      var rect = wrapper.getBoundingClientRect();
      var mid = rect.top + rect.height / 2;
      var dist = Math.abs(mid - centerY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = index;
      }
    });

    var thumbs = thumbnailSidebar.querySelectorAll('.thumbnail');
    thumbs.forEach(function (t) { t.classList.remove('active'); });
    if (thumbs[closest]) {
      thumbs[closest].classList.add('active');
      thumbs[closest].scrollIntoView({ block: 'nearest' });
    }
  }

  function scrollToPage(index) {
    var wrappers = container.querySelectorAll('.page-wrapper');
    if (wrappers[index]) {
      wrappers[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function exportPDF(allRedactions, onProgress) {
    var jsPDFLib = window.jspdf;
    var pdf = null;

    for (var i = 0; i < pages.length; i++) {
      if (onProgress) onProgress('Exporting page ' + (i + 1) + ' of ' + pages.length + '...');

      var page = await pdfDoc.getPage(i + 1);
      var exportScale = 3;
      var viewport = page.getViewport({ scale: exportScale });

      var ec = document.createElement('canvas');
      ec.width = viewport.width;
      ec.height = viewport.height;
      var ectx = ec.getContext('2d');
      await page.render({ canvasContext: ectx, viewport: viewport }).promise;

      var redactions = allRedactions[i] || [];
      if (redactions.length) {
        var sf = exportScale / renderScale;
        var scaled = redactions.map(function (r) {
          return {
            type: r.type,
            style: r.style,
            rect: {
              x: r.rect.x * sf,
              y: r.rect.y * sf,
              w: r.rect.w * sf,
              h: r.rect.h * sf
            }
          };
        });
        BLKOUT.Redaction.applyAll(ectx, scaled);
      }

      var imgData = ec.toDataURL('image/jpeg', 0.92);
      var ptW = viewport.width * 72 / 96;
      var ptH = viewport.height * 72 / 96;
      var orient = viewport.width > viewport.height ? 'landscape' : 'portrait';

      if (i === 0) {
        pdf = new jsPDFLib.jsPDF({ orientation: orient, unit: 'pt', format: [ptW, ptH] });
      } else {
        pdf.addPage([ptW, ptH], orient);
      }
      pdf.addImage(imgData, 'JPEG', 0, 0, ptW, ptH);

      // Release memory
      ec.width = 0;
      ec.height = 0;
    }

    return pdf;
  }

  function getPageIndexFromCanvas(canvasEl) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].canvas === canvasEl) return i;
    }
    return -1;
  }

  function reset() {
    pdfDoc = null;
    pages = [];
    fileName = '';
    container = null;
    thumbnailSidebar = null;
  }

  return {
    load: load,
    setupViewer: setupViewer,
    getPageCount: getPageCount,
    getPage: getPage,
    getFileName: getFileName,
    getRenderScale: getRenderScale,
    getTextItems: getTextItems,
    getAllTextItems: getAllTextItems,
    hasText: hasText,
    generateThumbnails: generateThumbnails,
    scrollToPage: scrollToPage,
    renderPage: renderPage,
    redrawPage: redrawPage,
    exportPDF: exportPDF,
    updateVisiblePages: updateVisiblePages,
    getPageIndexFromCanvas: getPageIndexFromCanvas,
    reset: reset
  };
})();
