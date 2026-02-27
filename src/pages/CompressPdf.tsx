import { useState, useCallback, useMemo, useEffect } from "react";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import {
  Minimize2, ShieldCheck, Zap, ArrowRight, Upload, FileDown,
  Gauge, Settings2, Target, Trash2, Info, BarChart3,
  FileText,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { toast } from "sonner";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// Pre-warm the worker by loading a minimal PDF on module init
let workerWarmedUp = false;
const warmUpWorker = () => {
  if (workerWarmedUp) return;
  workerWarmedUp = true;
  // Create a minimal valid PDF to force worker initialization
  PDFDocument.create().then(async (doc) => {
    doc.addPage();
    const bytes = await doc.save();
    const loadTask = pdfjsLib.getDocument({ data: bytes });
    loadTask.promise.then((pdf) => pdf.destroy()).catch(() => {});
  }).catch(() => {});
};

type Step = "upload" | "configure" | "processing" | "done";

type CompressionMode = "preset" | "custom" | "target";

type PresetLevel = "low" | "medium" | "high" | "maximum";

interface PresetConfig {
  label: string;
  desc: string;
  quality: number;
  dpi: number;
  stripMetadata: boolean;
  icon: string;
  color: string;
}

interface PdfFileInfo {
  file: File;
  pageCount: number;
  sizeBytes: number;
}

interface CompressedResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  pageCount: number;
  fileName: string;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Settings" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Minimize2, label: "Smart compression" },
] as const;

const PRESETS: Record<PresetLevel, PresetConfig> = {
  low: {
    label: "Low",
    desc: "Minimal compression, near-original quality",
    quality: 80,
    dpi: 200,
    stripMetadata: false,
    icon: "🟢",
    color: "text-green-500",
  },
  medium: {
    label: "Medium",
    desc: "Balanced quality and file size",
    quality: 50,
    dpi: 150,
    stripMetadata: true,
    icon: "🟡",
    color: "text-yellow-500",
  },
  high: {
    label: "High",
    desc: "Significant size reduction, good quality",
    quality: 30,
    dpi: 120,
    stripMetadata: true,
    icon: "🟠",
    color: "text-orange-500",
  },
  maximum: {
    label: "Maximum",
    desc: "Smallest file size, aggressive compression",
    quality: 12,
    dpi: 72,
    stripMetadata: true,
    icon: "🔴",
    color: "text-red-500",
  },
};

const DPI_OPTIONS = [50, 72, 96, 150, 200, 300] as const;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function estimateCompressedSize(originalSize: number, quality: number, dpi: number): number {
  const qualityFactor = quality / 100;
  const dpiFactor = Math.min(dpi / 300, 1);
  // More aggressive estimate: quality and DPI compound
  const compression = qualityFactor * qualityFactor * dpiFactor;
  const estimated = originalSize * Math.max(0.05, compression * 0.7);
  return Math.round(estimated);
}

/* ─── Size Comparison Bar ─── */
function SizeComparisonBar({
  originalSize,
  estimatedSize,
}: {
  originalSize: number;
  estimatedSize: number;
}) {
  const reduction = Math.max(0, Math.round((1 - estimatedSize / originalSize) * 100));
  const barWidth = Math.max(5, Math.round((estimatedSize / originalSize) * 100));

  return (
    <div className="bg-card border rounded-xl p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Estimated Result
          </span>
        </div>
        <span className="text-sm font-bold text-primary">-{reduction}%</span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Original</span>
            <span>{formatBytes(originalSize)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-muted-foreground/30 w-full" />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-primary font-medium">Compressed</span>
            <span className="text-primary font-medium">~{formatBytes(estimatedSize)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── After-Compression Stats ─── */
function CompressionStats({ results }: { results: CompressedResult[] }) {
  const totalOriginal = results.reduce((a, r) => a + r.originalSize, 0);
  const totalCompressed = results.reduce((a, r) => a + r.compressedSize, 0);
  const totalReduction = Math.round((1 - totalCompressed / totalOriginal) * 100);
  const totalPages = results.reduce((a, r) => a + r.pageCount, 0);

  return (
    <div className="grid grid-cols-3 gap-3 animate-fade-in">
      <div className="bg-card border rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {formatBytes(totalOriginal)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Original</p>
      </div>
      <div className="bg-card border rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-primary" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {formatBytes(totalCompressed)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Compressed</p>
      </div>
      <div className="bg-card border rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-primary" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          -{totalReduction}%
        </p>
        <p className="text-xs text-muted-foreground mt-1">Reduction ({totalPages} pg{totalPages !== 1 ? "s" : ""})</p>
      </div>
    </div>
  );
}

/* ─── File Card ─── */
function FileCard({
  info,
  onRemove,
  estimatedSize,
}: {
  info: PdfFileInfo;
  onRemove: () => void;
  estimatedSize: number;
}) {
  const reduction = Math.max(0, Math.round((1 - estimatedSize / info.sizeBytes) * 100));
  return (
    <div className="flex items-center gap-3 bg-card border rounded-xl px-4 py-3 group hover:shadow-md transition-all animate-fade-in">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {info.file.name}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{formatBytes(info.sizeBytes)}</span>
          <span>·</span>
          <span>{info.pageCount} page{info.pageCount !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span className="text-primary font-medium">→ ~{formatBytes(estimatedSize)} (-{reduction}%)</span>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
        title="Remove"
      >
        <Trash2 className="w-4 h-4 text-destructive" />
      </button>
    </div>
  );
}

/* ─── Main Component ─── */
export default function CompressPdf() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<PdfFileInfo[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Compression settings
  const [mode, setMode] = useState<CompressionMode>("preset");
  const [preset, setPreset] = useState<PresetLevel>("medium");
  const [customQuality, setCustomQuality] = useState(65);
  const [customDpi, setCustomDpi] = useState<number>(200);
  const [stripMetadata, setStripMetadata] = useState(true);
  const [grayscale, setGrayscale] = useState(false);
  const [targetSizeMb, setTargetSizeMb] = useState(2);

  // UI state
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [results, setResults] = useState<CompressedResult[]>([]);

  // Pre-warm worker on mount
  useEffect(() => { warmUpWorker(); }, []);

  // Derived settings
  const activeQuality = mode === "preset" ? PRESETS[preset].quality : customQuality;
  const activeDpi = mode === "preset" ? PRESETS[preset].dpi : customDpi;
  const activeStripMeta = mode === "preset" ? PRESETS[preset].stripMetadata : stripMetadata;

  const totalOriginalSize = useMemo(() => files.reduce((a, f) => a + f.sizeBytes, 0), [files]);
  const totalEstimatedSize = useMemo(
    () => files.reduce((a, f) => a + estimateCompressedSize(f.sizeBytes, activeQuality, activeDpi), 0),
    [files, activeQuality, activeDpi]
  );

  const handleFilesSelected = useCallback(async (selectedFiles: File[]) => {
    const pdfFiles = selectedFiles.filter((f) => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      toast.error("No valid PDF files", { description: "Please select PDF files." });
      return;
    }

    for (const file of pdfFiles) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        // Use pdf-lib for page counting (faster & more reliable than pdfjs after heavy use)
        const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const info: PdfFileInfo = {
          file,
          pageCount: pdfDoc.getPageCount(),
          sizeBytes: file.size,
        };
        setFiles((prev) => [...prev, info]);
      } catch {
        toast.error("Failed to read PDF", { description: file.name });
      }
    }
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleContinue = useCallback(() => {
    if (files.length === 0) return;
    setStep("configure");
  }, [files]);

  /* ─── Lightweight compression: pdf-lib only (no re-render) ─── */
  async function compressLightweight(
    file: File,
    shouldStripMeta: boolean,
  ): Promise<Blob> {
    const arrayBuffer = await file.arrayBuffer();
    const srcPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const outPdf = await PDFDocument.create();

    // Copy all pages (pdf-lib re-serializes, stripping unused objects)
    const pages = await outPdf.copyPages(srcPdf, srcPdf.getPageIndices());
    for (const page of pages) {
      outPdf.addPage(page);
    }

    if (shouldStripMeta) {
      outPdf.setTitle("");
      outPdf.setAuthor("");
      outPdf.setSubject("");
      outPdf.setKeywords([]);
      outPdf.setProducer("");
      outPdf.setCreator("");
    }

    const pdfBytes = await outPdf.save();
    return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
  }

  /* ─── Heavy compression: re-render via pdfjs (rasterize pages) ─── */
  async function compressRerender(
    file: File,
    quality: number,
    dpi: number,
    shouldStripMeta: boolean,
    useGrayscale: boolean,
    onPageProgress: (page: number, total: number) => void,
  ): Promise<Blob> {
    const arrayBuffer = await file.arrayBuffer();
    const srcPdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = srcPdf.numPages;
    const outPdf = await PDFDocument.create();

    for (let i = 1; i <= numPages; i++) {
      const page = await srcPdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = dpi / 72;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;

      // White background (avoids transparency → black in JPEG)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Grayscale conversion for extra compression
      if (useGrayscale) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let p = 0; p < data.length; p += 4) {
          const gray = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
          data[p] = data[p + 1] = data[p + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      const jpegBlob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", quality / 100)
      );
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const embeddedImage = await outPdf.embedJpg(jpegBytes);

      const outPage = outPdf.addPage([baseViewport.width, baseViewport.height]);
      outPage.drawImage(embeddedImage, {
        x: 0, y: 0,
        width: baseViewport.width, height: baseViewport.height,
      });

      // Clean up canvas
      canvas.width = 0;
      canvas.height = 0;

      onPageProgress(i, numPages);
    }

    srcPdf.destroy();

    if (shouldStripMeta) {
      outPdf.setTitle("");
      outPdf.setAuthor("");
      outPdf.setSubject("");
      outPdf.setKeywords([]);
      outPdf.setProducer("");
      outPdf.setCreator("");
    }

    const pdfBytes = await outPdf.save();
    return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
  }

  /* ─── Smart compression: picks the best strategy ─── */
  async function compressSinglePdf(
    file: File,
    quality: number,
    dpi: number,
    shouldStripMeta: boolean,
    useGrayscale: boolean,
    onPageProgress: (page: number, total: number) => void,
  ): Promise<CompressedResult> {
    const originalSize = file.size;
    const pageCount = files.find((f) => f.file === file)?.pageCount ?? 1;

    // Strategy 1: Lightweight (pdf-lib copy + strip) — fast, good for small/text PDFs
    const lightBlob = await compressLightweight(file, shouldStripMeta);

    // Strategy 2: Re-render — only if file is large enough to benefit (>100KB)
    let rerenderBlob: Blob | null = null;
    if (originalSize > 100 * 1024) {
      rerenderBlob = await compressRerender(file, quality, dpi, shouldStripMeta, useGrayscale, onPageProgress);
    } else {
      // Still call progress for small files
      onPageProgress(pageCount, pageCount);
    }

    // Pick the smallest result, but NEVER return something bigger than original
    let bestBlob = lightBlob;
    if (rerenderBlob && rerenderBlob.size < bestBlob.size) {
      bestBlob = rerenderBlob;
    }

    // Safety net: if compression made it bigger, return the original
    if (bestBlob.size >= originalSize) {
      const originalArrayBuffer = await file.arrayBuffer();
      bestBlob = new Blob([originalArrayBuffer], { type: "application/pdf" });
    }

    return {
      blob: bestBlob,
      originalSize,
      compressedSize: bestBlob.size,
      pageCount,
      fileName: file.name.replace(/\.pdf$/i, ""),
    };
  }

  /* ─── Target size mode: binary search for quality ─── */
  async function compressToTarget(
    file: File,
    targetBytes: number,
    dpi: number,
    shouldStripMeta: boolean,
    onProgress: (msg: string, pct: number) => void,
  ): Promise<CompressedResult> {
    let low = 5;
    let high = 95;
    let bestResult: CompressedResult | null = null;
    let attempts = 0;
    const maxAttempts = 6;

    while (low <= high && attempts < maxAttempts) {
      const mid = Math.round((low + high) / 2);
      attempts++;
      onProgress(`Attempt ${attempts}: trying quality ${mid}%`, 20 + attempts * 10);

      const result = await compressSinglePdf(file, mid, dpi, shouldStripMeta, true, () => {});

      if (result.compressedSize <= targetBytes) {
        bestResult = result;
        low = mid + 1; // Try higher quality
      } else {
        high = mid - 1; // Need lower quality
      }
    }

    // If we never got under target, use the lowest quality attempt
    if (!bestResult) {
      onProgress("Using maximum compression", 85);
      bestResult = await compressSinglePdf(file, 5, dpi, shouldStripMeta, true, () => {});
    }

    return bestResult;
  }

  const handleProcess = useCallback(async () => {
    if (files.length === 0) return;
    setStep("processing");
    setProgress(0);
    setProgressLabel("Starting compression…");
    const startTime = Date.now();
    const allResults: CompressedResult[] = [];

    try {
      for (let fi = 0; fi < files.length; fi++) {
        const fileInfo = files[fi];
        const fileLabel = files.length > 1 ? `File ${fi + 1}/${files.length}: ` : "";

        let result: CompressedResult;

        if (mode === "target") {
          const targetBytes = targetSizeMb * 1024 * 1024;
          setProgressLabel(`${fileLabel}Compressing to target size…`);
          result = await compressToTarget(
            fileInfo.file,
            targetBytes,
            activeDpi,
            activeStripMeta,
            (msg, pct) => {
              setProgressLabel(`${fileLabel}${msg}`);
              setProgress(Math.round((fi / files.length) * 100 + pct / files.length));
            }
          );
        } else {
          result = await compressSinglePdf(
            fileInfo.file,
            activeQuality,
            activeDpi,
            activeStripMeta,
            grayscale,
            (page, total) => {
              const filePct = (fi / files.length) * 100;
              const pagePct = (page / total) * (80 / files.length);
              setProgress(Math.round(filePct + pagePct));
              setProgressLabel(`${fileLabel}Processing page ${page}/${total}`);
            }
          );
        }

        allResults.push(result);
      }

      // Ensure minimum processing time for UX (reduced from 2s to 800ms)
      const elapsed = Date.now() - startTime;
      if (elapsed < 800) {
        setProgress(95);
        setProgressLabel("Finalizing…");
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }

      setProgress(100);
      setResults(allResults);
      setStep("done");

      // Notify if any files couldn't be reduced
      const unchangedFiles = allResults.filter((r) => r.compressedSize >= r.originalSize);
      if (unchangedFiles.length > 0) {
        const names = unchangedFiles.map((r) => r.fileName).join(", ");
        toast.info("Already optimized", {
          description: unchangedFiles.length === allResults.length
            ? "Your PDF is already optimally compressed — no further reduction possible."
            : `${names} couldn't be reduced further and were kept at original size.`,
          duration: 6000,
        });
      }
    } catch (err) {
      console.error("Compression failed:", err);
      toast.error("Compression failed", { description: "Something went wrong while processing your PDF." });
      setStep("configure");
    }
  }, [files, mode, preset, activeQuality, activeDpi, activeStripMeta, grayscale, targetSizeMb]);

  const handleDownload = useCallback(() => {
    for (const result of results) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${result.fileName}-compressed.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [results]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setStep("upload");
    setProgress(0);
    setProgressLabel("");
    setResults([]);
    setIsDragging(false);
    setResetKey((k) => k + 1);
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];
  const currentStepKey = step === "processing" ? "configure" : step;

  return (
    <ToolPageLayout
      icon={Minimize2}
      title="Compress PDF"
      subtitle="Reduce file size without losing quality — all in your browser"
      steps={STEPS}
      currentStep={currentStepKey}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {/* ─── STEP: Upload ─── */}
      {step === "upload" && (
        <div className="space-y-4 animate-fade-in">
          <FileDropZone
            key={resetKey}
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf"
            title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
            subtitle="or click to browse · Multiple files supported"
            buttonLabel="Select PDF Files"
            dragIcon={Minimize2}
          />

          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f, i) => (
                <FileCard
                  key={`${f.file.name}-${i}`}
                  info={f}
                  onRemove={() => handleRemoveFile(i)}
                  estimatedSize={estimateCompressedSize(f.sizeBytes, activeQuality, activeDpi)}
                />
              ))}
              <button
                onClick={handleContinue}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Settings2 className="w-5 h-5" />
                Configure Compression
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── STEP: Configure ─── */}
      {step === "configure" && (
        <div className="space-y-4 animate-fade-in">
          {/* Mode tabs */}
          <div className="bg-card border rounded-xl p-1.5 flex gap-1">
            {([
              { value: "preset" as CompressionMode, label: "Presets", icon: Gauge },
              { value: "custom" as CompressionMode, label: "Custom", icon: Settings2 },
              { value: "target" as CompressionMode, label: "Target Size", icon: Target },
            ]).map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                  mode === m.value
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <m.icon className="w-4 h-4" />
                {m.label}
              </button>
            ))}
          </div>

          {/* Preset mode */}
          {mode === "preset" && (
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(PRESETS) as [PresetLevel, PresetConfig][]).map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => setPreset(key)}
                  className={`relative text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                    preset === key
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-border hover:border-primary/30 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{config.icon}</span>
                    <span className="text-sm font-bold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {config.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{config.desc}</p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/70">
                    <span>Quality: {config.quality}%</span>
                    <span>·</span>
                    <span>{config.dpi} DPI</span>
                  </div>
                  {preset === key && (
                    <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Custom mode */}
          {mode === "custom" && (
            <div className="bg-card border rounded-xl p-5 space-y-5">
              {/* Quality slider */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Image Quality</label>
                  <span className="text-xs text-primary font-bold">{customQuality}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={customQuality}
                  onChange={(e) => setCustomQuality(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/50 mt-0.5">
                  <span>Smallest file</span>
                  <span>Best quality</span>
                </div>
              </div>

              {/* DPI */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Resolution (DPI)</label>
                <div className="flex gap-2">
                  {DPI_OPTIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setCustomDpi(d)}
                      className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all ${
                        customDpi === d
                          ? "bg-primary text-primary-foreground shadow-md"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Strip metadata */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  className={`w-10 h-6 rounded-full transition-colors relative ${
                    stripMetadata ? "bg-primary" : "bg-muted"
                  }`}
                  onClick={() => setStripMetadata((v) => !v)}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-primary-foreground shadow-sm transition-transform ${
                      stripMetadata ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Strip Metadata</p>
                  <p className="text-xs text-muted-foreground">Remove author, title, timestamps</p>
                </div>
              </label>

              {/* Grayscale */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  className={`w-10 h-6 rounded-full transition-colors relative ${
                    grayscale ? "bg-primary" : "bg-muted"
                  }`}
                  onClick={() => setGrayscale((v) => !v)}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-primary-foreground shadow-sm transition-transform ${
                      grayscale ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Grayscale</p>
                  <p className="text-xs text-muted-foreground">Convert to black & white for extra compression</p>
                </div>
              </label>
            </div>
          )}

          {/* Target size mode */}
          {mode === "target" && (
            <div className="bg-card border rounded-xl p-5 space-y-4">
              <div className="flex items-start gap-3">
                <Target className="w-5 h-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    Target File Size
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    We'll automatically find the best quality that gets your PDF under this size
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.5}
                  value={targetSizeMb}
                  onChange={(e) => setTargetSizeMb(Math.max(0.1, Number(e.target.value)))}
                  className="flex-1 px-4 py-3 rounded-xl border bg-background text-foreground text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-primary"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                />
                <span className="text-sm font-medium text-muted-foreground">MB</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Current total size: <strong>{formatBytes(totalOriginalSize)}</strong>. 
                  The tool will try multiple quality levels to hit your target.
                </span>
              </div>
            </div>
          )}

          {/* Size estimation bar */}
          {mode !== "target" && files.length > 0 && (
            <SizeComparisonBar
              originalSize={totalOriginalSize}
              estimatedSize={totalEstimatedSize}
            />
          )}

          {/* File list summary */}
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileDown className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Files to Compress ({files.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1">
                  <span className="text-foreground truncate flex-1">{f.file.name}</span>
                  <span className="text-muted-foreground ml-2">{formatBytes(f.sizeBytes)} · {f.pageCount}pg</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setStep("upload"); }}
              className="mt-3 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
            >
              + Add more files
            </button>
          </div>

          {/* Process button */}
          <button
            onClick={handleProcess}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Minimize2 className="w-5 h-5" />
            Compress {files.length > 1 ? `${files.length} Files` : "PDF"}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ─── STEP: Processing ─── */}
      {step === "processing" && (
        <div className="space-y-4">
          <ProcessingView
            title="Compressing your PDF…"
            subtitle={progressLabel}
            progress={progress}
          />
        </div>
      )}

      {/* ─── STEP: Done ─── */}
      {step === "done" && results.length > 0 && (
        <div className="space-y-6 animate-fade-in">
          <CompressionStats results={results} />

          {results.length === 1 ? (
            <SuccessView
              title="PDF Compressed!"
              description={`Reduced from <strong>${formatBytes(results[0].originalSize)}</strong> to <strong>${formatBytes(results[0].compressedSize)}</strong>`}
              fileName={`${results[0].fileName}-compressed`}
              onDownload={handleDownload}
              onReset={handleReset}
              resetLabel="Compress Another"
            />
          ) : (
            <div className="space-y-4">
              {/* Individual results */}
              <div className="space-y-2">
                {results.map((r, i) => {
                  const reduction = Math.round((1 - r.compressedSize / r.originalSize) * 100);
                  return (
                    <div key={i} className="flex items-center gap-3 bg-card border rounded-xl px-4 py-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.fileName}.pdf</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(r.originalSize)} → {formatBytes(r.compressedSize)}
                          <span className="text-primary font-medium ml-1">(-{reduction}%)</span>
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const url = URL.createObjectURL(r.blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `${r.fileName}-compressed.pdf`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                      >
                        Download
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Batch download */}
              <SuccessView
                title="All Files Compressed!"
                description={`<strong>${results.length}</strong> files compressed successfully`}
                fileName="all-compressed"
                onDownload={handleDownload}
                onReset={handleReset}
                resetLabel="Compress More"
              />
            </div>
          )}
        </div>
      )}
    </ToolPageLayout>
  );
}
