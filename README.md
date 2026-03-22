# redact.fyi

A client-side web tool for intelligently redacting sensitive information from screenshots, images, and PDFs. Everything runs in your browser — no server, no uploads, no backend.

**Your files never leave your device.**

## Features

### Smart Tap-to-Redact
Click on any text element in Auto mode and get intelligent options:
- **Redact this** — redact the tapped element
- **Redact all '[word]'** — find and redact every instance of that word across the entire document (case-insensitive, catches partial matches like emails)
- **Redact similar** — redact elements with matching font size and position

### Find & Redact
Type a word or phrase in the search bar to find every instance across all pages of a document:
- Case-insensitive by default with a case-sensitive toggle
- Regex support for power users
- Multi-word queries match any word individually
- Yellow highlights preview all matches before you commit
- One click to redact them all

### Manual Mode
Click-and-drag rectangular selection for freehand redaction. Always available as a fallback.

### Redaction Styles
- **Pixelate** (default) — destructive pixelation with noise injection
- **Black box** — solid black fill, classic legal redaction

### Destructive by Design
Redactions are **permanent and irrecoverable** in exported files:
- Original pixel data is overwritten on the canvas, not just covered
- PDFs are exported as image-based pages — underlying text/vector data is destroyed
- Pixelate mode averages pixel blocks and adds random noise to prevent reconstruction

## Supported Files

| Format               | Detection Method                                     |
|----------------------|------------------------------------------------------|
| **PNG, JPG, WEBP**   | Tesseract.js OCR (runs in web worker)                |
| **PDF (text-based)** | PDF.js `getTextContent()` — instant, no OCR needed   |
| **PDF (scanned)**    | Falls back to Tesseract.js OCR                       |

Upload via file picker, drag-and-drop, or paste from clipboard (Ctrl+V / Cmd+V).

## PDF Support

- Scrollable multi-page viewer with virtual rendering (only visible pages + buffer are rendered)
- Page thumbnail sidebar with live preview and scroll tracking
- Text positions extracted via PDF.js with accurate proportional word-level bounding boxes
- Export re-renders every page at 3x resolution as JPEG in a new PDF via jsPDF — all redactions are baked in

## Architecture

```
index.html          — UI structure
style.css           — dark theme, responsive layout
vercel.json         — Vercel deployment headers (COOP/COEP for SharedArrayBuffer)
js/
  app.js            — main coordinator: file handling, UI events, state, export
  image-handler.js  — image loading, canvas management, PNG export
  pdf-handler.js    — PDF.js integration, virtual scrolling, text extraction, PDF export
  detection.js      — unified hit testing, text search, element clustering, face detection
  find-redact.js    — search highlighting and batch redaction
  redaction.js      — destructive pixelate and blackbox implementations
  ocr-worker.js     — lazy-loaded Tesseract.js wrapper
  undo.js           — per-page undo/redo stacks
```

No build step. No framework. Vanilla JS, HTML, CSS.

## Dependencies

All loaded via CDN at runtime — nothing to install:

- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF rendering and text extraction
- [jsPDF](https://github.com/parallax/jsPDF) — PDF export
- [Tesseract.js](https://github.com/naptha/tesseract.js) — OCR for images and scanned PDFs (lazy-loaded)
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) — face detection (lazy-loaded)

## Run Locally

Serve the directory with any static file server:

```bash
# Python
python -m http.server 8000

# Node
npx serve .

# VS Code
# Use the Live Server extension
```

Open `http://localhost:8000` in your browser.

## Deploy

Push to GitHub and connect to [Vercel](https://vercel.com). No build configuration needed — it deploys as a static site. The `vercel.json` configures required COOP/COEP headers for SharedArrayBuffer support.

## Keyboard Shortcuts

| Shortcut              | Action                     |
|-----------------------|----------------------------|
| `Ctrl+Z` / `Cmd+Z`    | Undo                       |
| `Ctrl+Y` / `Cmd+Y`    | Redo                       |
| `Ctrl+V` / `Cmd+V`    | Paste image from clipboard |

## License

MIT
