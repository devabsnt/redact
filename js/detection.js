window.BLKOUT = window.BLKOUT || {};

BLKOUT.Detection = (function () {
  // Stores detected items per page: { pageIndex: [ {text, bbox, fontSize, source} ] }
  var detectedItems = {};
  var faceApiLoaded = false;
  var faceApiLoading = false;

  function setItems(pageIndex, items) {
    detectedItems[pageIndex] = items;
  }

  function getItems(pageIndex) {
    return detectedItems[pageIndex] || [];
  }

  function clearAll() {
    Object.keys(detectedItems).forEach(function (k) { delete detectedItems[k]; });
  }

  // Hit test: find the item at canvas coordinates (x, y) for a given page
  function hitTest(pageIndex, x, y) {
    var items = detectedItems[pageIndex] || [];
    for (var i = items.length - 1; i >= 0; i--) {
      var b = items[i].bbox;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return items[i];
      }
    }
    return null;
  }

  // Find all items with matching text on a given page
  function findAllByText(pageIndex, text) {
    var items = detectedItems[pageIndex] || [];
    var lower = text.toLowerCase();
    return items.filter(function (item) {
      return item.text.toLowerCase() === lower;
    });
  }

  // Find all items containing text across ALL pages (substring, case-insensitive)
  function findAllByTextGlobal(text) {
    var results = [];
    var lower = text.toLowerCase();
    Object.keys(detectedItems).forEach(function (key) {
      var pageIndex = parseInt(key);
      detectedItems[key].forEach(function (item) {
        if (item.text.toLowerCase().indexOf(lower) !== -1) {
          results.push({ pageIndex: pageIndex, item: item });
        }
      });
    });
    return results;
  }

  // Find "similar" elements: same approximate font size and x-position cluster
  function findSimilar(pageIndex, targetItem) {
    var items = detectedItems[pageIndex] || [];
    var tBbox = targetItem.bbox;
    var tFontSize = targetItem.fontSize || tBbox.h;

    return items.filter(function (item) {
      if (item === targetItem) return false;
      var b = item.bbox;
      var fs = item.fontSize || b.h;
      var sameX = Math.abs(b.x - tBbox.x) < 15;
      var sameSize = Math.abs(fs - tFontSize) < 3;
      return sameX && sameSize;
    });
  }

  // Count all items containing text across all pages (substring, case-insensitive)
  function countGlobal(text) {
    var lower = text.toLowerCase();
    var count = 0;
    Object.keys(detectedItems).forEach(function (key) {
      detectedItems[key].forEach(function (item) {
        if (item.text.toLowerCase().indexOf(lower) !== -1) count++;
      });
    });
    return count;
  }

  // Run OCR on an image canvas and store results
  async function runOCR(pageIndex, canvas) {
    var words = await BLKOUT.OCR.recognize(canvas);
    // Map OCR words into our standard format
    var items = words.map(function (w) {
      return {
        text: w.text,
        bbox: w.bbox,
        fontSize: w.bbox.h,
        confidence: w.confidence,
        source: 'ocr'
      };
    });
    detectedItems[pageIndex] = items;
    return items;
  }

  // Load face-api.js lazily
  function loadFaceApi() {
    if (faceApiLoaded || faceApiLoading) return Promise.resolve();
    faceApiLoading = true;

    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = async function () {
        try {
          await faceapi.nets.tinyFaceDetector.loadFromUri(
            'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'
          );
          faceApiLoaded = true;
          faceApiLoading = false;
          resolve();
        } catch (e) {
          faceApiLoading = false;
          reject(e);
        }
      };
      s.onerror = function () {
        faceApiLoading = false;
        reject(new Error('Failed to load face-api.js'));
      };
      document.head.appendChild(s);
    });
  }

  // Detect faces on a canvas
  async function detectFaces(canvas) {
    if (!faceApiLoaded) {
      try {
        await loadFaceApi();
      } catch (e) {
        console.warn('Face detection unavailable:', e);
        return [];
      }
    }

    var detections = await faceapi.detectAllFaces(
      canvas,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
    );

    return detections.map(function (d) {
      return {
        text: '[face]',
        bbox: {
          x: Math.round(d.box.x),
          y: Math.round(d.box.y),
          w: Math.round(d.box.width),
          h: Math.round(d.box.height)
        },
        fontSize: 0,
        source: 'face'
      };
    });
  }

  // Search text items using a query string or regex
  // Multi-word queries split into individual words and match any
  function searchText(query, caseSensitive, useRegex) {
    var results = [];

    Object.keys(detectedItems).forEach(function (key) {
      var pageIndex = parseInt(key);
      var items = detectedItems[key];

      items.forEach(function (item) {
        var match = false;

        if (useRegex) {
          try {
            var flags = caseSensitive ? 'g' : 'gi';
            var re = new RegExp(query, flags);
            match = re.test(item.text);
          } catch (e) {
            match = false;
          }
        } else {
          // Split multi-word queries into individual words
          var queryWords = query.trim().split(/\s+/);
          var itemText = caseSensitive ? item.text : item.text.toLowerCase();

          for (var i = 0; i < queryWords.length; i++) {
            var qw = caseSensitive ? queryWords[i] : queryWords[i].toLowerCase();
            if (qw && itemText.indexOf(qw) !== -1) {
              match = true;
              break;
            }
          }
        }

        if (match) {
          results.push({ pageIndex: pageIndex, item: item });
        }
      });
    });

    return results;
  }

  return {
    setItems: setItems,
    getItems: getItems,
    clearAll: clearAll,
    hitTest: hitTest,
    findAllByText: findAllByText,
    findAllByTextGlobal: findAllByTextGlobal,
    findSimilar: findSimilar,
    countGlobal: countGlobal,
    runOCR: runOCR,
    detectFaces: detectFaces,
    searchText: searchText
  };
})();
