
Goal: fix the conversion pipelines that are producing empty/useless outputs, starting with Word/Excel/PowerPoint to PDF and the related PDF-to-* tools that show the same behavior.

What I inspected (front + back)
- Front-end pages:
  - `src/pages/WordToPdf.tsx`
  - `src/pages/ExcelToPdf.tsx`
  - `src/pages/PowerPointToPdf.tsx`
  - `src/pages/PdfToImage.tsx`
  - `src/pages/PdfToWord.tsx`
  - `src/pages/PdfToPowerPoint.tsx`
  - `src/pages/PdfToExcel.tsx`
  - shared renderer: `src/lib/html-to-pdf-renderer.ts`
  - upload component: `src/components/tool/FileDropZone.tsx`
- App integration:
  - `src/App.tsx` routes are correctly wired
  - `src/pages/Index.tsx` entries are enabled
- Back-end:
  - no `supabase/functions` currently present (no backend conversion pipeline exists yet)
- Runtime signals:
  - no clear runtime JS errors from console logs
  - many conversion/download flows rely on object URLs and immediate revocation

Root causes found
1) Download reliability bug across many tools
- Most tools do:
  - `URL.createObjectURL(blob)` → `a.click()` → `URL.revokeObjectURL(url)` immediately
- This can cause partial/empty/corrupt downloads on some browsers/devices for larger files.

2) Word-to-PDF accepts `.doc` but conversion engine is `mammoth`
- `WordToPdf.tsx` accepts `.doc` and `.docx`
- `mammoth` reliably supports `.docx`, not legacy `.doc`
- This creates failed/empty/useless outputs for some inputs.

3) HTML-to-PDF rendering fragility
- `html-to-pdf-renderer.ts` renders content in a far off-screen container (`top/left: -99999px`) and snapshots immediately.
- No robust wait for fonts/images/content layout completion.
- This can yield blank/near-blank canvas snapshots.

4) PowerPoint-to-PDF parser is too naive
- `PowerPointToPdf.tsx` parses slide XML with fragile regex (`<a:t>...</a:t>` only), missing text nodes that include attributes (`<a:t xml:space="preserve">...`), and does not preserve actual slide layout.
- Current rendering is mostly “reconstructed content”, not faithful slide rendering.

5) PDF-to-Word/Excel quality collapse on scanned/image PDFs
- `PdfToWord.tsx` and `PdfToExcel.tsx` depend on `pdf.js getTextContent()`.
- For scanned PDFs, extracted text is minimal/empty, so output becomes useless.
- This matches your symptom pattern.

6) PDF-to-PowerPoint currently image-based (better), but quality controls are limited
- It should usually produce non-empty slides, but can look poor due fixed scale and sizing behavior.

Implementation plan (complete, file-by-file)

Phase 1 — Stabilize output/download pipeline (highest impact, low risk)
1. Create shared download utility
- New file: `src/lib/download-utils.ts`
- Add:
  - `downloadBlob(blob, filename)` with safe anchor lifecycle
  - delayed URL revocation (`setTimeout`) instead of immediate revoke
  - optional iOS/Safari-safe behavior

2. Replace direct object URL download code in affected tools
- Update these files to use `downloadBlob`:
  - `WordToPdf.tsx`
  - `ExcelToPdf.tsx`
  - `PowerPointToPdf.tsx`
  - `PdfToImage.tsx`
  - `PdfToWord.tsx`
  - `PdfToPowerPoint.tsx`
  - `PdfToExcel.tsx`
- This addresses empty/corrupt downloads system-wide.

Phase 2 — Fix Office → PDF conversion robustness
3. Harden HTML renderer
- File: `src/lib/html-to-pdf-renderer.ts`
- Changes:
  - switch hidden container strategy to non-extreme positioning (avoid giant offscreen coordinates)
  - wait for `document.fonts.ready` when available
  - wait for `<img>` completion before snapshot
  - add guard: if rendered canvas is effectively blank, throw a clear conversion error
  - improve pagination slicing consistency for tall content

4. Word-to-PDF input validation + fallback
- File: `src/pages/WordToPdf.tsx`
- Changes:
  - enforce `.docx` support (or explicitly block `.doc` with clear toast explaining limitation)
  - capture mammoth warnings/messages and show user-facing hints
  - if HTML output is empty, fallback to raw-text extraction path (instead of generating blank PDF)

5. Excel-to-PDF table rendering reliability
- File: `src/pages/ExcelToPdf.tsx`
- Changes:
  - prefer normalized sheet rendering (AOA-based table generation) when `sheet_to_html` output is empty/problematic
  - skip truly empty sheets or show explicit “empty sheet” section
  - keep page width handling but avoid styles that can hide content in capture stage

6. PowerPoint-to-PDF parser/render upgrade
- File: `src/pages/PowerPointToPdf.tsx`
- Changes:
  - improve XML text extraction regex to support attributes (`<a:t[^>]*>`)
  - decode XML entities in extracted text
  - better slide parsing structure (title/body ordering and line preservation)
  - tighten image extraction mapping
  - improve render sizing so slides are readable and consistent
- Note: this remains a best-effort client-side reconstruction (not a full PowerPoint layout engine).

Phase 3 — Fix PDF → editable formats quality
7. Add extraction quality scoring utility
- New shared helper (in `src/lib`):
  - detect poor extraction (few chars, low alpha count, mostly whitespace)
- Reuse in `PdfToWord.tsx` and `PdfToExcel.tsx`.

8. PDF-to-Word fallback behavior
- File: `src/pages/PdfToWord.tsx`
- Changes:
  - if text quality is poor, provide fallback mode:
    - include page images in DOCX or
    - include explicit message that page appears scanned (and keep page placeholders meaningful)
  - avoid silently producing “empty” docx.

9. PDF-to-Excel fallback behavior
- File: `src/pages/PdfToExcel.tsx`
- Changes:
  - when extraction is poor, avoid generating near-empty grids
  - produce structured fallback sheet with per-page notes + any detected text
  - keep table reconstruction path for good-quality text PDFs

10. PDF-to-PowerPoint image quality pass
- File: `src/pages/PdfToPowerPoint.tsx`
- Changes:
  - improve render scale and aspect-fit behavior
  - ensure every page always yields a visible slide image
  - add clearer progress/errors for problematic pages

Phase 4 — Optional backend OCR (for true scanned PDF support)
11. Add optional OCR pipeline (if you want real scanned-document extraction quality)
- Back-end additions (currently absent):
  - `supabase/functions/...` for OCR extraction orchestration
- Front-end integration:
  - call OCR endpoint only when native extraction quality is poor
- Requirements:
  - external OCR key/connection (not currently configured in secrets)
- This is the only way to make scanned PDF → Word/Excel “high quality” consistently.

Quality gates before completion
- End-to-end checks for each affected route:
  - `/word-to-pdf`, `/excel-to-pdf`, `/ppt-to-pdf`
  - `/pdf-to-image`, `/pdf-to-word`, `/pdf-to-ppt`, `/pdf-to-excel`
- Test matrix:
  - small and large files
  - digital-text PDFs vs scanned PDFs
  - single-file and batch ZIP outputs
- Validate output files open correctly and are non-empty on download.

Expected outcome after this plan
- No more empty/corrupt downloads from premature object URL revocation.
- Office-to-PDF tools become significantly more reliable and less likely to produce blank pages.
- PDF-to-Word/Excel stop producing silently useless outputs and handle scanned PDFs more transparently.
- Optional path exists for true OCR-grade extraction via backend if you want full “production-grade” scanned-doc support.
