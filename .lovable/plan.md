

# PDF Security Tools: Unlock PDF and Protect PDF

## Overview
Implement two new tools in the PDF Security category, following the existing codebase patterns (ToolPageLayout, FileDropZone, ProcessingView, SuccessView, step-based flow).

---

## 1. Unlock PDF (`src/pages/UnlockPdf.tsx`)

**Purpose**: Remove password protection from encrypted PDFs.

**Flow**:
1. **Upload step** -- User drops one or more password-protected PDFs
2. **Configure step** -- For each file, show a password input field. User enters the password for each PDF. A "Try" button verifies the password works before processing.
3. **Processing step** -- Open each PDF with the provided password using `pdf-lib` (`PDFDocument.load(bytes, { password })`), then re-save without encryption.
4. **Done step** -- Download individual unlocked PDFs or all as ZIP.

**Key features**:
- Per-file password entry (different PDFs may have different passwords)
- Visual feedback: lock icon turns to unlock icon when password verified
- Error handling for wrong passwords with clear messaging
- Batch support with ZIP download

---

## 2. Protect PDF (`src/pages/ProtectPdf.tsx`)

**Purpose**: Add password encryption to PDFs.

**Flow**:
1. **Upload step** -- User drops one or more PDFs
2. **Configure step** -- User sets:
   - **User password** (required to open the PDF)
   - **Owner password** (optional, controls permissions)
   - **Permissions checkboxes**: printing, copying, modifying (visual only -- `pdf-lib` applies basic encryption)
   - Password strength indicator
   - Confirm password field with match validation
3. **Processing step** -- Encrypt each PDF using `pdf-lib`'s `PDFDocument.save({ userPassword, ownerPassword, permissions })`.
4. **Done step** -- Download protected PDFs individually or as ZIP.

**Key features**:
- Password strength meter (weak/medium/strong)
- Show/hide password toggle
- Same password applied to all files in batch
- Permission toggles for printing, copying, modifying

---

## 3. Integration Changes

| File | Change |
|------|--------|
| `src/pages/UnlockPdf.tsx` | New file |
| `src/pages/ProtectPdf.tsx` | New file |
| `src/App.tsx` | Add routes: `/unlock` and `/protect` |
| `src/components/AppSidebar.tsx` | Enable Unlock PDF and Protect PDF (`enabled: true`) |
| `src/pages/Index.tsx` | Add Unlock PDF tile (enabled), update Protect PDF tile URL and enable it |

---

## Technical Notes

- **pdf-lib** is already installed and supports password encryption/decryption natively via `PDFDocument.load({ password })` and `PDFDocument.save({ userPassword, ownerPassword, permissions })`.
- No new dependencies needed.
- Both tools follow the same 4-step pattern (upload, configure, processing, done) used across the entire app.

