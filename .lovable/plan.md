
# Reusable Tool Page Components

Extract all the polished UX patterns from the Merge PDF page into generic, reusable components that any future tool page (Split PDF, Image Converter, etc.) can use.

## Components to Create

### 1. `src/components/tool/FileDropZone.tsx` (generic version)
Move from `src/components/merge/FileDropZone.tsx` but make it configurable:
- Accept `accept` prop (e.g. `"application/pdf"`, `"image/*"`) instead of hardcoded PDF filter
- Accept `title`, `subtitle`, `buttonLabel` props for custom text (defaults provided)
- Accept `icon` prop for the drag-active icon (defaults to `FileStack`)

### 2. `src/components/tool/FileList.tsx` (generic sortable file list)
Move from `src/components/merge/FileList.tsx`:
- Rename `PdfFileItem` to `FileItem` (same shape: `id`, `file`, `pageCount`, `sizeFormatted`)
- Accept `headerTitle` prop (e.g. "Files to merge", "Files to split") instead of hardcoded text
- Accept optional `headerHint` prop (e.g. "Drag to reorder - First file = first pages")
- Keep all the DnD overlay, stagger animation, mobile touch support as-is

### 3. `src/components/tool/ToolPageLayout.tsx` (page shell)
Extracts the shared page chrome from `MergePdf.tsx`:
- **Header** with icon, title, subtitle
- **Step indicator** (configurable steps array: `{ key, label }[]`, current step)
- **Trust badges** (configurable array shown on upload step)
- **Processing view** with spinner, progress bar, configurable message
- **Success view** with download button, stats, reset button -- all configurable via props
- Wraps children for the main content area

### 4. `src/components/tool/OutputConfig.tsx` (generic version of MergeConfig)
Move from `src/components/merge/MergeConfig.tsx`:
- Accept `extension` prop (`.pdf`, `.png`, etc.)
- Accept `title` prop (defaults to "Output Settings")
- Keep the same clean card UI

### 5. `src/components/tool/SuccessView.tsx` (generic version of MergeSuccess)
Move from `src/components/merge/MergeSuccess.tsx`:
- Accept `title` (e.g. "Merge Complete!", "Split Complete!")
- Accept `description` (replaces the hardcoded "X files merged into Y pages")
- Accept `fileName`, `onDownload`, `onReset`, `resetLabel` props

### 6. `src/components/tool/ProcessingView.tsx`
Extract the merging/processing spinner UI:
- Accept `title`, `subtitle`, `progress` props

### 7. `src/components/tool/StepIndicator.tsx`
Extract the step pills into its own component:
- Accept `steps: { key: string; label: string }[]` and `currentStep: string`

### 8. `src/components/tool/TrustBadges.tsx`
Extract the trust badges row:
- Accept `badges: { icon: LucideIcon; label: string }[]`

## Utility to Extract

### `src/lib/file-utils.ts`
- `formatFileSize(bytes)` -- move from MergePdf
- `generateId()` -- move from MergePdf
- `staggerAddFiles(items, setFiles, options?)` -- the staggered entrance logic

## Refactor MergePdf

Update `src/pages/MergePdf.tsx` to import and use all the new reusable components, keeping only the merge-specific PDF logic (the `handleMerge` function using `pdf-lib`). The page should shrink significantly.

## Keep merge/ aliases (optional)
Keep `src/components/merge/` files as thin re-exports of the new `tool/` components with merge-specific defaults, or just update imports directly. Simpler to update imports directly.

---

## Technical Notes

- No new dependencies needed -- everything uses existing `@dnd-kit`, `lucide-react`, and Tailwind
- All components remain client-side only, no backend changes
- The `FileDropZone` `accept` prop maps directly to the HTML `<input accept="">` attribute and the drag-drop MIME filter
- The stagger logic moves to `file-utils.ts` as a standalone async function: `staggerAddFiles(items, setter, maxDuration=2000, maxDelay=400)`
