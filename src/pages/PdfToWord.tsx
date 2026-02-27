import { useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } from "docx";
import JSZip from "jszip";
import { FileDown, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "ready" | "processing" | "done";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "ready", label: "2. Convert" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant extraction" },
  { icon: Files, label: "Batch support" },
] as const;

const ACCEPT = "application/pdf,.pdf";

async function extractPdfText(buffer: ArrayBuffer, onProgress?: (p: number) => void): Promise<string[][]> {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[][] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let lastY: number | null = null;
    let currentLine = "";

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const textItem = item as { str: string; transform: number[] };
      const y = Math.round(textItem.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 5) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = "";
      }
      currentLine += textItem.str;
      lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    pages.push(lines);
    onProgress?.(Math.round((i / pdf.numPages) * 90));
  }

  return pages;
}

function buildDocx(pages: string[][]): Promise<Blob> {
  const sections = pages.map((lines, pageIdx) => {
    const paragraphs: Paragraph[] = [];

    // Page header
    if (pages.length > 1) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: `Page ${pageIdx + 1}`, bold: true, size: 28 })],
        })
      );
    }

    for (const line of lines) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { after: 120 },
        })
      );
    }

    if (lines.length === 0) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: "(No text content on this page)", italics: true, color: "999999", size: 22 })] }));
    }

    return { children: paragraphs };
  });

  const doc = new Document({ sections });
  return Packer.toBlob(doc);
}

export default function PdfToWord() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [convertedCount, setConvertedCount] = useState(0);

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      const items: FileItem[] = newFiles.map((file) => ({
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
      const results: { name: string; blob: Blob }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i].file;
        const buffer = await file.arrayBuffer();
        const pages = await extractPdfText(buffer, (p) => {
          const fileProgress = ((i + p / 100) / files.length) * 100;
          setProgress(Math.round(fileProgress));
        });

        const blob = await buildDocx(pages);
        const baseName = file.name.replace(/\.pdf$/i, "");
        results.push({ name: `${baseName}.docx`, blob });
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(2000 - elapsed, 0);
      if (remaining > 0) {
        setProgress(90);
        await new Promise((r) => setTimeout(r, remaining * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, remaining * 0.4));
      }

      if (results.length === 1) {
        setResultBlob(results[0].blob);
      } else {
        const zip = new JSZip();
        results.forEach((item) => zip.file(item.name, item.blob));
        setResultBlob(await zip.generateAsync({ type: "blob" }));
      }

      setConvertedCount(results.length);
      setStep("done");
      toast.success(`Converted ${results.length} file${results.length > 1 ? "s" : ""} to Word`);
    } catch (err) {
      console.error("PDF to Word failed:", err);
      toast.error("Conversion failed", { description: "Could not process one or more files." });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = convertedCount > 1 ? "pdf-to-word.zip" : `${files[0]?.file.name.replace(/\.pdf$/i, "")}.docx`;
    a.click();
    URL.revokeObjectURL(url);
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

  return (
    <ToolPageLayout
      icon={FileDown}
      title="PDF to Word"
      subtitle="Extract text from PDFs into editable DOCX — batch supported"
      steps={STEPS}
      currentStep={step === "processing" ? "ready" : step}
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
              title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
              subtitle="PDF files · Multiple files supported"
              buttonLabel="Select PDF Files"
              dragIcon={FileDown}
            />
          )}
          {step === "ready" && (
            <>
              <FileList files={files} onRemove={handleRemove} onReorder={setFiles} headerTitle="Files to convert" headerHint="Drag to reorder" />
              <FileDropZone
                onFilesSelected={handleFilesSelected}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
                accept={ACCEPT}
                title={isDragging ? "Drop more files!" : "Add more PDFs"}
                buttonLabel="Add More Files"
                dragIcon={FileDown}
              />
              <button
                onClick={handleConvert}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <FileDown className="w-5 h-5" />
                Convert {files.length} PDF{files.length !== 1 ? "s" : ""} to Word
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <ProcessingView title="Converting PDF to Word..." subtitle={`Processing ${files.length} file${files.length !== 1 ? "s" : ""} in your browser`} progress={progress} />
      )}

      {step === "done" && resultBlob && (
        <SuccessView
          title="Conversion Complete!"
          description={`<strong>${convertedCount}</strong> file${convertedCount > 1 ? "s" : ""} converted to Word`}
          fileName={convertedCount > 1 ? "pdf-to-word" : files[0]?.file.name.replace(/\.pdf$/i, "") || "document"}
          fileExtension={convertedCount > 1 ? ".zip" : ".docx"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Convert More"
        />
      )}
    </ToolPageLayout>
  );
}
