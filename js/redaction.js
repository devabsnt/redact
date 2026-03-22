window.BLKOUT = window.BLKOUT || {};

BLKOUT.Redaction = (function () {

  function applyBlackbox(ctx, rect) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(rect.x), Math.round(rect.y), Math.ceil(rect.w), Math.ceil(rect.h));
  }

  function applyPixelate(ctx, rect) {
    var blockSize = 8;
    var x = Math.max(0, Math.floor(rect.x));
    var y = Math.max(0, Math.floor(rect.y));
    var w = Math.ceil(rect.w);
    var h = Math.ceil(rect.h);

    // Clamp to canvas bounds
    var cw = ctx.canvas.width;
    var ch = ctx.canvas.height;
    if (x + w > cw) w = cw - x;
    if (y + h > ch) h = ch - y;
    if (w <= 0 || h <= 0) return;

    var imageData = ctx.getImageData(x, y, w, h);
    var data = imageData.data;

    for (var by = 0; by < h; by += blockSize) {
      for (var bx = 0; bx < w; bx += blockSize) {
        var bw = Math.min(blockSize, w - bx);
        var bh = Math.min(blockSize, h - by);
        var r = 0, g = 0, b = 0, count = 0;

        for (var py = by; py < by + bh; py++) {
          for (var px = bx; px < bx + bw; px++) {
            var i = (py * w + px) * 4;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }

        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        for (var py2 = by; py2 < by + bh; py2++) {
          for (var px2 = bx; px2 < bx + bw; px2++) {
            var j = (py2 * w + px2) * 4;
            var noise = (Math.random() - 0.5) * 50;
            data[j]     = Math.max(0, Math.min(255, r + noise));
            data[j + 1] = Math.max(0, Math.min(255, g + noise));
            data[j + 2] = Math.max(0, Math.min(255, b + noise));
            data[j + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, x, y);
  }

  function applyRedaction(ctx, redaction) {
    if (redaction.style === 'blackbox') {
      applyBlackbox(ctx, redaction.rect);
    } else {
      applyPixelate(ctx, redaction.rect);
    }
  }

  function applyAll(ctx, redactions) {
    for (var i = 0; i < redactions.length; i++) {
      applyRedaction(ctx, redactions[i]);
    }
  }

  return {
    applyRedaction: applyRedaction,
    applyAll: applyAll,
    applyBlackbox: applyBlackbox,
    applyPixelate: applyPixelate
  };
})();
