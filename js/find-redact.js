window.BLKOUT = window.BLKOUT || {};

BLKOUT.FindRedact = (function () {
  var currentMatches = [];
  var highlightCanvases = {};
  var debounceTimer = null;

  function init() {
    var input = document.getElementById('findInput');
    var caseCb = document.getElementById('caseSensitive');
    var regexCb = document.getElementById('regexToggle');
    var btn = document.getElementById('findRedactBtn');

    input.addEventListener('input', function () {
      debounceSearch();
    });
    caseCb.addEventListener('change', function () { debounceSearch(); });
    regexCb.addEventListener('change', function () { debounceSearch(); });
    btn.addEventListener('click', function () { redactAllMatches(); });
  }

  function debounceSearch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 200);
  }

  function doSearch() {
    var query = document.getElementById('findInput').value.trim();
    var caseSensitive = document.getElementById('caseSensitive').checked;
    var useRegex = document.getElementById('regexToggle').checked;
    var countEl = document.getElementById('matchCount');
    var btn = document.getElementById('findRedactBtn');

    clearHighlights();

    if (!query) {
      countEl.textContent = '';
      btn.disabled = true;
      currentMatches = [];
      return;
    }

    currentMatches = BLKOUT.Detection.searchText(query, caseSensitive, useRegex);

    if (currentMatches.length === 0) {
      countEl.textContent = 'No matches';
      btn.disabled = true;
    } else {
      countEl.textContent = currentMatches.length + ' found';
      btn.disabled = false;
      drawHighlights();
    }
  }

  function drawHighlights() {
    var docType = BLKOUT.App.getDocType();

    currentMatches.forEach(function (match) {
      var pageIndex = match.pageIndex;
      var bbox = match.item.bbox;

      var canvas;
      if (docType === 'pdf') {
        var pageInfo = BLKOUT.PDFHandler.getPage(pageIndex);
        canvas = pageInfo ? pageInfo.canvas : null;
      } else {
        canvas = BLKOUT.ImageHandler.getCanvas();
      }
      if (!canvas) return;

      // Create or reuse overlay canvas
      var overlayKey = 'overlay-' + pageIndex;
      var overlay = highlightCanvases[overlayKey];
      if (!overlay) {
        overlay = document.createElement('canvas');
        overlay.className = 'highlight-overlay';
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        overlay.style.width = canvas.style.width;
        overlay.style.height = canvas.style.height;
        canvas.parentElement.appendChild(overlay);
        highlightCanvases[overlayKey] = overlay;
      }

      var ctx = overlay.getContext('2d');
      var pad = 6;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.fillRect(bbox.x - pad, bbox.y - pad, bbox.w + pad * 2, bbox.h + pad * 2);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bbox.x - pad, bbox.y - pad, bbox.w + pad * 2, bbox.h + pad * 2);
    });
  }

  function clearHighlights() {
    Object.keys(highlightCanvases).forEach(function (key) {
      var overlay = highlightCanvases[key];
      if (overlay && overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
      delete highlightCanvases[key];
    });
  }

  function redactAllMatches() {
    if (!currentMatches.length) return;

    var style = BLKOUT.App.getStyle();

    // Group by page
    var byPage = {};
    currentMatches.forEach(function (match) {
      if (!byPage[match.pageIndex]) byPage[match.pageIndex] = [];
      byPage[match.pageIndex].push(match.item);
    });

    Object.keys(byPage).forEach(function (key) {
      var pageIndex = parseInt(key);
      var items = byPage[key];

      // Save undo state before
      BLKOUT.Undo.pushState(pageIndex, BLKOUT.App.getRedactions(pageIndex));

      items.forEach(function (item) {
        BLKOUT.App.addRedaction(pageIndex, {
          type: 'box',
          rect: {
            x: item.bbox.x - 6,
            y: item.bbox.y - 6,
            w: item.bbox.w + 12,
            h: item.bbox.h + 12
          },
          style: style
        });
      });

      BLKOUT.App.redraw(pageIndex);
    });

    clearHighlights();
    currentMatches = [];
    document.getElementById('matchCount').textContent = 'Redacted';
    document.getElementById('findRedactBtn').disabled = true;

    BLKOUT.App.showToast('Redacted ' + Object.keys(byPage).reduce(function (sum, k) {
      return sum + byPage[k].length;
    }, 0) + ' instances');
  }

  function reset() {
    clearHighlights();
    currentMatches = [];
    document.getElementById('findInput').value = '';
    document.getElementById('matchCount').textContent = '';
    document.getElementById('findRedactBtn').disabled = true;
  }

  return {
    init: init,
    doSearch: doSearch,
    clearHighlights: clearHighlights,
    redactAllMatches: redactAllMatches,
    reset: reset
  };
})();
