# PDF Tools

A browser-based PDF toolkit — merge, arrange, and download PDFs without uploading anything to a server. All processing happens client-side using [pdf-lib](https://github.com/Hopding/pdf-lib).

## Features

- **Merge PDF** — Combine multiple PDFs into a single document with drag-and-drop reordering
- **Drag & Drop Upload** — Drop files or click to browse, with staggered entrance animations
- **Sortable File List** — Reorder files via drag-and-drop (desktop & mobile touch support)
- **100% Client-Side** — No files are uploaded; everything runs in the browser
- **Reusable Tool Framework** — Generic `src/components/tool/` components make it easy to add new tools

## Project Structure

```
src/
├── components/
│   ├── tool/               # Reusable tool page components
│   │   ├── FileDropZone    # Configurable file upload drop zone
│   │   ├── FileList        # Sortable file list with DnD
│   │   ├── ToolPageLayout  # Page shell (header, steps, badges)
│   │   ├── StepIndicator   # Step progress pills
│   │   ├── TrustBadges     # Trust signal badges
│   │   ├── ProcessingView  # Spinner + progress bar
│   │   ├── SuccessView     # Download + reset screen
│   │   └── OutputConfig    # Output filename input
│   └── ui/                 # shadcn/ui primitives
├── lib/
│   ├── utils.ts            # Tailwind merge helper
│   └── file-utils.ts       # formatFileSize, generateId, staggerAddFiles
├── pages/
│   ├── Index.tsx           # Home page
│   └── MergePdf.tsx        # Merge PDF tool
└── main.tsx
```

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** — dev server & build
- **Tailwind CSS** + **shadcn/ui** — styling & components
- **pdf-lib** — client-side PDF manipulation
- **@dnd-kit** — drag-and-drop sorting
- **React Router** — client-side routing

## Getting Started

```sh
# Clone the repo
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm install

# Start dev server
npm run dev
```

## Adding a New Tool

1. Create a new page in `src/pages/` (e.g. `SplitPdf.tsx`)
2. Import components from `src/components/tool/` — `ToolPageLayout`, `FileDropZone`, `FileList`, etc.
3. Add your tool-specific logic; the UI framework handles upload, progress, and success states
4. Register the route in `src/App.tsx`

## Deployment

Open [Lovable](https://lovable.dev) and click **Share → Publish**, or build locally with `npm run build`.
