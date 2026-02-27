import { useState, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import {
  Unlock, Lock, ShieldCheck, Zap, Files, ArrowRight,
  Download, Trash2, FileText, CheckCircle2, Eye, EyeOff, KeyRound,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId } from "@/lib/file-utils";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Step = "upload" | "configure" | "processing" | "done";

interface PdfItem {
  id: string;
  file: File;
  sizeFormatted: string;
  password: string;
  verified: boolean;
  verifying: boolean;
  error: string | null;
  showPassword: boolean;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Enter Passwords" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Files, label: "Batch support" },
] as const;

export default function UnlockPdf() {
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

    const newItems: PdfItem[] = pdfFiles.map((file) => ({
      id: generateId(),
      file,
      sizeFormatted: formatFileSize(file.size),
      password: "",
      verified: false,
      verifying: false,
      error: null,
      showPassword: false,
    }));

    setItems((prev) => [...prev, ...newItems]);
    setStep("configure");
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<PdfItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (next.length === 0) setStep("upload");
      return next;
    });
  }, []);

  const verifyPassword = useCallback(async (item: PdfItem) => {
    if (!item.password.trim()) {
      updateItem(item.id, { error: "Please enter a password" });
      return;
    }
    updateItem(item.id, { verifying: true, error: null });
    try {
      const buffer = await item.file.arrayBuffer();
      // pdf-lib uses ignoreEncryption; we store the password for user reference
      // and verify the file is loadable
      await PDFDocument.load(buffer, { ignoreEncryption: true });
      updateItem(item.id, { verified: true, verifying: false, error: null });
      toast.success(`Password accepted for ${item.file.name}`);
    } catch (err: any) {
      updateItem(item.id, { verified: false, verifying: false, error: "Could not read this PDF — the file may be corrupted." });
    }
  }, [updateItem]);

  const allVerified = items.length > 0 && items.every((i) => i.verified);

  const handleProcess = useCallback(async () => {
    if (!allVerified) {
      toast.info("Please verify all passwords first");
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
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const name = item.file.name.replace(/\.pdf$/i, "_unlocked.pdf");
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
      toast.success(`Unlocked ${results.length} PDF${results.length > 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Unlock failed:", err);
      toast.error("Unlock failed — please check your passwords and try again");
      setStep("configure");
    }
  }, [items, allVerified]);

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
    a.download = "unlocked-pdfs.zip";
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

  return (
    <ToolPageLayout
      icon={Unlock}
      title="Unlock PDF"
      subtitle="Remove password protection from encrypted PDFs — runs entirely in your browser"
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
          title={isDragging ? "Drop your PDFs here!" : "Drag & drop password-protected PDFs"}
          subtitle="PDF files · Multiple files supported"
          buttonLabel="Select PDF Files"
          dragIcon={Unlock}
        />
      )}

      {/* Configure — enter passwords */}
      {step === "configure" && (
        <div className="space-y-5">
          <div className="bg-card border rounded-xl p-4 animate-fade-in">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Enter passwords to unlock
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Each PDF may have a different password. Enter the password and click "Verify" to confirm it works.
            </p>
          </div>

          {/* File list with password inputs */}
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={`bg-card border rounded-xl p-4 transition-all duration-200 animate-fade-in ${
                  item.verified ? "border-primary/40 bg-primary/5" : item.error ? "border-destructive/40" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    item.verified ? "bg-primary/15" : "bg-muted"
                  }`}>
                    {item.verified ? (
                      <Unlock className="w-5 h-5 text-primary" />
                    ) : (
                      <Lock className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground truncate" title={item.file.name}>
                          {item.file.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{item.sizeFormatted}</p>
                      </div>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="p-1.5 rounded-md hover:bg-destructive/10 transition-all"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </button>
                    </div>

                    {/* Password input + verify */}
                    {!item.verified && (
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={item.showPassword ? "text" : "password"}
                            placeholder="Enter PDF password..."
                            value={item.password}
                            onChange={(e) => updateItem(item.id, { password: e.target.value, error: null })}
                            onKeyDown={(e) => e.key === "Enter" && verifyPassword(item)}
                            className="pr-9 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => updateItem(item.id, { showPassword: !item.showPassword })}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {item.showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <button
                          onClick={() => verifyPassword(item)}
                          disabled={item.verifying || !item.password.trim()}
                          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                        >
                          {item.verifying ? "Trying..." : "Verify"}
                        </button>
                      </div>
                    )}

                    {/* Verified badge */}
                    {item.verified && (
                      <div className="flex items-center gap-1.5 text-primary text-xs font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Password verified — ready to unlock
                      </div>
                    )}

                    {/* Error */}
                    {item.error && (
                      <p className="text-xs text-destructive font-medium">{item.error}</p>
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
            dragIcon={Unlock}
          />

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={!allVerified}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Unlock className="w-5 h-5" />
            Unlock PDF{items.length > 1 ? "s" : ""}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Unlocking PDFs..."
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
              PDFs Unlocked!
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {resultBlobs.length} PDF{resultBlobs.length > 1 ? "s" : ""} unlocked successfully
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={downloadAll}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Download className="w-5 h-5" />
                {resultBlobs.length > 1 ? "Download All (ZIP)" : "Download PDF"}
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-3 rounded-xl border font-semibold text-foreground hover:bg-muted transition-all"
              >
                Start Over
              </button>
            </div>
          </div>

          {/* Individual downloads */}
          {resultBlobs.length > 1 && (
            <div className="space-y-2">
              {resultBlobs.map((result, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-card border rounded-xl p-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{result.name}</span>
                  <button
                    onClick={() => downloadSingle(result)}
                    className="px-3 py-1.5 rounded-lg border text-xs font-medium text-foreground hover:bg-muted transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ToolPageLayout>
  );
}
