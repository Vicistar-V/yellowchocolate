import { useState, useCallback, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import JSZip from "jszip";
import {
  ImageDown, ShieldCheck, Zap, ArrowRight, Files, Download,
  ChevronLeft, ChevronRight, Check, RotateCcw, Image as ImageIcon,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "configure" | "processing" | "done";
type ImageFormat = "jpeg" | "png" | "webp";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Settings" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant rendering" },
  { icon: Files, label: "Batch support" },
] as const;

const FORMAT_OPTIONS: { value: ImageFormat; label: string; mime: string; ext: string }[] = [
  { value: "jpeg", label: "JPEG", mime: "image/jpeg", ext: ".jpg" },
  { value: "png", label: "PNG", mime: "image/png", ext: ".png" },
  { value: "webp", label: "WebP", mime: "image/webp", ext: ".webp" },
];

const DPI_OPTIONS = [
  { value: 1, label: "72 DPI – Fast" },
  { value: 1.5, label: "108 DPI – Standard" },
  { value: 2, label: "144 DPI – High" },
  { value: 3, label: "216 DPI – Ultra" },
];

const ITEMS_PER_PAGE = 20;

interface RenderedPage {
  pageNum: number;
  dataUrl: string;
  fileName: string;
  blob: Blob;
}

export default function PdfToImage() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(0.92);
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const formatInfo = FORMAT_OPTIONS.find((f) => f.value === format)!;
  const totalPages = Math.ceil(renderedPages.length / ITEMS_PER_PAGE);
  const visiblePages = renderedPages.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      const items: FileItem[] = newFiles.map((file) => ({
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

  const handleConvert = useCallback(async () => {
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();

    try {
      const allPages: RenderedPage[] = [];
      let totalPageCount = 0;

      // First pass: count total pages for progress
      const pageCounts: number[] = [];
      for (const fi of files) {
        const buffer = await fi.file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        pageCounts.push(pdf.numPages);
        totalPageCount += pdf.numPages;
      }

      let processedPages = 0;

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi].file;
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        const baseName = file.name.replace(/\.pdf$/i, "");
        const isMultiFile = files.length > 1;

        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;

          await page.render({ canvasContext: ctx, viewport }).promise;

          const mimeType = formatInfo.mime;
          const qualityVal = format === "png" ? undefined : quality;
          const dataUrl = canvas.toDataURL(mimeType, qualityVal);

          // Convert to blob
          const response = await fetch(dataUrl);
          const blob = await response.blob();

          const suffix = pdf.numPages > 1 ? `_page${p}` : "";
          const prefix = isMultiFile ? `${baseName}_` : `${baseName}`;
          const fileName = `${prefix}${suffix}${formatInfo.ext}`;

          allPages.push({ pageNum: processedPages + 1, dataUrl, fileName, blob });
          processedPages++;
          setProgress(Math.round((processedPages / totalPageCount) * 90));
        }
      }

      // UX delay
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(1500 - elapsed, 0);
      if (remaining > 0) {
        setProgress(95);
        await new Promise((r) => setTimeout(r, remaining * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, remaining * 0.4));
      }

      setRenderedPages(allPages);
      setCurrentPage(1);
      setStep("done");
      toast.success(`Rendered ${allPages.length} page${allPages.length > 1 ? "s" : ""} as ${formatInfo.label}`);
    } catch (err) {
      console.error("PDF to Image failed:", err);
      toast.error("Conversion failed", { description: "Could not render one or more pages." });
      setStep("configure");
    }
  }, [files, format, scale, quality, formatInfo]);

  const downloadSingle = useCallback((page: RenderedPage) => {
    const url = URL.createObjectURL(page.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = page.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadAll = useCallback(async () => {
    if (renderedPages.length === 1) {
      downloadSingle(renderedPages[0]);
      return;
    }
    const zip = new JSZip();
    renderedPages.forEach((p) => zip.file(p.fileName, p.blob));
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pdf-to-${format}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [renderedPages, format, downloadSingle]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setRenderedPages([]);
    setProgress(0);
    setCurrentPage(1);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  return (
    <ToolPageLayout
      icon={ImageDown}
      title="PDF to Image"
      subtitle="Convert PDF pages to JPEG, PNG or WebP — batch supported"
      steps={STEPS}
      currentStep={step === "processing" ? "configure" : step}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {/* Upload step */}
      {step === "upload" && (
        <FileDropZone
          onFilesSelected={handleFilesSelected}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          accept="application/pdf,.pdf"
          title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
          subtitle="PDF files · Multiple files supported"
          buttonLabel="Select PDF Files"
          dragIcon={ImageDown}
        />
      )}

      {/* Configure step */}
      {step === "configure" && (
        <div className="space-y-5">
          <FileList
            files={files}
            onRemove={handleRemove}
            onReorder={setFiles}
            headerTitle="PDFs to convert"
            headerHint="Drag to reorder"
          />

          <FileDropZone
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf,.pdf"
            title={isDragging ? "Drop more files!" : "Add more PDFs"}
            buttonLabel="Add More Files"
            dragIcon={ImageDown}
          />

          {/* Output configuration */}
          <div className="bg-card border rounded-xl p-5 animate-fade-in space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <ImageIcon className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Output Settings
              </h3>
            </div>

            {/* Format selection */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Image Format</label>
              <div className="flex gap-2">
                {FORMAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFormat(opt.value)}
                    className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border ${
                      format === opt.value
                        ? "bg-primary text-primary-foreground border-primary shadow-md"
                        : "bg-card text-foreground border-border hover:border-primary/40 hover:bg-muted/50"
                    }`}
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    {format === opt.value && <Check className="w-3.5 h-3.5 inline mr-1.5" />}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* DPI / Scale */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Quality / Resolution</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DPI_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setScale(opt.value)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 border ${
                      scale === opt.value
                        ? "bg-primary text-primary-foreground border-primary shadow-md"
                        : "bg-card text-foreground border-border hover:border-primary/40 hover:bg-muted/50"
                    }`}
                  >
                    {scale === opt.value && <Check className="w-3 h-3 inline mr-1" />}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* JPEG Quality slider */}
            {format !== "png" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Compression Quality: {Math.round(quality * 100)}%
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={quality}
                  onChange={(e) => setQuality(parseFloat(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                  <span>Smaller file</span>
                  <span>Best quality</span>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleConvert}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <ImageDown className="w-5 h-5" />
            Convert {files.length} PDF{files.length !== 1 ? "s" : ""} to {formatInfo.label}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title={`Rendering pages as ${formatInfo.label}...`}
          subtitle={`Processing ${files.length} PDF${files.length !== 1 ? "s" : ""} in your browser`}
          progress={progress}
        />
      )}

      {/* Results with thumbnails + pagination */}
      {step === "done" && renderedPages.length > 0 && (
        <div className="space-y-6 animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {renderedPages.length} Page{renderedPages.length !== 1 ? "s" : ""} Rendered
              </h2>
              <p className="text-sm text-muted-foreground">
                Click any image to download individually, or download all as ZIP.
              </p>
            </div>
            <button
              onClick={downloadAll}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 text-sm"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              <Download className="w-4 h-4" />
              {renderedPages.length === 1 ? "Download" : "Download All (.zip)"}
            </button>
          </div>

          {/* Thumbnail grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {visiblePages.map((page, idx) => (
              <button
                key={page.pageNum}
                onClick={() => downloadSingle(page)}
                className="group relative bg-card border rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/30 hover:scale-[1.03] transition-all duration-200 animate-fade-in"
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                <div className="aspect-[3/4] overflow-hidden bg-muted">
                  <img
                    src={page.dataUrl}
                    alt={page.fileName}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                </div>
                <div className="p-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">{page.fileName}</span>
                  <Download className="w-3.5 h-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border bg-card text-foreground text-sm font-medium hover:bg-muted transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                      currentPage === p
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "bg-card border text-foreground hover:bg-muted"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border bg-card text-foreground text-sm font-medium hover:bg-muted transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-center gap-3 pt-2">
            <p className="text-xs text-muted-foreground/60">All rendering done in your browser — nothing uploaded.</p>
          </div>
          <div className="flex justify-center">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl border bg-card text-foreground font-medium hover:bg-muted transition-all duration-200"
            >
              <RotateCcw className="w-4 h-4" />
              Convert More
            </button>
          </div>
        </div>
      )}
    </ToolPageLayout>
  );
}
