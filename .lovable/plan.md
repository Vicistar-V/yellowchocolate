

# New PDF Tools: Remove Pages, Extract Pages, Organize Pages

Three new tools built on the existing reusable `tool/` framework, each with a focused purpose and polished "beast mode" UX.

---

## Design Philosophy

Each tool does **one thing perfectly** rather than overloading users with options. The platform stays in charge: clear labels, smart defaults, and guided flows. Users get flexibility within a controlled, opinionated experience.

---

## Tool 1: Remove Pages (`/remove-pages`)

**Purpose:** Delete unwanted pages from a PDF and download the cleaned version.

**Flow:** Upload -> Select pages to REMOVE -> Download

**UX Details:**
- Upload single PDF via the standard `FileDropZone`
- Page grid identical to Split PDF's "Pick Pages" but inverted: pages start **all selected** (kept), clicking a page **marks it for removal** (turns red/destructive styling with strikethrough)
- "Keep All / Remove All" quick-toggle buttons
- Live counter: "Keeping 8 of 12 pages (removing 4)"
- Big red action button: "Remove 4 Pages" with a `Trash2` icon
- Output is always a single PDF (no ZIP complexity)
- Safety: disabled button if user tries to remove ALL pages ("Must keep at least 1 page" hint)

**Why it's separate from Split:** Remove is destructive-language ("delete these"), Split is constructive ("extract these"). Different mental model, clearer intent, fewer mistakes.

---

## Tool 2: Extract Pages (`/extract-pages`)

**Purpose:** Pull out specific pages into a new PDF. Identical outcome to Split's "Pick Pages" mode, but framed as extraction with a simpler, single-purpose UI.

**Flow:** Upload -> Select pages to EXTRACT -> Download

**UX Details:**
- Upload single PDF via `FileDropZone`
- Page grid where clicking **selects pages to keep** (primary color highlight, same as Split)
- "Select All / Clear" toggles
- Live counter: "Extracting 5 of 12 pages"
- Action button: "Extract 5 Pages" with `FileOutput` icon
- Output is always a single PDF containing only the selected pages
- Simpler than Split -- no modes, no ranges, no chunks. Just click and extract.

**Why it's separate from Split:** Split has 4 modes and produces ZIP files. Extract is the "I just want these pages" quick tool. Fewer decisions = faster for common use cases.

---

## Tool 3: Organize Pages (`/organize`)

**Purpose:** Reorder, duplicate, or rotate pages within a PDF. The power tool.

**Flow:** Upload -> Visual page list with drag-to-reorder -> Download

**UX Details:**
- Upload single PDF via `FileDropZone`
- Vertical sortable list (reusing `@dnd-kit` patterns from `FileList`) showing each page as a numbered card
- Each page card shows: page number, a small page-size indicator, and action buttons
- Per-page actions (icon buttons on each card):
  - **Rotate** (90deg clockwise toggle, cycles 0/90/180/270) with `RotateCw` icon
  - **Duplicate** page (inserts copy below) with `Copy` icon  
  - **Delete** page with `Trash2` icon
- Drag handle on the left for reordering (same DnD patterns as merge file list)
- Top toolbar with bulk actions: "Reverse Order", "Remove Duplicates" (if any were added)
- Live page count: "12 pages (2 rotated, 1 duplicated)"
- Action button: "Save Organized PDF" with `LayoutList` icon
- Output is always a single PDF

**Why this is the power tool:** It's the only tool that lets users rearrange page order, rotate individual pages, and duplicate pages -- all in one place with drag-and-drop.

---

## Technical Implementation

### Files to Create
1. **`src/pages/RemovePages.tsx`** -- ~200 lines, follows SplitPdf pattern
2. **`src/pages/ExtractPages.tsx`** -- ~180 lines, simplest of the three
3. **`src/pages/OrganizePages.tsx`** -- ~350 lines, most complex (DnD + per-page actions)

### Files to Update
4. **`src/App.tsx`** -- Add 3 new routes
5. **`src/components/AppSidebar.tsx`** -- Enable the 3 sidebar items (already listed, just `enabled: false`)
6. **`src/pages/Index.tsx`** -- No changes needed (homepage only shows 8 highlights)

### Shared Components Used (no changes needed)
- `ToolPageLayout` -- page shell with header, steps, trust badges
- `FileDropZone` -- upload step
- `OutputConfig` -- output filename input
- `ProcessingView` -- processing spinner
- `SuccessView` -- download screen
- `formatFileSize` from `file-utils`

### PDF Processing (all client-side via `pdf-lib`)
- **Remove/Extract:** `PDFDocument.create()` + `copyPages()` for selected/unselected pages
- **Organize reorder:** `copyPages()` in the user's custom order
- **Organize rotate:** `page.setRotation(degrees(angle))` from pdf-lib
- **Organize duplicate:** Copy a page and insert it at the desired position

### No new dependencies needed
Everything uses existing `pdf-lib`, `@dnd-kit`, `lucide-react`, and Tailwind.

