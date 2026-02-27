

# Fix: Complete Integration of All PDF Tools

## Issues Found

1. **Homepage (Index.tsx) is outdated** -- Split PDF is marked `enabled: false` and the 3 new tools (Remove Pages, Extract Pages, Organize Pages) are missing entirely from the homepage grid.

2. **Global mutable ID counter in OrganizePages** -- The `let nextId = 1` at module scope won't reset between navigations, which can cause unexpected behavior. Should use a ref or inline ID generation.

3. **Silent PDF load failures** -- All three new tools catch PDF read errors with only `console.error`. Users get zero feedback when they upload a corrupt or non-PDF file. Should show a toast notification.

---

## Changes

### 1. Update Homepage (src/pages/Index.tsx)

- Set Split PDF to `enabled: true` with correct URL `/split-pdf`
- Add Remove Pages, Extract Pages, and Organize Pages to the highlights grid with `enabled: true`
- Update URLs for any existing entries that don't match actual routes

### 2. Fix OrganizePages ID generation (src/pages/OrganizePages.tsx)

- Replace the module-level `let nextId` with `crypto.randomUUID()` or the existing `generateId()` utility from `file-utils.ts`

### 3. Add user-facing error toasts (all 3 new pages)

- Import `useToast` or `toast` from sonner
- Replace `console.error("Could not read PDF")` with a toast notification so users know the file couldn't be read
- Apply same pattern to the processing `catch` blocks

### Files Modified

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Enable Split PDF, add 3 new tools to grid |
| `src/pages/OrganizePages.tsx` | Fix ID generation, add error toasts |
| `src/pages/RemovePages.tsx` | Add error toasts for failed PDF reads |
| `src/pages/ExtractPages.tsx` | Add error toasts for failed PDF reads |

