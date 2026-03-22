window.BLKOUT = window.BLKOUT || {};

BLKOUT.ImageHandler = (function () {
  var originalImage = null;
  var canvas = null;
  var ctx = null;
  var scale = 1;
  var fileName = '';

  function load(file) {
    return new Promise(function (resolve, reject) {
      fileName = file.name || 'image';
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          originalImage = img;
          resolve(img);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadFromDataURL(dataURL, name) {
    return new Promise(function (resolve, reject) {
      fileName = name || 'pasted-image';
      var img = new Image();
      img.onload = function () {
        originalImage = img;
        resolve(img);
      };
      img.onerror = reject;
      img.src = dataURL;
    });
  }

  function createCanvas(container) {
    container.innerHTML = '';
    var wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.dataset.pageIndex = '0';

    canvas = document.createElement('canvas');
    canvas.className = 'redact-canvas';
    canvas.width = originalImage.naturalWidth;
    canvas.height = originalImage.naturalHeight;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(originalImage, 0, 0);

    fitToContainer(container);

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);
    return canvas;
  }

  function fitToContainer(container) {
    if (!canvas || !originalImage) return;
    var maxW = container.clientWidth - 40;
    var imgW = originalImage.naturalWidth;
    var imgH = originalImage.naturalHeight;
    scale = Math.min(1, maxW / imgW);
    canvas.style.width = Math.round(imgW * scale) + 'px';
    canvas.style.height = Math.round(imgH * scale) + 'px';
  }

  function getCanvas() { return canvas; }
  function getContext() { return ctx; }
  function getScale() { return scale; }
  function getOriginalImage() { return originalImage; }
  function getFileName() { return fileName; }

  function redraw(redactions) {
    if (!ctx || !originalImage) return;
    ctx.drawImage(originalImage, 0, 0);
    if (redactions && redactions.length) {
      BLKOUT.Redaction.applyAll(ctx, redactions);
    }
  }

  function exportImage(redactions) {
    var ec = document.createElement('canvas');
    ec.width = originalImage.naturalWidth;
    ec.height = originalImage.naturalHeight;
    var ectx = ec.getContext('2d');
    ectx.drawImage(originalImage, 0, 0);
    if (redactions && redactions.length) {
      BLKOUT.Redaction.applyAll(ectx, redactions);
    }
    return ec.toDataURL('image/png');
  }

  function reset() {
    originalImage = null;
    canvas = null;
    ctx = null;
    scale = 1;
    fileName = '';
  }

  return {
    load: load,
    loadFromDataURL: loadFromDataURL,
    createCanvas: createCanvas,
    fitToContainer: fitToContainer,
    getCanvas: getCanvas,
    getContext: getContext,
    getScale: getScale,
    getOriginalImage: getOriginalImage,
    getFileName: getFileName,
    redraw: redraw,
    exportImage: exportImage,
    reset: reset
  };
})();
