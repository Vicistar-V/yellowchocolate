

# Fix: Complete Integration of All 4 Converters

## Critical Bug Found

The drag-and-drop functionality is broken for Word, Excel, PowerPoint, and HTML converters. Files can only be added via the click-to-browse button -- dragging files onto the drop zone silently rejects them.

**Root cause**: `FileDropZone.tsx` line 39 filters dropped files by comparing `f.type` (a MIME type like `application/pdf`) against each comma-separated token in the `accept` prop. But the new converters pass accept strings containing file extensions (`.docx`, `.xlsx`, `.pptx`, `.html`) alongside MIME types. Extensions never match `f.type`, so files are rejected.

## Changes

### 1. Fix FileDropZone drag-and-drop filtering (src/components/tool/FileDropZone.tsx)

Update the `handleDrop` filter to also match by file extension when the accept token starts with `.`:

```
// Current (broken for extensions):
return accept.split(",").some((a) => f.type === a.trim());

// Fixed:
return accept.split(",").some((a) => {
  const token = a.trim();
  if (token.startsWith(".")) {
    return f.name.toLowerCase().endsWith(token.toLowerCase());
  }
  return f.type === token;
});
```

### 2. Clean up PowerPointToPdf.tsx unused variables

- Remove unused `textMatches` (line 56) and `currentParagraph` (line 57) declarations.

### 3. Fix memory leak in PowerPointToPdf.tsx slide image rendering

- Track blob URLs created for slide images and revoke them in the `finally` block (after line 186).

### Files Modified

| File | Change |
|------|--------|
| `src/components/tool/FileDropZone.tsx` | Fix drag-and-drop to support file extension matching |
| `src/pages/PowerPointToPdf.tsx` | Remove unused variables, fix blob URL memory leak |

