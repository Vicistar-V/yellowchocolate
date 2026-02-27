

# Inspection Report: Edit PDF -- All 4 Tools

## Verdict: Fully implemented with 1 bug to fix

All 4 Edit PDF tools are complete, with proper routes in `App.tsx`, enabled sidebar entries in `AppSidebar.tsx`, and homepage tiles in `Index.tsx`.

### Integration Checklist (all correct)

| Check | Status |
|-------|--------|
| `App.tsx` routes for all 4 tools | Complete |
| `AppSidebar.tsx` sidebar entries (all enabled) | Complete |
| `Index.tsx` homepage tiles (all enabled) | Complete |

### Individual Tool Status

| Tool | File | Status |
|------|------|--------|
| Rotate PDF | `RotatePdf.tsx` | Complete -- real-time thumbnail rotation, per-file and batch controls, select/deselect, reset |
| Add Page Numbers | `AddPageNumbers.tsx` | Complete -- 6 positions, 4 formats, font size, start number, margin controls |
| Add Watermark | `AddWatermark.tsx` | Complete -- text/image modes, 5 positions, opacity, color, image scale |
| Crop PDF | `CropPdf.tsx` | Complete -- live preview with red overlay, presets, uniform/independent margins |

### Bug Found: Dynamic Tailwind classes in AddPageNumbers position grid

In `AddPageNumbers.tsx` (line 280), the position selector buttons use dynamically constructed Tailwind classes like:

```
items-${pos.row === "top" ? "start" : "end"}
justify-${pos.col === "left" ? "start" : pos.col === "right" ? "end" : "center"}
```

Tailwind's JIT compiler cannot detect dynamically constructed class names. These classes will be purged from the build, meaning the position buttons won't align correctly -- they'll all default to the same position instead of visually representing top-left, top-right, bottom-center, etc.

### Fix

Replace the dynamic class construction with a lookup map that uses full, static class strings:

```typescript
const alignmentClasses: Record<Position, string> = {
  "top-left": "items-start justify-start",
  "top-center": "items-start justify-center",
  "top-right": "items-start justify-end",
  "bottom-left": "items-end justify-start",
  "bottom-center": "items-end justify-center",
  "bottom-right": "items-end justify-end",
};
```

Then use `alignmentClasses[pos.value]` in the button className.

### Unused imports (cosmetic only)

- `RotatePdf.tsx` line 7: `RotateCcwIcon` is imported but never used
- `AddPageNumbers.tsx` line 55: `FONT_SIZES` is declared but never used
- `CropPdf.tsx` line 62: `canvasRef` is declared but never used

### Changes

| File | Change |
|------|--------|
| `src/pages/AddPageNumbers.tsx` | Fix dynamic Tailwind classes with static lookup map |
| `src/pages/RotatePdf.tsx` | Remove unused `RotateCcwIcon` import |
| `src/pages/AddPageNumbers.tsx` | Remove unused `FONT_SIZES` constant |
| `src/pages/CropPdf.tsx` | Remove unused `canvasRef` |

