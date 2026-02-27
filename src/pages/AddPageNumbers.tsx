import { useState, useCallback } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
import {
  Hash, ShieldCheck, Zap, ArrowRight, Files, Download,
  FileText, CheckCircle2, RotateCcw,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { toast } from "sonner";

type Step = "upload" | "configure" | "processing" | "done";

type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

type NumberFormat = "plain" | "dash" | "parentheses" | "page-of";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Settings" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Files, label: "Batch support" },
] as const;

const POSITIONS: { value: Position; label: string; row: "top" | "bottom"; col: "left" | "center" | "right" }[] = [
  { value: "top-left", label: "Top Left", row: "top", col: "left" },
  { value: "top-center", label: "Top Center", row: "top", col: "center" },
  { value: "top-right", label: "Top Right", row: "top", col: "right" },
  { value: "bottom-left", label: "Bottom Left", row: "bottom", col: "left" },
  { value: "bottom-center", label: "Bottom Center", row: "bottom", col: "center" },
  { value: "bottom-right", label: "Bottom Right", row: "bottom", col: "right" },
];

const FORMAT_OPTIONS: { value: NumberFormat; label: string; preview: (n: number, total: number) => string }[] = [
  { value: "plain", label: "1", preview: (n) => `${n}` },
  { value: "dash", label: "- 1 -", preview: (n) => `- ${n} -` },
  { value: "parentheses", label: "(1)", preview: (n) => `(${n})` },
  { value: "page-of", label: "Page 1 of N", preview: (n, t) => `Page ${n} of ${t}` },
];

const ALIGNMENT_CLASSES: Record<Position, string> = {
  "top-left": "items-start justify-start",
  "top-center": "items-start justify-center",
  "top-right": "items-start justify-end",
  "bottom-left": "items-end justify-start",
  "bottom-center": "items-end justify-center",
  "bottom-right": "items-end justify-end",
};

export default function AddPageNumbers() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlobs, setResultBlobs] = useState<{ name: string; blob: Blob }[]>([]);

  // Settings
  const [position, setPosition] = useState<Position>("bottom-center");
  const [format, setFormat] = useState<NumberFormat>("plain");
  const [fontSize, setFontSize] = useState(12);
  const [startNumber, setStartNumber] = useState(1);
  const [margin, setMargin] = useState(30);

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      const pdfFiles = newFiles.filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfFiles.length === 0) {
        toast.error("Please select PDF files");
        return;
      }
      const items: FileItem[] = pdfFiles.map((file) => ({
        id: generateId(),
        file,
        pageCount: null,
        sizeFormatted: formatFileSize(file.size),
      }));
      if (step === "upload") setStep("configure");
      await staggerAddFiles(items, setFiles);
    },
    [step]
  );

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (next.length === 0) setStep("upload");
      return next;
    });
  }, []);

  const formatPageNumber = useCallback(
    (pageNum: number, totalPages: number) => {
      const formatOpt = FORMAT_OPTIONS.find((f) => f.value === format)!;
      return formatOpt.preview(pageNum, totalPages);
    },
    [format]
  );

  const handleProcess = useCallback(async () => {
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();
    const results: { name: string; blob: Blob }[] = [];

    try {
      for (let fi = 0; fi < files.length; fi++) {
        const fileItem = files[fi];
        const buffer = await fileItem.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const pages = pdfDoc.getPages();
        const totalPages = pages.length;

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          const { width, height } = page.getSize();
          const pageNum = startNumber + i;
          const text = formatPageNumber(pageNum, totalPages + startNumber - 1);
          const textWidth = font.widthOfTextAtSize(text, fontSize);

          // Calculate X position
          let x: number;
          const posInfo = POSITIONS.find((p) => p.value === position)!;
          if (posInfo.col === "left") x = margin;
          else if (posInfo.col === "right") x = width - textWidth - margin;
          else x = (width - textWidth) / 2;

          // Calculate Y position
          let y: number;
          if (posInfo.row === "top") y = height - margin;
          else y = margin;

          page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(0.3, 0.3, 0.3),
          });
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const name = fileItem.file.name.replace(/\.pdf$/i, "_numbered.pdf");
        results.push({ name, blob });
        setProgress(Math.round(((fi + 1) / files.length) * 90));
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < 800) {
        setProgress(95);
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
      setProgress(100);
      setResultBlobs(results);
      setStep("done");
      toast.success(`Added page numbers to ${results.length} PDF${results.length > 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Page numbering failed:", err);
      toast.error("Failed to add page numbers");
      setStep("configure");
    }
  }, [files, position, format, fontSize, startNumber, margin, formatPageNumber]);

  const downloadSingle = useCallback((result: { name: string; blob: Blob }) => {
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadAll = useCallback(async () => {
    if (resultBlobs.length === 1) {
      downloadSingle(resultBlobs[0]);
      return;
    }
    const zip = new JSZip();
    resultBlobs.forEach((r) => zip.file(r.name, r.blob));
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "numbered-pdfs.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlobs, downloadSingle]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setResultBlobs([]);
    setProgress(0);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const currentFormatPreview = FORMAT_OPTIONS.find((f) => f.value === format)!;

  return (
    <ToolPageLayout
      icon={Hash}
      title="Add Page Numbers"
      subtitle="Number your PDF pages with custom positioning and formatting"
      steps={STEPS}
      currentStep={step === "processing" ? "configure" : step}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {/* Upload */}
      {step === "upload" && (
        <FileDropZone
          onFilesSelected={handleFilesSelected}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          accept="application/pdf,.pdf"
          title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
          subtitle="PDF files · Multiple files supported"
          buttonLabel="Select PDF Files"
          dragIcon={Hash}
        />
      )}

      {/* Configure */}
      {step === "configure" && (
        <div className="space-y-5">
          <FileList
            files={files}
            onRemove={handleRemove}
            onReorder={setFiles}
            headerTitle="PDFs to number"
            headerHint="Drag to reorder"
          />

          <FileDropZone
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf,.pdf"
            title={isDragging ? "Drop more!" : "Add more PDFs"}
            buttonLabel="Add More"
            dragIcon={Hash}
          />

          {/* Settings */}
          <div className="bg-card border rounded-xl p-5 animate-fade-in space-y-6">
            <div className="flex items-center gap-2 mb-1">
              <Hash className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Number Settings
              </h3>
            </div>

            {/* Position selector - visual grid */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-3 block">Position</label>
              <div className="relative bg-muted/50 border rounded-xl p-1 max-w-xs mx-auto aspect-[8.5/11]">
                {/* Visual page representation */}
                <div className="absolute inset-3 border border-dashed border-border/50 rounded-lg" />
                <div className="absolute inset-0 grid grid-rows-2 grid-cols-3 gap-1 p-2">
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos.value}
                      onClick={() => setPosition(pos.value)}
                      className={`flex ${ALIGNMENT_CLASSES[pos.value]} p-2 rounded-lg transition-all text-[10px] font-bold ${
                        position === pos.value
                          ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                          : "hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground"
                      }`}
                    >
                      {currentFormatPreview.preview(1, 10)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Format */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Number Format</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {FORMAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFormat(opt.value)}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                      format === opt.value
                        ? "bg-primary text-primary-foreground border-primary shadow-md"
                        : "bg-card text-foreground border-border hover:border-primary/40"
                    }`}
                  >
                    {opt.preview(1, 10)}
                  </button>
                ))}
              </div>
            </div>

            {/* Font size + Start number */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Font Size: {fontSize}pt
                </label>
                <input
                  type="range"
                  min={8}
                  max={24}
                  step={1}
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                  <span>8pt</span>
                  <span>24pt</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Start From
                </label>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={startNumber}
                  onChange={(e) => setStartNumber(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 rounded-lg border bg-card text-foreground text-sm"
                />
              </div>
            </div>

            {/* Margin */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                Margin: {margin}pt
              </label>
              <input
                type="range"
                min={10}
                max={72}
                step={1}
                value={margin}
                onChange={(e) => setMargin(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                <span>Tight</span>
                <span>Wide</span>
              </div>
            </div>
          </div>

          {/* Process button */}
          <button
            onClick={handleProcess}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Hash className="w-5 h-5" />
            Add Numbers to {files.length} PDF{files.length !== 1 ? "s" : ""}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Adding page numbers..."
          subtitle={`Processing ${files.length} file${files.length > 1 ? "s" : ""}`}
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Page Numbers Added!
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {resultBlobs.length} PDF{resultBlobs.length > 1 ? "s" : ""} numbered successfully
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={downloadAll}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Download className="w-5 h-5" />
                {resultBlobs.length === 1 ? `Download ${resultBlobs[0].name}` : "Download All (.zip)"}
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-5 py-3 rounded-xl border bg-card text-foreground font-medium hover:bg-muted transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                Start Over
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/60 text-center">
            Everything processed in your browser — nothing was uploaded.
          </p>
        </div>
      )}
    </ToolPageLayout>
  );
}
