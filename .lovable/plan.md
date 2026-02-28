
# Fix Word to PDF: Improve Layout Fidelity

## Problem
The current Word-to-PDF converter uses a simple text-block renderer (`pdf-lib` + `parseHtmlToBlocks`) that strips all layout, positioning, and formatting from the document. It streams content top-to-bottom as plain text blocks, losing image positioning, text wrapping around images, font styles, colors, and complex layouts. This produces poorly arranged output compared to professional tools.

## Solution
Switch to a **high-fidelity HTML rendering approach** using `html2canvas` to capture the mammoth-generated HTML as a properly rendered image, then embed it page-by-page into the PDF. This preserves all CSS layout, image positioning, and formatting.

## Technical Plan

### 1. Update `WordToPdf.tsx` - Replace `renderHtmlToPdf` with HTML2Canvas Pipeline

- Create a hidden off-screen `<div>` container (positioned off-screen so it doesn't flash)
- Inject mammoth's HTML output with the existing `WORD_CSS` styles into the container
- Set the container to a fixed A4-proportional width (e.g., 794px = A4 at 96dpi) so content flows naturally
- Use `html2canvas` with `scale: 2` for high quality rendering
- Slice the resulting canvas into A4-proportioned pages
- Use `pdf-lib` to create a PDF and embed each page slice as a PNG image
- Clean up the temporary DOM container

### 2. Multi-Page Handling
- Calculate page height based on A4 aspect ratio (794 x 1123px at 96dpi)
- Slice the full-height canvas into page-sized chunks
- Each chunk becomes a separate PDF page with the image embedded at full A4 dimensions

### 3. Keep Existing Code
- Keep `renderHtmlToPdf` in `html-to-pdf-renderer.ts` unchanged (used by Excel/HTML converters)
- Only change the Word converter to use the new canvas-based approach
- Keep all existing UI, batch support, ZIP handling, etc.

### Files Changed
- **`src/pages/WordToPdf.tsx`** - Replace the conversion logic to use html2canvas + pdf-lib image embedding instead of `renderHtmlToPdf`

### Trade-off
The output text won't be selectable/searchable (it's rendered as images), but the layout will be pixel-perfect — matching what professional tools like ilovepdf produce. This is the same approach ilovepdf and similar services use for complex documents.
