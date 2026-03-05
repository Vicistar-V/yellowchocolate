

# Plan: Sign PDF, Redact PDF, Compare PDF

## Overview

Three new client-side PDF tools following the existing ToolPageLayout pattern. All processing happens in-browser using `pdf-lib` (for PDF manipulation) and `pdfjs-dist` (for page rendering/preview). No server uploads.

---

## 1. Sign PDF (`/sign`)

### Flow
Upload → Preview & Place Signature → Download

**Steps:** `1. Upload` → `2. Sign` → `3. Download`

### Signature Creation (3 methods)
- **Draw**: HTML Canvas with freehand drawing (pen tool). Black ink on transparent background. Stroke smoothing for natural look. "Clear" button to restart.
- **Type**: Text input rendered in a cursive/script font (use Google Font "Dancing Script" or similar via a `@font-face` import). User types their name, sees live preview. Color picker (black, blue, red).
- **Upload**: Upload PNG/JPG image of a signature. Auto-trim whitespace around edges.

### Placement UX
- Render each PDF page as a canvas preview using `pdfjs-dist` (same pattern as CropPdf).
- Page navigation: Previous / Next with page counter ("Page 2 of 5").
- User clicks on the page preview to place the signature. A draggable, resizable overlay appears at the click position.
- Resize handle (corner drag) to scale signature proportionally.
- "Apply to all pages" toggle option.
- Signature position stored as `{ x%, y%, width%, pageIndex }` relative to page dimensions for accurate pdf-lib placement.

### Processing
- Use `pdf-lib` to embed the signature as a PNG image on each selected page at the calculated coordinates.
- Batch support: multiple PDFs, each gets the same signature placement.

### UI Components
- Tab switcher for Draw / Type / Upload (same style as watermark Text/Image toggle).
- Canvas element for draw mode (400x150px, white background, 2px black stroke).
- Signature preview card showing the current signature before placement.
- Page preview area (similar to CropPdf preview pattern).

---

## 2. Redact PDF (`/redact`)

### Flow
Upload → Select Areas to Redact → Process → Download

**Steps:** `1. Upload` → `2. Redact` → `3. Download`

### Redaction UX
- Single PDF upload (redaction requires careful per-page work, so single-file focus).
- Full page preview rendered via `pdfjs-dist` at good resolution.
- Page navigation with Previous / Next.
- **Drawing rectangles**: User clicks and drags on the page preview to draw red-bordered rectangles over content to redact. Each rectangle is a separate redaction zone.
- Rectangle list panel showing all redactions per page ("Page 1: 3 areas", "Page 2: 1 area").
- Click a rectangle to select it; press Delete/Backspace or click X to remove.
- "Undo last" button to remove most recent rectangle.
- Redaction color option: Black (default), White.

### Processing
- Use `pdf-lib` to draw filled opaque rectangles (black or white) over the selected coordinates on each page.
- Note: This is a visual redaction (overlay). The text underneath is covered but not stripped from the PDF structure. This is the standard approach for client-side tools and matches what most online tools do. A small disclaimer text will note this.

### Technical Details
- Store redaction zones as `{ pageIndex, x, y, width, height }` in PDF coordinate space (convert from screen coordinates using the preview scale factor).
- Coordinate conversion: `pdfX = screenX / previewScale`, `pdfY = pageHeight - (screenY / previewScale)` (PDF origin is bottom-left).

---

## 3. Compare PDF (`/compare`)

### Flow
Upload Two PDFs → Side-by-Side Visual Comparison → Navigate Pages

**Steps:** `1. Upload` → `2. Compare` → `3. Export` (optional)

### Upload UX
- Two distinct drop zones side by side: "Original PDF" (left) and "Modified PDF" (right).
- Each accepts exactly one PDF.
- Once both are uploaded, auto-advance to comparison view.

### Comparison View
- **Side-by-side layout** using a split panel (can use existing `react-resizable-panels`).
- Each page rendered via `pdfjs-dist` as a canvas image.
- Synchronized page navigation: Previous / Next controls page for both panels simultaneously.
- Page count display: "Page 1 of 12" (handles different page counts gracefully -- shows blank placeholder if one PDF has fewer pages).

### Difference Highlighting
- **Pixel diff overlay**: Render both pages to off-screen canvases at the same scale, then iterate pixel data. Pixels that differ beyond a threshold get highlighted in red/magenta on a third "diff" canvas.
- **Three view modes** (toggle buttons):
  1. **Side by Side**: Both pages shown next to each other.
  2. **Overlay**: Diff highlights overlaid on the original.
  3. **Slider**: A draggable vertical slider that reveals left vs right (like before/after image comparisons).
- Difference summary per page: "X% different" badge.

### Export (Optional Step)
- "Download comparison report" button that generates a PDF with side-by-side page images and diff overlays.
- Or simply allow downloading a screenshot/PNG of the current comparison view.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/SignPdf.tsx` | Sign PDF tool page |
| `src/pages/RedactPdf.tsx` | Redact PDF tool page |
| `src/pages/ComparePdf.tsx` | Compare PDF tool page |

## Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add 3 new routes: `/sign`, `/redact`, `/compare` |
| `src/pages/Index.tsx` | Add Sign PDF, Redact PDF, Compare PDF to highlights array (enabled: true) |
| `src/components/AppSidebar.tsx` | Change `enabled: false` to `true` for Sign, Redact, Compare entries |

## Implementation Order

1. **Sign PDF** -- most user-demanded feature, involves canvas drawing + pdf-lib image embedding
2. **Redact PDF** -- page preview + rectangle drawing + pdf-lib rectangle overlay
3. **Compare PDF** -- most complex (dual rendering, pixel diff), built last

Each page will be 400-600 lines following the exact same patterns as AddWatermark/ProtectPdf/CropPdf (same step flow, same trust badges, same animation classes, same button styles).

