import { useState, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import {
  Trash2, ShieldCheck, Zap, FileOutput, ArrowRight,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { OutputConfig, type OutputOptions } from "@/components/tool/OutputConfig";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize } from "@/lib/file-utils";
import { toast } from "sonner";

type Step = "upload" | "configure" | "processing" | "done";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Select" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Trash2, label: "Clean removal" },
] as const;

export default function RemovePages() {
  const [step, setStep] = useState<Step>("upload");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [removedPages, setRemovedPages] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFileName, setResultFileName] = useState("");
  const [resultStats, setResultStats] = useState("");
  const [options, setOptions] = useState<OutputOptions>({ outputFileName: "cleaned" });

  const keptCount = pageCount - removedPages.size;

  const handleFileSelected = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const count = pdf.getPageCount();
      setSourceFile(file);
      setPageCount(count);
      setRemovedPages(new Set());
      setOptions({ outputFileName: file.name.replace(/\.pdf$/i, "") + "-cleaned" });
      setStep("configure");
    } catch {
      toast.error("Could not read PDF", { description: "The file may be corrupt or not a valid PDF." });
    }
  }, []);

  const togglePage = useCallback((page: number) => {
    setRemovedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }, []);

  const removeAll = useCallback(() => {
    setRemovedPages(new Set(Array.from({ length: pageCount }, (_, i) => i)));
  }, [pageCount]);

  const keepAll = useCallback(() => {
    setRemovedPages(new Set());
  }, []);

  const handleProcess = useCallback(async () => {
    if (!sourceFile || keptCount === 0) return;
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();

    try {
      const buffer = await sourceFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const keptIndices = Array.from({ length: pageCount }, (_, i) => i).filter(
        (i) => !removedPages.has(i)
      );

      const newPdf = await PDFDocument.create();
      const pages = await newPdf.copyPages(sourcePdf, keptIndices);
      pages.forEach((p) => newPdf.addPage(p));
      setProgress(80);
      const bytes = await newPdf.save();
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });

      const elapsed = Date.now() - startTime;
      if (elapsed < 2000) {
        setProgress(90);
        await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.4));
      }

      setResultBlob(blob);
      setResultFileName(options.outputFileName || "cleaned");
      setResultStats(
        `Removed <strong>${removedPages.size} page${removedPages.size !== 1 ? "s" : ""}</strong>, kept ${keptCount} of ${pageCount}`
      );
      setStep("done");
    } catch (err) {
      console.error("Remove failed:", err);
      toast.error("Processing failed", { description: "Something went wrong while removing pages." });
      setStep("configure");
    }
  }, [sourceFile, removedPages, pageCount, keptCount, options.outputFileName]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resultFileName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlob, resultFileName]);

  const handleReset = useCallback(() => {
    setSourceFile(null);
    setPageCount(0);
    setRemovedPages(new Set());
    setProgress(0);
    setResultBlob(null);
    setResultFileName("");
    setResultStats("");
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const currentStepKey = step === "processing" ? "configure" : step;

  return (
    <ToolPageLayout
      icon={Trash2}
      title="Remove Pages"
      subtitle="Delete unwanted pages from your PDF"
      steps={STEPS}
      currentStep={currentStepKey}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {/* Upload */}
      {step === "upload" && (
        <FileDropZone
          onFilesSelected={handleFileSelected}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          accept="application/pdf"
          title={isDragging ? "Drop your PDF here!" : "Drag & drop a PDF file here"}
          subtitle="or click to browse · Single file"
          buttonLabel="Select PDF File"
          dragIcon={Trash2}
        />
      )}

      {/* Configure */}
      {step === "configure" && sourceFile && (
        <div className="space-y-5 animate-fade-in">
          {/* File info */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-card border">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <FileOutput className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {sourceFile.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {pageCount} page{pageCount !== 1 ? "s" : ""} · {formatFileSize(sourceFile.size)}
              </p>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
            >
              Change file
            </button>
          </div>

          {/* Page grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3
                className="text-sm font-semibold text-foreground"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Click pages to remove
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Keeping {keptCount} of {pageCount}
                  {removedPages.size > 0 && (
                    <span className="text-destructive"> (removing {removedPages.size})</span>
                  )}
                </span>
              </h3>
              <div className="flex gap-1">
                <button
                  onClick={keepAll}
                  className="text-xs text-primary hover:text-primary/80 font-medium px-2 py-1 rounded-md hover:bg-primary/10 transition-colors"
                >
                  Keep All
                </button>
                <button
                  onClick={removeAll}
                  className="text-xs text-destructive hover:text-destructive/80 font-medium px-2 py-1 rounded-md hover:bg-destructive/10 transition-colors"
                >
                  Remove All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">
              {Array.from({ length: pageCount }, (_, i) => {
                const removed = removedPages.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => togglePage(i)}
                    className={`
                      relative h-12 rounded-lg border-2 text-sm font-semibold transition-all duration-150
                      ${removed
                        ? "border-destructive bg-destructive text-destructive-foreground shadow-sm scale-[1.02] line-through opacity-80"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-muted/50 hover:text-foreground"
                      }
                    `}
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Output config */}
          <OutputConfig options={options} onChange={setOptions} title="Output Settings" />

          {/* Action */}
          <button
            onClick={handleProcess}
            disabled={removedPages.size === 0 || keptCount === 0}
            className={`w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200 ${
              removedPages.size > 0 && keptCount > 0
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground"
            }`}
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Trash2 className="w-5 h-5" />
            {removedPages.size === 0
              ? "Select pages to remove"
              : keptCount === 0
              ? "Must keep at least 1 page"
              : `Remove ${removedPages.size} Page${removedPages.size !== 1 ? "s" : ""}`}
            {removedPages.size > 0 && keptCount > 0 && <ArrowRight className="w-5 h-5" />}
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Removing pages..."
          subtitle={`Cleaning ${pageCount}-page PDF in your browser`}
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && resultBlob && (
        <SuccessView
          title="Pages Removed!"
          description={resultStats}
          fileName={resultFileName}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Remove More"
        />
      )}
    </ToolPageLayout>
  );
}
