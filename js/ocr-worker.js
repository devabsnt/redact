window.BLKOUT = window.BLKOUT || {};

BLKOUT.OCR = (function () {
  var worker = null;
  var loading = false;
  var loaded = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function init() {
    if (loaded || loading) return;
    loading = true;

    if (!window.Tesseract) {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }

    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    });

    loaded = true;
    loading = false;
  }

  async function recognize(imageSource) {
    if (!loaded) await init();
    var result = await worker.recognize(imageSource);
    var words = [];

    if (result && result.data && result.data.words) {
      result.data.words.forEach(function (w) {
        if (!w.text || !w.text.trim()) return;
        words.push({
          text: w.text,
          confidence: w.confidence,
          bbox: {
            x: w.bbox.x0,
            y: w.bbox.y0,
            w: w.bbox.x1 - w.bbox.x0,
            h: w.bbox.y1 - w.bbox.y0
          }
        });
      });
    }
    return words;
  }

  function isLoaded() { return loaded; }
  function isLoading() { return loading; }

  return { init: init, recognize: recognize, isLoaded: isLoaded, isLoading: isLoading };
})();
