import { useState, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import {
  FileStack,
  Plus,
  Zap,
  ShieldCheck,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { FileDropZone } from "@/components/merge/FileDropZone";
import { FileList, type PdfFileItem } from "@/components/merge/FileList";
import { MergeConfig, type MergeOptions } from "@/components/merge/MergeConfig";
import { MergeSuccess } from "@/components/merge/MergeSuccess";

type MergeStep = "upload" | "arrange" | "merging" | "done";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function MergePdf() {
  const [step, setStep] = useState<MergeStep>("upload");
  const [files, setFiles] = useState<PdfFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [options, setOptions] = useState<MergeOptions>({
    outputFileName: "merged-document",
  });

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      setIsProcessingFiles(true);
      const items: PdfFileItem[] = [];

      for (const file of newFiles) {
        let pageCount: number | null = null;
        try {
          const buffer = await file.arrayBuffer();
          const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
          pageCount = pdf.getPageCount();
        } catch {
          // can't read pages, that's okay
        }

        items.push({
          id: generateId(),
          file,
          pageCount,
          sizeFormatted: formatFileSize(file.size),
        });
      }

      // Brief delay so user sees the processing state
      await new Promise((r) => setTimeout(r, 600));

      setFiles((prev) => [...prev, ...items]);
      setIsProcessingFiles(false);
      if (step === "upload") setStep("arrange");
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

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setFiles((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setFiles((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleMerge = useCallback(async () => {
    setStep("merging");
    setMergeProgress(0);
    const startTime = Date.now();

    try {
      const mergedPdf = await PDFDocument.create();
      let pagesTotal = 0;

      for (let i = 0; i < files.length; i++) {
        const buffer = await files[i].file.arrayBuffer();
        const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
        pagesTotal += pages.length;
        setMergeProgress(Math.round(((i + 1) / files.length) * 100));
      }

      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      
      // Ensure at least 2s of loading screen for polished UX
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(2000 - elapsed, 0);
      if (remaining > 0) {
        // Animate progress to 100% over remaining time
        setMergeProgress(90);
        await new Promise((r) => setTimeout(r, remaining * 0.6));
        setMergeProgress(100);
        await new Promise((r) => setTimeout(r, remaining * 0.4));
      }

      setMergedBlob(blob);
      setTotalPages(pagesTotal);
      setStep("done");
    } catch (err) {
      console.error("Merge failed:", err);
      setStep("arrange");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!mergedBlob) return;
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${options.outputFileName || "merged"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [mergedBlob, options.outputFileName]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setMergedBlob(null);
    setTotalPages(0);
    setMergeProgress(0);
    setStep("upload");
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <FileStack className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1
              className="text-2xl font-bold text-foreground"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Merge PDF
            </h1>
            <p className="text-sm text-muted-foreground">
              Combine multiple PDFs into a single document
            </p>
          </div>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 mt-5">
          {[
            { key: "upload", label: "1. Upload" },
            { key: "arrange", label: "2. Arrange" },
            { key: "done", label: "3. Download" },
          ].map((s, i) => {
            const isActive =
              s.key === step ||
              (s.key === "arrange" && step === "merging");
            const isDone =
              (s.key === "upload" && step !== "upload") ||
              (s.key === "arrange" && (step === "done" || step === "merging")) ||
              (s.key === "done" && step === "done");

            return (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className={`w-8 h-0.5 rounded-full transition-colors duration-300 ${
                      isDone ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
                <span
                  className={`text-xs font-medium px-3 py-1 rounded-full transition-all duration-300 ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isDone
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trust badges */}
      {step === "upload" && (
        <div className="flex items-center gap-6 mb-6 text-xs text-muted-foreground animate-fade-in">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" /> No uploads
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-primary" /> Instant processing
          </span>
          <span className="flex items-center gap-1.5">
            <FileStack className="w-3.5 h-3.5 text-primary" /> Unlimited files
          </span>
        </div>
      )}

      {/* Upload step */}
      {(step === "upload" || step === "arrange") && (
        <div className="space-y-5">
          {step === "upload" && (
            isProcessingFiles ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16 animate-fade-in">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <div className="text-center">
                  <p className="font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    Reading your PDFs...
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Analyzing pages & metadata</p>
                </div>
              </div>
            ) : (
              <FileDropZone
                onFilesSelected={handleFilesSelected}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
              />
            )
          )}

          {step === "arrange" && (
            <>
              <FileList
                files={files}
                onRemove={handleRemove}
                onReorder={setFiles}
              />

              {/* Add more files */}
              <FileDropZone
                onFilesSelected={handleFilesSelected}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
              />

              {/* Config */}
              <MergeConfig options={options} onChange={setOptions} />

              {/* Merge button */}
              <button
                onClick={handleMerge}
                disabled={files.length < 2}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <FileStack className="w-5 h-5" />
                Merge {files.length} File{files.length !== 1 ? "s" : ""} into One PDF
                <ArrowRight className="w-5 h-5" />
              </button>

              {files.length < 2 && (
                <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Add at least 2 files to merge
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Merging step */}
      {step === "merging" && (
        <div className="flex flex-col items-center py-16 animate-fade-in">
          <Loader2 className="w-12 h-12 text-primary animate-spin mb-6" />
          <h2
            className="text-xl font-bold text-foreground mb-2"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Merging your PDFs...
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Processing {files.length} files in your browser
          </p>

          {/* Progress bar */}
          <div className="w-full max-w-sm h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${mergeProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{mergeProgress}%</p>
        </div>
      )}

      {/* Done step */}
      {step === "done" && mergedBlob && (
        <MergeSuccess
          fileName={options.outputFileName || "merged"}
          totalPages={totalPages}
          fileCount={files.length}
          onDownload={handleDownload}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
