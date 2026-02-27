import { useState, useCallback, useEffect, useRef } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import JSZip from "jszip";
import {
  RotateCw, RotateCcw, ShieldCheck, Zap, ArrowRight, Files,
  Download, Trash2, FileText, RefreshCw, CheckCircle2, RotateCcwIcon,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId } from "@/lib/file-utils";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "configure" | "processing" | "done";

interface PdfItem {
  id: string;
  file: File;
  pageCount: number;
  sizeFormatted: string;
  rotation: number; // 0, 90, 180, 270
  thumbnailUrl: string | null;
  selected: boolean;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Rotate" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Files, label: "Batch support" },
] as const;

async function renderFirstPageThumbnail(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 0.5 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  const url = canvas.toDataURL("image/jpeg", 0.7);
  pdf.destroy();
  return url;
}

export default function RotatePdf() {
  const [step, setStep] = useState<Step>("upload");
  const [items, setItems] = useState<PdfItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlobs, setResultBlobs] = useState<{ name: string; blob: Blob }[]>([]);

  const handleFilesSelected = useCallback(async (newFiles: File[]) => {
    const pdfFiles = newFiles.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfFiles.length === 0) {
      toast.error("Please select PDF files");
      return;
    }

    const newItems: PdfItem[] = [];
    for (const file of pdfFiles) {
      try {
        const buffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const thumbnail = await renderFirstPageThumbnail(file);
        newItems.push({
          id: generateId(),
          file,
          pageCount: pdfDoc.getPageCount(),
          sizeFormatted: formatFileSize(file.size),
          rotation: 0,
          thumbnailUrl: thumbnail,
          selected: false,
        });
      } catch {
        toast.error(`Failed to read: ${file.name}`);
      }
    }

    setItems((prev) => [...prev, ...newItems]);
    setStep("configure");
  }, []);

  const rotateItem = useCallback((id: string, direction: 90 | -90) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, rotation: (item.rotation + direction + 360) % 360 }
          : item
      )
    );
  }, []);

  const rotateSelected = useCallback((direction: 90 | -90) => {
    setItems((prev) => {
      const anySelected = prev.some((i) => i.selected);
      return prev.map((item) =>
        anySelected
          ? item.selected
            ? { ...item, rotation: (item.rotation + direction + 360) % 360 }
            : item
          : { ...item, rotation: (item.rotation + direction + 360) % 360 }
      );
    });
  }, []);

  const rotateAll = useCallback((direction: 90 | -90) => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        rotation: (item.rotation + direction + 360) % 360,
      }))
    );
  }, []);

  const resetAll = useCallback(() => {
    setItems((prev) => prev.map((item) => ({ ...item, rotation: 0 })));
  }, []);

  const resetItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, rotation: 0 } : item))
    );
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  }, []);

  const selectAll = useCallback(() => {
    setItems((prev) => {
      const allSelected = prev.every((i) => i.selected);
      return prev.map((item) => ({ ...item, selected: !allSelected }));
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (next.length === 0) setStep("upload");
      return next;
    });
  }, []);

  const hasRotations = items.some((i) => i.rotation !== 0);
  const selectedCount = items.filter((i) => i.selected).length;

  const handleProcess = useCallback(async () => {
    if (!hasRotations) {
      toast.info("No rotations applied", { description: "Rotate at least one PDF first." });
      return;
    }
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();
    const results: { name: string; blob: Blob }[] = [];

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const buffer = await item.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

        if (item.rotation !== 0) {
          const pages = pdfDoc.getPages();
          for (const page of pages) {
            const currentRotation = page.getRotation().angle;
            page.setRotation(degrees(currentRotation + item.rotation));
          }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const name = item.file.name.replace(/\.pdf$/i, "_rotated.pdf");
        results.push({ name, blob });
        setProgress(Math.round(((i + 1) / items.length) * 90));
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < 800) {
        setProgress(95);
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
      setProgress(100);
      setResultBlobs(results);
      setStep("done");
      toast.success(`Rotated ${results.length} PDF${results.length > 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Rotate failed:", err);
      toast.error("Rotation failed");
      setStep("configure");
    }
  }, [items, hasRotations]);

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
    a.download = "rotated-pdfs.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlobs, downloadSingle]);

  const handleReset = useCallback(() => {
    setItems([]);
    setResultBlobs([]);
    setProgress(0);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const rotationLabel = (deg: number) => {
    if (deg === 0) return "Original";
    return `${deg}°`;
  };

  return (
    <ToolPageLayout
      icon={RotateCw}
      title="Rotate PDF"
      subtitle="Fix page orientation with real-time preview — rotate individual or all PDFs"
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
          dragIcon={RotateCw}
        />
      )}

      {/* Configure / Rotate */}
      {step === "configure" && (
        <div className="space-y-5">
          {/* Batch controls */}
          <div className="bg-card border rounded-xl p-4 flex flex-wrap items-center gap-3 animate-fade-in">
            <span className="text-sm font-semibold text-foreground mr-auto" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {items.length} PDF{items.length > 1 ? "s" : ""} loaded
              {selectedCount > 0 && ` · ${selectedCount} selected`}
            </span>
            <button
              onClick={selectAll}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium text-foreground hover:bg-muted transition-all"
            >
              {items.every((i) => i.selected) ? "Deselect All" : "Select All"}
            </button>
            <button
              onClick={() => rotateSelected(-90)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium text-foreground hover:bg-muted transition-all"
              title="Rotate left"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Left
            </button>
            <button
              onClick={() => rotateSelected(90)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium text-foreground hover:bg-muted transition-all"
              title="Rotate right"
            >
              <RotateCw className="w-3.5 h-3.5" /> Right
            </button>
            <button
              onClick={resetAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium text-muted-foreground hover:bg-muted transition-all"
              title="Reset all rotations"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset All
            </button>
          </div>

          {/* PDF cards with thumbnails */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className={`relative bg-card border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md animate-fade-in ${
                  item.selected ? "ring-2 ring-primary border-primary" : ""
                }`}
              >
                {/* Selection checkbox */}
                <button
                  onClick={() => toggleSelect(item.id)}
                  className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                    item.selected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "bg-card/80 border-border backdrop-blur-sm hover:border-primary/50"
                  }`}
                >
                  {item.selected && <CheckCircle2 className="w-4 h-4" />}
                </button>

                {/* Remove button */}
                <button
                  onClick={() => removeItem(item.id)}
                  className="absolute top-2 right-2 z-10 w-6 h-6 rounded-md bg-card/80 backdrop-blur-sm border flex items-center justify-center hover:bg-destructive/10 hover:border-destructive/30 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </button>

                {/* Thumbnail with rotation preview */}
                <div className="aspect-[3/4] bg-muted flex items-center justify-center overflow-hidden p-3">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.file.name}
                      className="max-w-full max-h-full object-contain transition-transform duration-500 ease-out"
                      style={{ transform: `rotate(${item.rotation}deg)` }}
                    />
                  ) : (
                    <FileText className="w-10 h-10 text-muted-foreground" />
                  )}
                </div>

                {/* Info + rotation controls */}
                <div className="p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground truncate" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>{item.sizeFormatted}</span>
                    <span>·</span>
                    <span>{item.pageCount} pg{item.pageCount > 1 ? "s" : ""}</span>
                    {item.rotation !== 0 && (
                      <>
                        <span>·</span>
                        <span className="text-primary font-semibold">{rotationLabel(item.rotation)}</span>
                      </>
                    )}
                  </div>

                  {/* Rotation buttons */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => rotateItem(item.id, -90)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium text-foreground hover:bg-muted hover:border-primary/30 transition-all"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => rotateItem(item.id, 90)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium text-foreground hover:bg-muted hover:border-primary/30 transition-all"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    {item.rotation !== 0 && (
                      <button
                        onClick={() => resetItem(item.id)}
                        className="px-2 py-1.5 rounded-lg border text-xs font-medium text-muted-foreground hover:bg-muted transition-all"
                        title="Reset"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add more */}
          <FileDropZone
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf,.pdf"
            title={isDragging ? "Drop more!" : "Add more PDFs"}
            buttonLabel="Add More"
            dragIcon={RotateCw}
          />

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={!hasRotations}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <RotateCw className="w-5 h-5" />
            Apply Rotation{items.length > 1 ? "s" : ""}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Rotating PDFs..."
          subtitle={`Processing ${items.length} file${items.length > 1 ? "s" : ""}`}
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
              Rotation Complete!
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {resultBlobs.length} PDF{resultBlobs.length > 1 ? "s" : ""} rotated successfully
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={downloadAll}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Download className="w-5 h-5" />
                {resultBlobs.length === 1 ? `Download ${resultBlobs[0].name}` : "Download All (.zip)"}
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-5 py-3 rounded-xl border bg-card text-foreground font-medium hover:bg-muted transition-all duration-200"
              >
                <RefreshCw className="w-4 h-4" />
                Start Over
              </button>
            </div>
          </div>

          {/* Individual downloads for multi-file */}
          {resultBlobs.length > 1 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Individual Files
              </h3>
              {resultBlobs.map((r, idx) => (
                <button
                  key={idx}
                  onClick={() => downloadSingle(r)}
                  className="w-full flex items-center gap-3 bg-card border rounded-xl px-4 py-3 hover:shadow-md hover:border-primary/30 transition-all animate-fade-in"
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate flex-1 text-left">{r.name}</span>
                  <Download className="w-4 h-4 text-primary shrink-0" />
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground/60 text-center">
            Everything processed in your browser — nothing was uploaded.
          </p>
        </div>
      )}
    </ToolPageLayout>
  );
}
