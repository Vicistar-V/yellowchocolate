import { useState, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import {
  FileOutput, ShieldCheck, Zap, ArrowRight,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { OutputConfig, type OutputOptions } from "@/components/tool/OutputConfig";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize } from "@/lib/file-utils";

type Step = "upload" | "configure" | "processing" | "done";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Select" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: FileOutput, label: "Single PDF output" },
] as const;

export default function ExtractPages() {
  const [step, setStep] = useState<Step>("upload");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFileName, setResultFileName] = useState("");
  const [resultStats, setResultStats] = useState("");
  const [options, setOptions] = useState<OutputOptions>({ outputFileName: "extracted" });

  const handleFileSelected = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const count = pdf.getPageCount();
      setSourceFile(file);
      setPageCount(count);
      setSelectedPages(new Set());
      setOptions({ outputFileName: file.name.replace(/\.pdf$/i, "") + "-extracted" });
      setStep("configure");
    } catch {
      console.error("Could not read PDF");
    }
  }, []);

  const togglePage = useCallback((page: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i)));
  }, [pageCount]);

  const clearAll = useCallback(() => {
    setSelectedPages(new Set());
  }, []);

  const handleProcess = useCallback(async () => {
    if (!sourceFile || selectedPages.size === 0) return;
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();

    try {
      const buffer = await sourceFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const indices = Array.from(selectedPages).sort((a, b) => a - b);

      const newPdf = await PDFDocument.create();
      const pages = await newPdf.copyPages(sourcePdf, indices);
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
      setResultFileName(options.outputFileName || "extracted");
      setResultStats(
        `Extracted <strong>${indices.length} page${indices.length !== 1 ? "s" : ""}</strong> from ${pageCount}-page PDF`
      );
      setStep("done");
    } catch (err) {
      console.error("Extract failed:", err);
      setStep("configure");
    }
  }, [sourceFile, selectedPages, pageCount, options.outputFileName]);

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
    setSelectedPages(new Set());
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
      icon={FileOutput}
      title="Extract Pages"
      subtitle="Pull specific pages into a new PDF"
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
          dragIcon={FileOutput}
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
                Select pages to extract
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {selectedPages.size} of {pageCount} selected
                </span>
              </h3>
              <div className="flex gap-1">
                <button
                  onClick={selectAll}
                  className="text-xs text-primary hover:text-primary/80 font-medium px-2 py-1 rounded-md hover:bg-primary/10 transition-colors"
                >
                  Select All
                </button>
                <button
                  onClick={clearAll}
                  className="text-xs text-muted-foreground hover:text-foreground font-medium px-2 py-1 rounded-md hover:bg-muted transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">
              {Array.from({ length: pageCount }, (_, i) => {
                const selected = selectedPages.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => togglePage(i)}
                    className={`
                      relative h-12 rounded-lg border-2 text-sm font-semibold transition-all duration-150
                      ${selected
                        ? "border-primary bg-primary text-primary-foreground shadow-sm scale-[1.02]"
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
            disabled={selectedPages.size === 0}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <FileOutput className="w-5 h-5" />
            {selectedPages.size === 0
              ? "Select pages to extract"
              : `Extract ${selectedPages.size} Page${selectedPages.size !== 1 ? "s" : ""}`}
            {selectedPages.size > 0 && <ArrowRight className="w-5 h-5" />}
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Extracting pages..."
          subtitle={`Building your new PDF in the browser`}
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && resultBlob && (
        <SuccessView
          title="Extraction Complete!"
          description={resultStats}
          fileName={resultFileName}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Extract More"
        />
      )}
    </ToolPageLayout>
  );
}
