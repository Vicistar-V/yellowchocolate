import { useState, useCallback, useRef, useEffect } from "react";
import { PDFDocument, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import {
  EyeOff, ShieldCheck, Zap, ArrowRight, Download,
  FileText, CheckCircle2, RotateCcw, ChevronLeft, ChevronRight,
  Trash2, Undo2, AlertTriangle,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId, type FileItem } from "@/lib/file-utils";
import { downloadBlob } from "@/lib/download-utils";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "redact" | "processing" | "done";

interface RedactRect {
  id: string;
  pageIndex: number;
  x: number; // percentage of preview width
  y: number;
  w: number;
  h: number;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "redact", label: "2. Redact" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Client-side only" },
] as const;

export default function RedactPdf() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<FileItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<{ name: string; blob: Blob } | null>(null);

  // Pages
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pageDims, setPageDims] = useState<{ w: number; h: number }[]>([]);

  // Redaction
  const [rects, setRects] = useState<RedactRect[]>([]);
  const [redactColor, setRedactColor] = useState<"black" | "white">("black");
  const [selectedRect, setSelectedRect] = useState<string | null>(null);

  // Drawing
  const previewRef = useRef<HTMLDivElement>(null);
  const [isDrawingRect, setIsDrawingRect] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Load PDF
  const loadPages = useCallback(async (f: File) => {
    const buffer = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const images: string[] = [];
    const dims: { w: number; h: number }[] = [];
    setTotalPages(pdf.numPages);

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      dims.push({ w: vp.width, h: vp.height });
      const scale = 600 / vp.width;
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      images.push(canvas.toDataURL("image/png"));
    }
    pdf.destroy();
    setPageImages(images);
    setPageDims(dims);
  }, []);

  const handleFilesSelected = useCallback(async (newFiles: File[]) => {
    const pdfFile = newFiles.find(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (!pdfFile) {
      toast.error("Please select a PDF file");
      return;
    }
    const item: FileItem = {
      id: generateId(),
      file: pdfFile,
      pageCount: null,
      sizeFormatted: formatFileSize(pdfFile.size),
    };
    setFile(item);
    setStep("redact");
    await loadPages(pdfFile);
  }, [loadPages]);

  // Get mouse position as percentage
  const getRelPos = useCallback((e: React.MouseEvent) => {
    const el = previewRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setSelectedRect(null);
    const pos = getRelPos(e);
    setDrawStart(pos);
    setDrawCurrent(pos);
    setIsDrawingRect(true);
  }, [getRelPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawingRect) return;
    setDrawCurrent(getRelPos(e));
  }, [isDrawingRect, getRelPos]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawingRect || !drawStart || !drawCurrent) {
      setIsDrawingRect(false);
      return;
    }
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);

    if (w > 1 && h > 1) {
      setRects((prev) => [...prev, { id: generateId(), pageIndex: currentPage, x, y, w, h }]);
    }
    setIsDrawingRect(false);
    setDrawStart(null);
    setDrawCurrent(null);
  }, [isDrawingRect, drawStart, drawCurrent, currentPage]);

  const removeRect = useCallback((id: string) => {
    setRects((prev) => prev.filter((r) => r.id !== id));
    setSelectedRect(null);
  }, []);

  const undoLast = useCallback(() => {
    setRects((prev) => prev.slice(0, -1));
  }, []);

  // Keyboard delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRect) {
        removeRect(selectedRect);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRect, removeRect]);

  const currentPageRects = rects.filter((r) => r.pageIndex === currentPage);

  // Page summary
  const pageSummary = Array.from({ length: totalPages }, (_, i) => ({
    page: i + 1,
    count: rects.filter((r) => r.pageIndex === i).length,
  })).filter((s) => s.count > 0);

  // Process
  const handleProcess = useCallback(async () => {
    if (!file || rects.length === 0) {
      toast.error("Please draw redaction areas first");
      return;
    }
    setStep("processing");
    setProgress(0);

    try {
      const buffer = await file.file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const fillColor = redactColor === "black" ? rgb(0, 0, 0) : rgb(1, 1, 1);

      for (let pi = 0; pi < pages.length; pi++) {
        const pageRects = rects.filter((r) => r.pageIndex === pi);
        if (pageRects.length === 0) continue;
        const page = pages[pi];
        const { width, height } = page.getSize();

        for (const rect of pageRects) {
          const pdfX = (rect.x / 100) * width;
          const pdfW = (rect.w / 100) * width;
          const pdfH = (rect.h / 100) * height;
          const pdfY = height - (rect.y / 100) * height - pdfH;

          page.drawRectangle({
            x: pdfX,
            y: pdfY,
            width: pdfW,
            height: pdfH,
            color: fillColor,
          });
        }
        setProgress(Math.round(((pi + 1) / pages.length) * 80));
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const name = file.file.name.replace(/\.pdf$/i, "_redacted.pdf");

      setProgress(100);
      setResultBlob({ name, blob });
      setStep("done");
      toast.success("PDF redacted successfully!");
    } catch (err) {
      console.error("Redact failed:", err);
      toast.error("Failed to redact PDF");
      setStep("redact");
    }
  }, [file, rects, redactColor]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResultBlob(null);
    setRects([]);
    setPageImages([]);
    setCurrentPage(0);
    setProgress(0);
    setSelectedRect(null);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["redact"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  // Drawing preview rect
  const drawingRect = isDrawingRect && drawStart && drawCurrent
    ? {
        x: Math.min(drawStart.x, drawCurrent.x),
        y: Math.min(drawStart.y, drawCurrent.y),
        w: Math.abs(drawCurrent.x - drawStart.x),
        h: Math.abs(drawCurrent.y - drawStart.y),
      }
    : null;

  return (
    <ToolPageLayout
      icon={EyeOff}
      title="Redact PDF"
      subtitle="Cover sensitive content with opaque rectangles"
      steps={STEPS}
      currentStep={step === "processing" ? "redact" : step}
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
          title={isDragging ? "Drop your PDF here!" : "Drag & drop a PDF file here"}
          subtitle="PDF file · Single file"
          buttonLabel="Select PDF File"
          dragIcon={EyeOff}
        />
      )}

      {/* Redact step */}
      {step === "redact" && (
        <div className="space-y-5 animate-fade-in">
          {/* Disclaimer */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-accent/10 border border-accent/20">
            <AlertTriangle className="w-4 h-4 text-accent mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              This tool places opaque rectangles over selected areas. The underlying text data may still exist in the PDF structure. For full data removal, use a desktop redaction tool.
            </p>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Redaction color:</span>
              <button
                onClick={() => setRedactColor("black")}
                className={`w-7 h-7 rounded-full border-2 transition-all bg-black ${redactColor === "black" ? "border-primary scale-110" : "border-border"}`}
                title="Black"
              />
              <button
                onClick={() => setRedactColor("white")}
                className={`w-7 h-7 rounded-full border-2 transition-all bg-white ${redactColor === "white" ? "border-primary scale-110" : "border-border"}`}
                title="White"
              />
            </div>

            <button
              onClick={undoLast}
              disabled={rects.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium text-muted-foreground hover:bg-muted transition-all disabled:opacity-30"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo last
            </button>

            {/* Page nav */}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <button
                onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>Page {currentPage + 1} of {totalPages}</span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                disabled={currentPage >= totalPages - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Page preview with drawing */}
          <div
            ref={previewRef}
            className="relative border rounded-lg overflow-hidden cursor-crosshair bg-white mx-auto select-none"
            style={{
              maxWidth: 600,
              aspectRatio: pageDims[currentPage] ? `${pageDims[currentPage].w} / ${pageDims[currentPage].h}` : "612 / 792",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {pageImages[currentPage] && (
              <img
                src={pageImages[currentPage]}
                alt={`Page ${currentPage + 1}`}
                className="w-full h-full object-contain pointer-events-none"
              />
            )}

            {/* Existing rects */}
            {currentPageRects.map((rect) => (
              <div
                key={rect.id}
                className={`absolute border-2 transition-colors cursor-pointer ${
                  selectedRect === rect.id
                    ? "border-destructive"
                    : "border-destructive/60"
                }`}
                style={{
                  left: `${rect.x}%`,
                  top: `${rect.y}%`,
                  width: `${rect.w}%`,
                  height: `${rect.h}%`,
                  backgroundColor: redactColor === "black" ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.7)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRect(rect.id === selectedRect ? null : rect.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {selectedRect === rect.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeRect(rect.id); }}
                    className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}

            {/* Currently drawing rect */}
            {drawingRect && (
              <div
                className="absolute border-2 border-dashed border-destructive"
                style={{
                  left: `${drawingRect.x}%`,
                  top: `${drawingRect.y}%`,
                  width: `${drawingRect.w}%`,
                  height: `${drawingRect.h}%`,
                  backgroundColor: redactColor === "black" ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.4)",
                }}
              />
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Click and drag on the page to draw redaction areas. Click a rectangle to select it, then press Delete to remove.
          </p>

          {/* Summary */}
          {pageSummary.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pageSummary.map((s) => (
                <span
                  key={s.page}
                  className="text-xs bg-destructive/10 text-destructive px-2.5 py-1 rounded-full font-medium"
                >
                  Page {s.page}: {s.count} area{s.count > 1 ? "s" : ""}
                </span>
              ))}
            </div>
          )}

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={rects.length === 0}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <EyeOff className="w-5 h-5" />
            Redact {rects.length} Area{rects.length !== 1 ? "s" : ""}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Redacting PDF..."
          subtitle="Applying redaction overlays"
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && resultBlob && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              PDF Redacted!
            </h2>
            <p className="text-muted-foreground text-sm">Sensitive content has been covered.</p>
          </div>

          <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{resultBlob.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(resultBlob.blob.size)}</p>
            </div>
            <button
              onClick={() => downloadBlob(resultBlob.blob, resultBlob.name)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:shadow-md transition-all"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          </div>

          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium text-foreground hover:bg-muted transition-all"
          >
            <RotateCcw className="w-4 h-4" /> Redact Another PDF
          </button>
        </div>
      )}
    </ToolPageLayout>
  );
}
