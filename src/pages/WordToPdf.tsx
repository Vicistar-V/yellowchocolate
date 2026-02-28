import { useState, useCallback } from "react";
import mammoth from "mammoth";
import JSZip from "jszip";
import { FileText, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { renderHtmlToPdf } from "@/lib/html-to-pdf-renderer";
import { downloadBlob } from "@/lib/download-utils";
import { toast } from "sonner";

type Step = "upload" | "ready" | "processing" | "done";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "ready", label: "2. Convert" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant conversion" },
  { icon: Files, label: "Batch support" },
] as const;

// Only accept .docx — mammoth doesn't reliably handle legacy .doc
const ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const WORD_CSS = `
  h1 { font-size: 26px; font-weight: 700; margin: 0 0 12px; color: #1a1a1a; }
  h2 { font-size: 22px; font-weight: 600; margin: 20px 0 8px; color: #1a1a1a; }
  h3 { font-size: 18px; font-weight: 600; margin: 16px 0 6px; color: #1a1a1a; }
  p { margin: 0 0 10px; }
  ul, ol { margin: 0 0 10px; padding-left: 24px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; font-size: 13px; }
  th { background: #f5f5f5; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  strong { font-weight: 600; }
`;

export default function WordToPdf() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [convertedCount, setConvertedCount] = useState(0);

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      // Filter out .doc files and warn
      const valid: File[] = [];
      for (const f of newFiles) {
        if (f.name.toLowerCase().endsWith(".doc") && !f.name.toLowerCase().endsWith(".docx")) {
          toast.error(`"${f.name}" is a legacy .doc file`, {
            description: "Only .docx files are supported. Please re-save as .docx in Word.",
          });
        } else {
          valid.push(f);
        }
      }
      if (valid.length === 0) return;

      const items: FileItem[] = valid.map((file) => ({
        id: generateId(),
        file,
        pageCount: null,
        sizeFormatted: formatFileSize(file.size),
      }));
      if (step === "upload") setStep("ready");
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
      const pdfBlobs: { name: string; blob: Blob }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i].file;
        const buffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });

        // Show warnings if any
        if (result.messages && result.messages.length > 0) {
          const warnings = result.messages.map((m: any) => m.message || String(m)).join("; ");
          console.warn(`mammoth warnings for ${file.name}:`, warnings);
        }

        let htmlContent = result.value;

        // Fallback: if HTML is empty/whitespace, try raw text extraction
        if (!htmlContent || htmlContent.replace(/<[^>]*>/g, "").trim().length === 0) {
          const textResult = await mammoth.extractRawText({ arrayBuffer: buffer });
          const rawText = textResult.value?.trim();
          if (rawText) {
            htmlContent = rawText
              .split("\n")
              .map((line: string) => `<p>${line || "&nbsp;"}</p>`)
              .join("");
            toast.info(`"${file.name}": Used plain-text fallback (limited formatting)`);
          } else {
            toast.warning(`"${file.name}" appears to be empty or unsupported`);
            htmlContent = `<p style="color:#999;font-style:italic;">No extractable content found in this document.</p>`;
          }
        }

        const blob = await renderHtmlToPdf(htmlContent, {
          css: WORD_CSS,
          onProgress: (p) => {
            const fileProgress = ((i + p / 100) / files.length) * 100;
            setProgress(Math.round(fileProgress));
          },
        });

        const baseName = file.name.replace(/\.(docx?|DOCX?)$/, "");
        pdfBlobs.push({ name: `${baseName}.pdf`, blob });
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(2000 - elapsed, 0);
      if (remaining > 0) {
        setProgress(90);
        await new Promise((r) => setTimeout(r, remaining * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, remaining * 0.4));
      }

      if (pdfBlobs.length === 0) {
        toast.error("No files could be converted");
        setStep("ready");
        return;
      }

      if (pdfBlobs.length === 1) {
        setResultBlob(pdfBlobs[0].blob);
      } else {
        const zip = new JSZip();
        pdfBlobs.forEach((item) => zip.file(item.name, item.blob));
        const zipBlob = await zip.generateAsync({ type: "blob" });
        setResultBlob(zipBlob);
      }

      setConvertedCount(pdfBlobs.length);
      setStep("done");
      toast.success(`Converted ${pdfBlobs.length} file${pdfBlobs.length > 1 ? "s" : ""} successfully`);
    } catch (err) {
      console.error("Word to PDF failed:", err);
      toast.error("Conversion failed", { description: String(err instanceof Error ? err.message : "Could not process one or more files.") });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const isZip = convertedCount > 1;
    const filename = isZip ? "word-to-pdf.zip" : `${files[0]?.file.name.replace(/\.(docx?|DOCX?)$/, "")}.pdf`;
    downloadBlob(resultBlob, filename);
  }, [resultBlob, convertedCount, files]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setResultBlob(null);
    setConvertedCount(0);
    setProgress(0);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["ready"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const currentStepKey = step === "processing" ? "ready" : step;

  return (
    <ToolPageLayout
      icon={FileText}
      title="Word to PDF"
      subtitle="Convert DOCX files to PDF — batch supported"
      steps={STEPS}
      currentStep={currentStepKey}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {(step === "upload" || step === "ready") && (
        <div className="space-y-5">
          {step === "upload" && (
            <FileDropZone
              onFilesSelected={handleFilesSelected}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              accept={ACCEPT}
              title={isDragging ? "Drop your Word files here!" : "Drag & drop Word documents here"}
              subtitle="DOCX supported · Multiple files allowed"
              buttonLabel="Select Word Files"
              dragIcon={FileText}
            />
          )}

          {step === "ready" && (
            <>
              <FileList
                files={files}
                onRemove={handleRemove}
                onReorder={setFiles}
                headerTitle="Files to convert"
                headerHint="Drag to reorder"
              />

              <FileDropZone
                onFilesSelected={handleFilesSelected}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
                accept={ACCEPT}
                title={isDragging ? "Drop more files!" : "Add more Word files"}
                buttonLabel="Add More Files"
                dragIcon={FileText}
              />

              <button
                onClick={handleConvert}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <FileText className="w-5 h-5" />
                Convert {files.length} File{files.length !== 1 ? "s" : ""} to PDF
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <ProcessingView
          title="Converting Word to PDF..."
          subtitle={`Processing ${files.length} file${files.length !== 1 ? "s" : ""} in your browser`}
          progress={progress}
        />
      )}

      {step === "done" && resultBlob && (
        <SuccessView
          title="Conversion Complete!"
          description={`<strong>${convertedCount}</strong> file${convertedCount > 1 ? "s" : ""} converted to PDF`}
          fileName={convertedCount > 1 ? "word-to-pdf" : files[0]?.file.name.replace(/\.(docx?|DOCX?)$/, "") || "document"}
          fileExtension={convertedCount > 1 ? ".zip" : ".pdf"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Convert More"
        />
      )}
    </ToolPageLayout>
  );
}
