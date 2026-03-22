window.BLKOUT = window.BLKOUT || {};

BLKOUT.Undo = (function () {
  const undoStacks = {};
  const redoStacks = {};
  const MAX_IMAGE_STEPS = 20;
  const MAX_PDF_STEPS = 10;
  let isPDF = false;

  function init(pdf) {
    isPDF = !!pdf;
    Object.keys(undoStacks).forEach(function (k) { delete undoStacks[k]; });
    Object.keys(redoStacks).forEach(function (k) { delete redoStacks[k]; });
    updateButtons();
  }

  function maxSteps() {
    return isPDF ? MAX_PDF_STEPS : MAX_IMAGE_STEPS;
  }

  function pushState(pageIndex, redactions) {
    if (!undoStacks[pageIndex]) undoStacks[pageIndex] = [];
    if (!redoStacks[pageIndex]) redoStacks[pageIndex] = [];

    undoStacks[pageIndex].push(JSON.parse(JSON.stringify(redactions)));
    if (undoStacks[pageIndex].length > maxSteps()) {
      undoStacks[pageIndex].shift();
    }
    redoStacks[pageIndex] = [];
    updateButtons();
  }

  function undo(pageIndex) {
    if (!canUndo(pageIndex)) return null;
    var current = BLKOUT.App.getRedactions(pageIndex);
    if (!redoStacks[pageIndex]) redoStacks[pageIndex] = [];
    redoStacks[pageIndex].push(JSON.parse(JSON.stringify(current)));
    var prev = undoStacks[pageIndex].pop();
    updateButtons();
    return prev;
  }

  function redo(pageIndex) {
    if (!canRedo(pageIndex)) return null;
    var current = BLKOUT.App.getRedactions(pageIndex);
    if (!undoStacks[pageIndex]) undoStacks[pageIndex] = [];
    undoStacks[pageIndex].push(JSON.parse(JSON.stringify(current)));
    var next = redoStacks[pageIndex].pop();
    updateButtons();
    return next;
  }

  function canUndo(pageIndex) {
    return !!(undoStacks[pageIndex] && undoStacks[pageIndex].length);
  }

  function canRedo(pageIndex) {
    return !!(redoStacks[pageIndex] && redoStacks[pageIndex].length);
  }

  function updateButtons() {
    var page = (BLKOUT.App && BLKOUT.App.getCurrentPage) ? BLKOUT.App.getCurrentPage() : 0;
    var undoBtn = document.getElementById('undoBtn');
    var redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = !canUndo(page);
    if (redoBtn) redoBtn.disabled = !canRedo(page);
  }

  return { init: init, pushState: pushState, undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo, updateButtons: updateButtons };
})();
