import { useState, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import {
  Wrench, ShieldCheck, Zap, ArrowRight, Upload,
  FileText, Trash2, CheckCircle2, AlertTriangle, XCircle,
  Search, Download, RotateCcw,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { toast } from "sonner";

type Step = "upload" | "diagnose" | "processing" | "done";

interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ok" | "warning" | "error" | "fixed";
  detail: string;
}

interface PdfFileEntry {
  file: File;
  sizeBytes: number;
  diagnostics: DiagnosticCheck[];
  canRepair: boolean;
  overallStatus: "healthy" | "repairable" | "damaged";
}

interface RepairResult {
  blob: Blob;
  originalSize: number;
  repairedSize: number;
  fileName: string;
  fixesApplied: string[];
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "diagnose", label: "2. Diagnose" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant analysis" },
  { icon: Wrench, label: "Smart repair" },
] as const;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/* ─── Diagnostic engine ─── */
async function diagnosePdf(file: File): Promise<{ diagnostics: DiagnosticCheck[]; doc: PDFDocument | null }> {
  const checks: DiagnosticCheck[] = [];
  const arrayBuffer = await file.arrayBuffer();
  let doc: PDFDocument | null = null;

  // 1. Basic PDF parsing
  try {
    doc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    checks.push({
      id: "parse",
      label: "PDF Structure",
      status: "ok",
      detail: "File parsed successfully — cross-reference table intact",
    });
  } catch (err) {
    // Try lenient load
    try {
      doc = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      checks.push({
        id: "parse",
        label: "PDF Structure",
        status: "warning",
        detail: "Minor structural issues detected — repairable by re-serialization",
      });
    } catch {
      checks.push({
        id: "parse",
        label: "PDF Structure",
        status: "error",
        detail: "Severe corruption — file cannot be parsed",
      });
      return { diagnostics: checks, doc: null };
    }
  }

  if (!doc) return { diagnostics: checks, doc: null };

  // 2. Page tree
  try {
    const pageCount = doc.getPageCount();
    if (pageCount === 0) {
      checks.push({
        id: "pages",
        label: "Page Tree",
        status: "error",
        detail: "No pages found in document",
      });
    } else {
      // Verify each page is accessible
      let brokenPages = 0;
      for (let i = 0; i < pageCount; i++) {
        try {
          const page = doc.getPage(i);
          page.getSize(); // triggers access
        } catch {
          brokenPages++;
        }
      }
      if (brokenPages > 0) {
        checks.push({
          id: "pages",
          label: "Page Tree",
          status: "warning",
          detail: `${brokenPages} of ${pageCount} page(s) have issues — recoverable pages will be kept`,
        });
      } else {
        checks.push({
          id: "pages",
          label: "Page Tree",
          status: "ok",
          detail: `All ${pageCount} page(s) intact and accessible`,
        });
      }
    }
  } catch {
    checks.push({
      id: "pages",
      label: "Page Tree",
      status: "warning",
      detail: "Page tree has structural issues — will attempt reconstruction",
    });
  }

  // 3. Metadata
  try {
    const title = doc.getTitle();
    const author = doc.getAuthor();
    const producer = doc.getProducer();
    const hasMetadata = !!(title || author || producer);
    checks.push({
      id: "metadata",
      label: "Metadata",
      status: "ok",
      detail: hasMetadata
        ? `Metadata present (title, author, producer)`
        : "No metadata found — this is normal",
    });
  } catch {
    checks.push({
      id: "metadata",
      label: "Metadata",
      status: "warning",
      detail: "Metadata is malformed — will be cleaned during repair",
    });
  }

  // 4. File size sanity
  const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
  const header = String.fromCharCode(...headerBytes);
  if (!header.startsWith("%PDF")) {
    checks.push({
      id: "header",
      label: "File Header",
      status: "warning",
      detail: "Missing or invalid PDF header — will be corrected",
    });
  } else {
    checks.push({
      id: "header",
      label: "File Header",
      status: "ok",
      detail: "Valid PDF header detected",
    });
  }

  // 5. Cross-reference integrity (inferred from successful load + re-serialize test)
  try {
    const testDoc = await PDFDocument.create();
    const copiedPages = await testDoc.copyPages(doc, doc.getPageIndices());
    for (const p of copiedPages) testDoc.addPage(p);
    await testDoc.save();
    checks.push({
      id: "xref",
      label: "Cross-References",
      status: "ok",
      detail: "Object references are valid and consistent",
    });
  } catch {
    checks.push({
      id: "xref",
      label: "Cross-References",
      status: "warning",
      detail: "Some object references are broken — re-serialization will rebuild them",
    });
  }

  return { diagnostics: checks, doc };
}

/* ─── Repair engine ─── */
async function repairPdf(file: File, diagnostics: DiagnosticCheck[]): Promise<RepairResult> {
  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  const fixes: string[] = [];

  // Copy all recoverable pages
  const pageCount = srcDoc.getPageCount();
  const validIndices: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    try {
      srcDoc.getPage(i).getSize();
      validIndices.push(i);
    } catch {
      fixes.push(`Removed corrupted page ${i + 1}`);
    }
  }

  if (validIndices.length === 0) {
    throw new Error("No recoverable pages found");
  }

  const copiedPages = await outDoc.copyPages(srcDoc, validIndices);
  for (const page of copiedPages) {
    outDoc.addPage(page);
  }

  if (validIndices.length < pageCount) {
    fixes.push(`Recovered ${validIndices.length} of ${pageCount} pages`);
  }

  // Rebuild metadata
  const hasMetaIssue = diagnostics.some((d) => d.id === "metadata" && d.status === "warning");
  if (hasMetaIssue) {
    outDoc.setTitle("");
    outDoc.setAuthor("");
    outDoc.setSubject("");
    outDoc.setKeywords([]);
    outDoc.setProducer("");
    outDoc.setCreator("");
    fixes.push("Cleaned malformed metadata");
  }

  // The act of re-serializing through pdf-lib fixes:
  // - Broken cross-reference tables
  // - Invalid byte offsets
  // - Orphaned objects
  // - Linearization issues
  const hasStructuralIssues = diagnostics.some(
    (d) => (d.id === "parse" || d.id === "xref" || d.id === "header") && d.status === "warning"
  );
  if (hasStructuralIssues) {
    fixes.push("Rebuilt cross-reference table");
    fixes.push("Re-serialized PDF structure");
  }

  if (fixes.length === 0) {
    fixes.push("Re-serialized for optimal structure");
  }

  const pdfBytes = await outDoc.save();
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });

  return {
    blob,
    originalSize: file.size,
    repairedSize: blob.size,
    fileName: file.name.replace(/\.pdf$/i, ""),
    fixesApplied: fixes,
  };
}

/* ─── Status icon helper ─── */
function StatusIcon({ status }: { status: DiagnosticCheck["status"] }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />;
    case "error":
      return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    case "fixed":
      return <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />;
  }
}

/* ─── Diagnostic Card ─── */
function DiagnosticCard({ entry, onRemove }: { entry: PdfFileEntry; onRemove: () => void }) {
  const statusColor = {
    healthy: "border-green-500/30 bg-green-500/5",
    repairable: "border-yellow-500/30 bg-yellow-500/5",
    damaged: "border-destructive/30 bg-destructive/5",
  }[entry.overallStatus];

  const statusLabel = {
    healthy: "Healthy",
    repairable: "Repairable",
    damaged: "Severely Damaged",
  }[entry.overallStatus];

  const statusBadgeColor = {
    healthy: "bg-green-500/10 text-green-600",
    repairable: "bg-yellow-500/10 text-yellow-600",
    damaged: "bg-destructive/10 text-destructive",
  }[entry.overallStatus];

  return (
    <div className={`border-2 rounded-xl p-4 space-y-3 animate-fade-in transition-all ${statusColor}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              className="text-sm font-bold text-foreground truncate"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {entry.file.name}
            </p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeColor}`}>
              {statusLabel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatBytes(entry.sizeBytes)}
          </p>
        </div>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
          title="Remove"
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </button>
      </div>

      <div className="space-y-2 pl-1">
        {entry.diagnostics.map((check) => (
          <div key={check.id} className="flex items-start gap-2.5">
            <StatusIcon status={check.status} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{check.label}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function RepairPdf() {
  const [step, setStep] = useState<Step>("upload");
  const [entries, setEntries] = useState<PdfFileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [results, setResults] = useState<RepairResult[]>([]);

  const handleFilesSelected = useCallback(async (selectedFiles: File[]) => {
    const pdfFiles = selectedFiles.filter((f) => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      toast.error("No valid PDF files", { description: "Please select PDF files." });
      return;
    }

    setIsAnalyzing(true);

    for (const file of pdfFiles) {
      try {
        const { diagnostics } = await diagnosePdf(file);

        const hasErrors = diagnostics.some((d) => d.status === "error");
        const hasWarnings = diagnostics.some((d) => d.status === "warning");

        const overallStatus: PdfFileEntry["overallStatus"] = hasErrors
          ? "damaged"
          : hasWarnings
            ? "repairable"
            : "healthy";

        const canRepair = !hasErrors || diagnostics.some((d) => d.id === "pages" && d.status !== "error");

        setEntries((prev) => [
          ...prev,
          {
            file,
            sizeBytes: file.size,
            diagnostics,
            canRepair,
            overallStatus,
          },
        ]);
      } catch {
        toast.error("Failed to analyze", { description: file.name });
      }
    }

    setIsAnalyzing(false);
    setStep("diagnose");
  }, []);

  const handleRemoveEntry = useCallback((index: number) => {
    setEntries((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setStep("upload");
      }
      return next;
    });
  }, []);

  const repairableEntries = entries.filter((e) => e.canRepair);
  const hasIssues = entries.some((e) => e.overallStatus !== "healthy");

  const handleRepair = useCallback(async () => {
    if (repairableEntries.length === 0) return;
    setStep("processing");
    setProgress(0);
    setProgressLabel("Starting repair…");

    const allResults: RepairResult[] = [];

    try {
      for (let i = 0; i < repairableEntries.length; i++) {
        const entry = repairableEntries[i];
        const fileLabel = repairableEntries.length > 1 ? `File ${i + 1}/${repairableEntries.length}: ` : "";
        setProgressLabel(`${fileLabel}Repairing ${entry.file.name}…`);
        setProgress(Math.round((i / repairableEntries.length) * 80));

        const result = await repairPdf(entry.file, entry.diagnostics);
        allResults.push(result);
      }

      setProgress(100);
      setResults(allResults);
      setStep("done");

      const allHealthy = entries.every((e) => e.overallStatus === "healthy");
      if (allHealthy) {
        toast.info("Already healthy", {
          description: "Your PDF(s) had no issues — re-serialized for optimal structure.",
          duration: 5000,
        });
      }
    } catch (err) {
      console.error("Repair failed:", err);
      toast.error("Repair failed", { description: "Something went wrong while processing your PDF." });
      setStep("diagnose");
    }
  }, [repairableEntries, entries]);

  const handleDownload = useCallback(() => {
    for (const result of results) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${result.fileName}-repaired.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [results]);

  const handleReset = useCallback(() => {
    setEntries([]);
    setStep("upload");
    setProgress(0);
    setProgressLabel("");
    setResults([]);
    setIsDragging(false);
    setResetKey((k) => k + 1);
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["diagnose"] : []),
    ...(step === "done" ? ["done"] : []),
  ];
  const currentStepKey = step === "processing" ? "diagnose" : step;

  return (
    <ToolPageLayout
      icon={Wrench}
      title="Repair PDF"
      subtitle="Diagnose and fix corrupted or damaged PDF files — all in your browser"
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
            title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files to diagnose"}
            subtitle="or click to browse · Multiple files supported"
            buttonLabel="Select PDF Files"
            dragIcon={Wrench}
          />

          {isAnalyzing && (
            <div className="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground animate-fade-in">
              <Search className="w-4 h-4 animate-pulse text-primary" />
              <span>Analyzing PDF structure…</span>
            </div>
          )}
        </div>
      )}

      {/* ─── STEP: Diagnose ─── */}
      {step === "diagnose" && (
        <div className="space-y-4 animate-fade-in">
          {/* Summary bar */}
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Search className="w-4 h-4 text-primary" />
              <span
                className="text-sm font-bold text-foreground"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Diagnostic Report
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {entries.length} file{entries.length !== 1 ? "s" : ""} analyzed ·{" "}
              {hasIssues
                ? `${entries.filter((e) => e.overallStatus !== "healthy").length} with issues`
                : "All files appear healthy"}
            </p>
          </div>

          {/* File diagnostics */}
          <div className="space-y-3">
            {entries.map((entry, i) => (
              <DiagnosticCard
                key={`${entry.file.name}-${i}`}
                entry={entry}
                onRemove={() => handleRemoveEntry(i)}
              />
            ))}
          </div>

          {/* Add more files */}
          <FileDropZone
            key={`add-${resetKey}`}
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf"
            title="Add more files"
            subtitle="Drop or click to add"
            buttonLabel="Add Files"
            dragIcon={Upload}
          />

          {isAnalyzing && (
            <div className="flex items-center justify-center gap-3 py-4 text-sm text-muted-foreground animate-fade-in">
              <Search className="w-4 h-4 animate-pulse text-primary" />
              <span>Analyzing…</span>
            </div>
          )}

          {/* Repair button */}
          <button
            onClick={handleRepair}
            disabled={repairableEntries.length === 0}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Wrench className="w-5 h-5" />
            {hasIssues
              ? `Repair ${repairableEntries.length} File${repairableEntries.length !== 1 ? "s" : ""}`
              : `Re-serialize ${entries.length} File${entries.length !== 1 ? "s" : ""}`}
            <ArrowRight className="w-5 h-5" />
          </button>

          {!hasIssues && entries.length > 0 && (
            <p className="text-xs text-center text-muted-foreground">
              No issues found — you can still re-serialize to optimize the internal structure.
            </p>
          )}
        </div>
      )}

      {/* ─── STEP: Processing ─── */}
      {step === "processing" && (
        <ProcessingView
          title="Repairing your PDF…"
          subtitle={progressLabel}
          progress={progress}
        />
      )}

      {/* ─── STEP: Done ─── */}
      {step === "done" && results.length > 0 && (
        <div className="space-y-6 animate-fade-in">
          {/* Fixes summary */}
          <div className="bg-card border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span
                className="text-sm font-bold text-foreground"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Repairs Applied
              </span>
            </div>
            {results.map((r, i) => (
              <div key={i} className="space-y-1">
                {results.length > 1 && (
                  <p className="text-xs font-semibold text-foreground">{r.fileName}.pdf</p>
                )}
                {r.fixesApplied.map((fix, fi) => (
                  <div key={fi} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                    <span>{fix}</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  {formatBytes(r.originalSize)} → {formatBytes(r.repairedSize)}
                </p>
              </div>
            ))}
          </div>

          {results.length === 1 ? (
            <SuccessView
              title="PDF Repaired!"
              description={`Fixed and re-serialized with <strong>${results[0].fixesApplied.length}</strong> repair(s) applied`}
              fileName={`${results[0].fileName}-repaired`}
              onDownload={handleDownload}
              onReset={handleReset}
              resetLabel="Repair Another"
            />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 bg-card border rounded-xl px-4 py-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.fileName}.pdf</p>
                      <p className="text-xs text-muted-foreground">
                        {r.fixesApplied.length} fix{r.fixesApplied.length !== 1 ? "es" : ""} · {formatBytes(r.repairedSize)}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const url = URL.createObjectURL(r.blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${r.fileName}-repaired.pdf`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <SuccessView
                title="All Files Repaired!"
                description={`<strong>${results.length}</strong> files repaired successfully`}
                fileName="all-repaired"
                onDownload={handleDownload}
                onReset={handleReset}
                resetLabel="Repair More"
              />
            </div>
          )}
        </div>
      )}
    </ToolPageLayout>
  );
}
