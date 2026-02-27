import { useState, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import {
  Scissors, ShieldCheck, Zap, FileOutput, ArrowRight,
  MousePointerClick, SplitSquareHorizontal, Layers, FileStack,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { OutputConfig, type OutputOptions } from "@/components/tool/OutputConfig";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize } from "@/lib/file-utils";

type SplitStep = "upload" | "configure" | "splitting" | "done";

type SplitMode = "select" | "ranges" | "every" | "all";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Configure" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Scissors, label: "Precise control" },
] as const;

const SPLIT_MODES: { key: SplitMode; icon: React.ElementType; label: string; desc: string }[] = [
  { key: "select", icon: MousePointerClick, label: "Pick Pages", desc: "Click to select specific pages" },
  { key: "ranges", icon: SplitSquareHorizontal, label: "Page Ranges", desc: "e.g. 1-3, 5, 8-10" },
  { key: "every", icon: Layers, label: "Every N Pages", desc: "Split into equal chunks" },
  { key: "all", icon: FileStack, label: "Extract All", desc: "One PDF per page" },
];

export default function SplitPdf() {
  const [step, setStep] = useState<SplitStep>("upload");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>("select");
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [everyN, setEveryN] = useState(1);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFileName, setResultFileName] = useState("");
  const [resultStats, setResultStats] = useState("");
  const [isSingleFile, setIsSingleFile] = useState(false);
  const [options, setOptions] = useState<OutputOptions>({ outputFileName: "split-output" });

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
      setRangeInput("");
      setEveryN(Math.max(1, Math.ceil(count / 2)));
      setOptions({ outputFileName: file.name.replace(/\.pdf$/i, "") + "-split" });
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

  const deselectAll = useCallback(() => {
    setSelectedPages(new Set());
  }, []);

  /** Parse "1-3, 5, 8-10" → array of 0-indexed page arrays (each sub-array = one output file) */
  function parseRanges(input: string, max: number): number[][] {
    const groups: number[][] = [];
    const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const match = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (match) {
        const start = Math.max(1, parseInt(match[1]));
        const end = Math.min(max, parseInt(match[2]));
        if (start <= end) {
          groups.push(Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
        }
      } else {
        const num = parseInt(part);
        if (!isNaN(num) && num >= 1 && num <= max) {
          groups.push([num - 1]);
        }
      }
    }
    return groups;
  }

  function getPageGroups(): number[][] {
    switch (splitMode) {
      case "select":
        // selected pages → single output PDF
        return [Array.from(selectedPages).sort((a, b) => a - b)];
      case "ranges":
        return parseRanges(rangeInput, pageCount);
      case "every": {
        const groups: number[][] = [];
        for (let i = 0; i < pageCount; i += everyN) {
          groups.push(Array.from({ length: Math.min(everyN, pageCount - i) }, (_, j) => i + j));
        }
        return groups;
      }
      case "all":
        return Array.from({ length: pageCount }, (_, i) => [i]);
      default:
        return [];
    }
  }

  const canSplit = useCallback(() => {
    switch (splitMode) {
      case "select":
        return selectedPages.size > 0;
      case "ranges":
        return parseRanges(rangeInput, pageCount).length > 0;
      case "every":
        return everyN >= 1 && everyN <= pageCount;
      case "all":
        return pageCount > 0;
      default:
        return false;
    }
  }, [splitMode, selectedPages, rangeInput, everyN, pageCount]);

  const handleSplit = useCallback(async () => {
    if (!sourceFile) return;
    setStep("splitting");
    setProgress(0);
    const startTime = Date.now();

    try {
      const buffer = await sourceFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const groups = getPageGroups();

      if (groups.length === 0) {
        setStep("configure");
        return;
      }

      const single = groups.length === 1;
      setIsSingleFile(single);

      if (single) {
        // single output PDF
        const newPdf = await PDFDocument.create();
        const pages = await newPdf.copyPages(sourcePdf, groups[0]);
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
        setResultFileName(options.outputFileName || "split");
        setResultStats(`Extracted <strong>${groups[0].length} page${groups[0].length !== 1 ? "s" : ""}</strong> from ${pageCount}-page PDF`);
      } else {
        // multiple output PDFs → ZIP
        const zip = new JSZip();
        for (let i = 0; i < groups.length; i++) {
          const newPdf = await PDFDocument.create();
          const pages = await newPdf.copyPages(sourcePdf, groups[i]);
          pages.forEach((p) => newPdf.addPage(p));
          const bytes = await newPdf.save();
          const name = `${options.outputFileName || "split"}-${String(i + 1).padStart(3, "0")}.pdf`;
          zip.file(name, bytes);
          setProgress(Math.round(((i + 1) / groups.length) * 80));
        }

        setProgress(85);
        const zipBlob = await zip.generateAsync({ type: "blob" });
        
        const elapsed = Date.now() - startTime;
        if (elapsed < 2000) {
          setProgress(95);
          await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.6));
          setProgress(100);
          await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.4));
        }

        setResultBlob(zipBlob);
        setResultFileName(options.outputFileName || "split");
        setResultStats(`Split into <strong>${groups.length} files</strong> from ${pageCount}-page PDF`);
      }

      setStep("done");
    } catch (err) {
      console.error("Split failed:", err);
      setStep("configure");
    }
  }, [sourceFile, splitMode, selectedPages, rangeInput, everyN, pageCount, options.outputFileName]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isSingleFile
      ? `${resultFileName}.pdf`
      : `${resultFileName}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlob, resultFileName, isSingleFile]);

  const handleReset = useCallback(() => {
    setSourceFile(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setRangeInput("");
    setEveryN(1);
    setProgress(0);
    setResultBlob(null);
    setResultFileName("");
    setResultStats("");
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "splitting" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const currentStepKey = step === "splitting" ? "configure" : step;

  const actionLabel = (() => {
    switch (splitMode) {
      case "select":
        return `Extract ${selectedPages.size} Page${selectedPages.size !== 1 ? "s" : ""}`;
      case "ranges": {
        const g = parseRanges(rangeInput, pageCount);
        return `Split into ${g.length} File${g.length !== 1 ? "s" : ""}`;
      }
      case "every": {
        const chunks = Math.ceil(pageCount / Math.max(1, everyN));
        return `Split into ${chunks} File${chunks !== 1 ? "s" : ""}`;
      }
      case "all":
        return `Extract All ${pageCount} Pages`;
      default:
        return "Split";
    }
  })();

  return (
    <ToolPageLayout
      icon={Scissors}
      title="Split PDF"
      subtitle="Extract pages or split into multiple files"
      steps={STEPS}
      currentStep={currentStepKey}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {/* Upload step */}
      {step === "upload" && (
        <FileDropZone
          onFilesSelected={handleFileSelected}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          accept="application/pdf"
          title={isDragging ? "Drop your PDF here!" : "Drag & drop a PDF file here"}
          subtitle="or click to browse · Single file"
          buttonLabel="Select PDF File"
          dragIcon={Scissors}
        />
      )}

      {/* Configure step */}
      {step === "configure" && sourceFile && (
        <div className="space-y-5 animate-fade-in">
          {/* File info bar */}
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

          {/* Split mode selector */}
          <div>
            <h3
              className="text-sm font-semibold text-foreground mb-3"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Split Mode
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SPLIT_MODES.map((mode) => {
                const active = splitMode === mode.key;
                return (
                  <button
                    key={mode.key}
                    onClick={() => setSplitMode(mode.key)}
                    className={`
                      relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-200 text-center
                      ${active
                        ? "border-primary bg-primary/8 shadow-sm"
                        : "border-border hover:border-primary/30 hover:bg-muted/40"
                      }
                    `}
                  >
                    <mode.icon className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span
                      className={`text-xs font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}
                      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {mode.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-tight">{mode.desc}</span>
                    {active && (
                      <div className="absolute -top-px -right-px w-3 h-3 rounded-full bg-primary border-2 border-background" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode-specific config */}
          {splitMode === "select" && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <h3
                  className="text-sm font-semibold text-foreground"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  Select Pages
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {selectedPages.size} of {pageCount} selected
                  </span>
                </h3>
                <div className="flex gap-1">
                  <button
                    onClick={selectAll}
                    className="text-xs text-primary hover:text-primary/80 font-medium px-2 py-1 rounded-md hover:bg-primary/10 transition-colors"
                  >
                    All
                  </button>
                  <button
                    onClick={deselectAll}
                    className="text-xs text-muted-foreground hover:text-foreground font-medium px-2 py-1 rounded-md hover:bg-muted transition-colors"
                  >
                    None
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
          )}

          {splitMode === "ranges" && (
            <div className="animate-fade-in">
              <label className="block text-sm font-semibold text-foreground mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Page Ranges
              </label>
              <input
                type="text"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder="e.g. 1-3, 5, 8-10"
                className="w-full h-11 rounded-xl border bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Each range or page number creates a separate PDF · Pages 1–{pageCount} available
              </p>
              {parseRanges(rangeInput, pageCount).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {parseRanges(rangeInput, pageCount).map((group, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-semibold"
                    >
                      {group.length === 1
                        ? `Page ${group[0] + 1}`
                        : `Pages ${group[0] + 1}–${group[group.length - 1] + 1}`
                      }
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {splitMode === "every" && (
            <div className="animate-fade-in">
              <label className="block text-sm font-semibold text-foreground mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Pages per chunk
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={pageCount}
                  value={everyN}
                  onChange={(e) => setEveryN(parseInt(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span
                  className="w-14 h-11 rounded-xl border bg-card flex items-center justify-center text-sm font-bold text-foreground"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {everyN}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Creates {Math.ceil(pageCount / Math.max(1, everyN))} file{Math.ceil(pageCount / Math.max(1, everyN)) !== 1 ? "s" : ""} with {everyN} page{everyN !== 1 ? "s" : ""} each
              </p>
            </div>
          )}

          {splitMode === "all" && (
            <div className="animate-fade-in p-4 rounded-xl bg-primary/5 border border-primary/20">
              <p className="text-sm text-foreground">
                Each page will be extracted as a separate PDF file. You'll get a <strong>ZIP</strong> containing {pageCount} PDF{pageCount !== 1 ? "s" : ""}.
              </p>
            </div>
          )}

          {/* Output config */}
          <OutputConfig
            options={options}
            onChange={setOptions}
            title="Split Settings"
          />

          {/* Action button */}
          <button
            onClick={handleSplit}
            disabled={!canSplit()}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Scissors className="w-5 h-5" />
            {actionLabel}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "splitting" && (
        <ProcessingView
          title="Splitting your PDF..."
          subtitle={`Processing ${pageCount} pages in your browser`}
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && resultBlob && (
        <SuccessView
          title="Split Complete!"
          description={resultStats}
          fileName={resultFileName}
          fileExtension={isSingleFile ? ".pdf" : ".zip"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Split Another"
        />
      )}
    </ToolPageLayout>
  );
}
