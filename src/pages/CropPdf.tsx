import { useState, useCallback, useEffect, useRef } from "react";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import JSZip from "jszip";
import {
  Crop, ShieldCheck, Zap, ArrowRight, Files, Download,
  FileText, CheckCircle2, RotateCcw, RefreshCw, Eye,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "configure" | "processing" | "done";

interface CropMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Crop" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Files, label: "Batch support" },
] as const;

const PRESETS: { label: string; margins: CropMargins }[] = [
  { label: "None", margins: { top: 0, right: 0, bottom: 0, left: 0 } },
  { label: "Trim margins", margins: { top: 36, right: 36, bottom: 36, left: 36 } },
  { label: "Wide trim", margins: { top: 54, right: 54, bottom: 54, left: 54 } },
  { label: "Top & bottom", margins: { top: 72, right: 0, bottom: 72, left: 0 } },
  { label: "Left & right", margins: { top: 0, right: 72, bottom: 0, left: 72 } },
];

export default function CropPdf() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlobs, setResultBlobs] = useState<{ name: string; blob: Blob }[]>([]);

  // Crop settings (in PDF points; 72pt = 1 inch)
  const [margins, setMargins] = useState<CropMargins>({ top: 36, right: 36, bottom: 36, left: 36 });
  const [uniformMode, setUniformMode] = useState(true);

  // Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(612); // letter size default
  const [pageHeight, setPageHeight] = useState(792);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate preview from first page of first file
  const generatePreview = useCallback(async () => {
    if (files.length === 0) return;
    try {
      const buffer = await files[0].file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      setPageWidth(viewport.width);
      setPageHeight(viewport.height);

      const scale = 300 / viewport.width; // preview width ~300px
      const scaledVP = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaledVP.width;
      canvas.height = scaledVP.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: scaledVP }).promise;
      setPreviewUrl(canvas.toDataURL("image/jpeg", 0.8));
      pdf.destroy();
    } catch {
      // silent
    }
  }, [files]);

  useEffect(() => {
    if (step === "configure") generatePreview();
  }, [step, generatePreview]);

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

  const updateMargin = useCallback(
    (side: keyof CropMargins, value: number) => {
      if (uniformMode) {
        setMargins({ top: value, right: value, bottom: value, left: value });
      } else {
        setMargins((prev) => ({ ...prev, [side]: value }));
      }
    },
    [uniformMode]
  );

  const handleProcess = useCallback(async () => {
    const hasAnyCrop = margins.top > 0 || margins.right > 0 || margins.bottom > 0 || margins.left > 0;
    if (!hasAnyCrop) {
      toast.info("No crop applied", { description: "Adjust the margins first." });
      return;
    }

    setStep("processing");
    setProgress(0);
    const startTime = Date.now();
    const results: { name: string; blob: Blob }[] = [];

    try {
      for (let fi = 0; fi < files.length; fi++) {
        const fileItem = files[fi];
        const buffer = await fileItem.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();

        for (const page of pages) {
          const { width, height } = page.getSize();
          // Clamp margins so we don't invert the crop box
          const cropTop = Math.min(margins.top, height / 2);
          const cropBottom = Math.min(margins.bottom, height / 2);
          const cropLeft = Math.min(margins.left, width / 2);
          const cropRight = Math.min(margins.right, width / 2);

          page.setCropBox(
            cropLeft,
            cropBottom,
            width - cropLeft - cropRight,
            height - cropTop - cropBottom
          );
          // Also set media box so the crop is "hard"
          page.setMediaBox(
            cropLeft,
            cropBottom,
            width - cropLeft - cropRight,
            height - cropTop - cropBottom
          );
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const name = fileItem.file.name.replace(/\.pdf$/i, "_cropped.pdf");
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
      toast.success(`Cropped ${results.length} PDF${results.length > 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Crop failed:", err);
      toast.error("Failed to crop PDF");
      setStep("configure");
    }
  }, [files, margins]);

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
    a.download = "cropped-pdfs.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlobs, downloadSingle]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setResultBlobs([]);
    setPreviewUrl(null);
    setProgress(0);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  // Preview overlay percentages
  const previewMarginPct = {
    top: (margins.top / pageHeight) * 100,
    right: (margins.right / pageWidth) * 100,
    bottom: (margins.bottom / pageHeight) * 100,
    left: (margins.left / pageWidth) * 100,
  };

  return (
    <ToolPageLayout
      icon={Crop}
      title="Crop PDF"
      subtitle="Trim margins from your PDF pages with a live preview"
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
          dragIcon={Crop}
        />
      )}

      {/* Configure */}
      {step === "configure" && (
        <div className="space-y-5">
          <FileList
            files={files}
            onRemove={handleRemove}
            onReorder={setFiles}
            headerTitle="PDFs to crop"
            headerHint="Same crop applied to all"
          />

          <FileDropZone
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf,.pdf"
            title={isDragging ? "Drop more!" : "Add more PDFs"}
            buttonLabel="Add More"
            dragIcon={Crop}
          />

          {/* Crop Settings with Preview */}
          <div className="bg-card border rounded-xl p-5 animate-fade-in space-y-6">
            <div className="flex items-center gap-2 mb-1">
              <Crop className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Crop Settings
              </h3>
            </div>

            {/* Presets */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Quick Presets</label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => {
                  const isActive =
                    margins.top === preset.margins.top &&
                    margins.right === preset.margins.right &&
                    margins.bottom === preset.margins.bottom &&
                    margins.left === preset.margins.left;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => setMargins(preset.margins)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary shadow-md"
                          : "bg-card text-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Uniform toggle */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setUniformMode(!uniformMode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  uniformMode
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:border-primary/40"
                }`}
              >
                {uniformMode ? "Uniform margins" : "Independent margins"}
              </button>
            </div>

            {/* Visual preview + margin sliders */}
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Preview */}
              <div className="flex-shrink-0 flex flex-col items-center gap-2">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Eye className="w-3 h-3" /> Live Preview
                </div>
                <div
                  className="relative bg-muted border rounded-lg overflow-hidden"
                  style={{ width: 200, height: 200 * (pageHeight / pageWidth) }}
                >
                  {previewUrl && (
                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                  )}
                  {/* Crop overlay - shows what will be removed */}
                  <div
                    className="absolute top-0 left-0 right-0 bg-destructive/25 border-b border-dashed border-destructive/40"
                    style={{ height: `${previewMarginPct.top}%` }}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-destructive/25 border-t border-dashed border-destructive/40"
                    style={{ height: `${previewMarginPct.bottom}%` }}
                  />
                  <div
                    className="absolute top-0 left-0 bottom-0 bg-destructive/25 border-r border-dashed border-destructive/40"
                    style={{ width: `${previewMarginPct.left}%` }}
                  />
                  <div
                    className="absolute top-0 right-0 bottom-0 bg-destructive/25 border-l border-dashed border-destructive/40"
                    style={{ width: `${previewMarginPct.right}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Red areas will be cropped
                </p>
              </div>

              {/* Margin controls */}
              <div className="flex-1 space-y-4">
                {uniformMode ? (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">
                      All margins: {margins.top}pt ({(margins.top / 72).toFixed(2)}″)
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={144}
                      step={1}
                      value={margins.top}
                      onChange={(e) => updateMargin("top", parseInt(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                      <span>0pt</span>
                      <span>144pt (2″)</span>
                    </div>
                  </div>
                ) : (
                  <>
                    {(["top", "right", "bottom", "left"] as const).map((side) => (
                      <div key={side}>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block capitalize">
                          {side}: {margins[side]}pt ({(margins[side] / 72).toFixed(2)}″)
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={144}
                          step={1}
                          value={margins[side]}
                          onChange={(e) => updateMargin(side, parseInt(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </div>
                    ))}
                  </>
                )}

                {/* Reset margins */}
                <button
                  onClick={() => setMargins({ top: 0, right: 0, bottom: 0, left: 0 })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium text-muted-foreground hover:bg-muted transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reset Margins
                </button>
              </div>
            </div>
          </div>

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={margins.top === 0 && margins.right === 0 && margins.bottom === 0 && margins.left === 0}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Crop className="w-5 h-5" />
            Crop {files.length} PDF{files.length !== 1 ? "s" : ""}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Cropping PDFs..."
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
              Crop Complete!
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {resultBlobs.length} PDF{resultBlobs.length > 1 ? "s" : ""} cropped successfully
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
