import { useState, useCallback, useMemo } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import {
  Lock, ShieldCheck, Zap, Files, ArrowRight,
  Download, Trash2, FileText, CheckCircle2, Eye, EyeOff,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId } from "@/lib/file-utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

type Step = "upload" | "configure" | "processing" | "done";

interface PdfItem {
  id: string;
  file: File;
  sizeFormatted: string;
  pageCount: number;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Set Password" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Files, label: "Batch support" },
] as const;

type PasswordStrength = "weak" | "medium" | "strong";

function getPasswordStrength(pw: string): PasswordStrength {
  if (pw.length < 6) return "weak";
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasNum = /[0-9]/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);
  const score = [hasUpper, hasLower, hasNum, hasSpecial].filter(Boolean).length;
  if (pw.length >= 10 && score >= 3) return "strong";
  if (pw.length >= 8 && score >= 2) return "medium";
  return "weak";
}

const STRENGTH_CONFIG: Record<PasswordStrength, { label: string; color: string; width: string }> = {
  weak: { label: "Weak", color: "bg-destructive", width: "w-1/3" },
  medium: { label: "Medium", color: "bg-yellow-500", width: "w-2/3" },
  strong: { label: "Strong", color: "bg-green-500", width: "w-full" },
};

export default function ProtectPdf() {
  const [step, setStep] = useState<Step>("upload");
  const [items, setItems] = useState<PdfItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlobs, setResultBlobs] = useState<{ name: string; blob: Blob }[]>([]);

  // Password config
  const [userPassword, setUserPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);

  // Permissions (visual)
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(false);
  const [allowModifying, setAllowModifying] = useState(false);

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
        newItems.push({
          id: generateId(),
          file,
          sizeFormatted: formatFileSize(file.size),
          pageCount: pdfDoc.getPageCount(),
        });
      } catch {
        toast.error(`Failed to read: ${file.name}`);
      }
    }

    setItems((prev) => [...prev, ...newItems]);
    setStep("configure");
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (next.length === 0) setStep("upload");
      return next;
    });
  }, []);

  const strength = useMemo(() => getPasswordStrength(userPassword), [userPassword]);
  const strengthCfg = STRENGTH_CONFIG[strength];
  const passwordsMatch = userPassword === confirmPassword;
  const canProcess = userPassword.length >= 1 && passwordsMatch && items.length > 0;

  const handleProcess = useCallback(async () => {
    if (!canProcess) return;
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();
    const results: { name: string; blob: Blob }[] = [];

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const buffer = await item.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

        const saveOptions: any = {
          userPassword,
        };
        if (ownerPassword.trim()) {
          saveOptions.ownerPassword = ownerPassword;
        }
        // pdf-lib permissions support
        saveOptions.permissions = {
          printing: allowPrinting ? "highResolution" : undefined,
          copying: allowCopying,
          modifying: allowModifying,
        };

        const pdfBytes = await pdfDoc.save(saveOptions);
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const name = item.file.name.replace(/\.pdf$/i, "_protected.pdf");
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
      toast.success(`Protected ${results.length} PDF${results.length > 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Protect failed:", err);
      toast.error("Protection failed");
      setStep("configure");
    }
  }, [items, canProcess, userPassword, ownerPassword, allowPrinting, allowCopying, allowModifying]);

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
    a.download = "protected-pdfs.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlobs, downloadSingle]);

  const handleReset = useCallback(() => {
    setItems([]);
    setResultBlobs([]);
    setProgress(0);
    setUserPassword("");
    setConfirmPassword("");
    setOwnerPassword("");
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  return (
    <ToolPageLayout
      icon={Lock}
      title="Protect PDF"
      subtitle="Encrypt PDFs with a password to keep sensitive data confidential"
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
          title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDFs to protect"}
          subtitle="PDF files · Multiple files supported"
          buttonLabel="Select PDF Files"
          dragIcon={Lock}
        />
      )}

      {/* Configure */}
      {step === "configure" && (
        <div className="space-y-5">
          {/* File list */}
          <div className="bg-card border rounded-xl p-4 animate-fade-in">
            <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {items.length} PDF{items.length > 1 ? "s" : ""} to protect
            </span>
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 bg-muted/50 rounded-lg p-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.file.name}</p>
                    <p className="text-[11px] text-muted-foreground">{item.sizeFormatted} · {item.pageCount} pg{item.pageCount > 1 ? "s" : ""}</p>
                  </div>
                  <button onClick={() => removeItem(item.id)} className="p-1.5 rounded-md hover:bg-destructive/10 transition-all">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Password configuration */}
          <div className="bg-card border rounded-xl p-5 space-y-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Password Settings
              </span>
            </div>

            {/* User password */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">User Password (required to open)</label>
              <div className="relative">
                <Input
                  type={showUserPassword ? "text" : "password"}
                  placeholder="Enter password..."
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowUserPassword(!showUserPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showUserPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Strength meter */}
              {userPassword.length > 0 && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-300 ${strengthCfg.color} ${strengthCfg.width}`} />
                  </div>
                  <p className={`text-[11px] font-medium ${
                    strength === "weak" ? "text-destructive" : strength === "medium" ? "text-orange-500 dark:text-yellow-400" : "text-green-600 dark:text-green-400"
                  }`}>
                    {strengthCfg.label} password
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Confirm Password</label>
              <Input
                type="password"
                placeholder="Re-enter password..."
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-[11px] text-destructive font-medium">Passwords do not match</p>
              )}
              {confirmPassword.length > 0 && passwordsMatch && (
                <p className="text-[11px] text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Passwords match
                </p>
              )}
            </div>

            {/* Owner password (optional) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Owner Password <span className="text-muted-foreground">(optional)</span></label>
              <div className="relative">
                <Input
                  type={showOwnerPassword ? "text" : "password"}
                  placeholder="Controls permissions..."
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowOwnerPassword(!showOwnerPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showOwnerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                If set, this password controls print/copy/modify permissions separately from opening.
              </p>
            </div>

            {/* Permissions */}
            <div className="space-y-3 pt-2 border-t">
              <label className="text-xs font-medium text-foreground">Permissions</label>
              <div className="space-y-2.5">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Checkbox checked={allowPrinting} onCheckedChange={(v) => setAllowPrinting(!!v)} />
                  <span className="text-sm text-foreground">Allow printing</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Checkbox checked={allowCopying} onCheckedChange={(v) => setAllowCopying(!!v)} />
                  <span className="text-sm text-foreground">Allow copying text & images</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Checkbox checked={allowModifying} onCheckedChange={(v) => setAllowModifying(!!v)} />
                  <span className="text-sm text-foreground">Allow modifying</span>
                </label>
              </div>
            </div>
          </div>

          {/* Add more */}
          <FileDropZone
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf,.pdf"
            title={isDragging ? "Drop more!" : "Add more PDFs"}
            buttonLabel="Add More"
            dragIcon={Lock}
          />

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={!canProcess}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Lock className="w-5 h-5" />
            Protect PDF{items.length > 1 ? "s" : ""}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Encrypting PDFs..."
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
              PDFs Protected!
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {resultBlobs.length} PDF{resultBlobs.length > 1 ? "s" : ""} encrypted successfully
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
