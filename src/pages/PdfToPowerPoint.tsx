import { useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { PresentationIcon, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { downloadBlob } from "@/lib/download-utils";
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
  { icon: Zap, label: "Instant conversion" },
  { icon: Files, label: "Batch support" },
] as const;

const ACCEPT = "application/pdf,.pdf";

async function pdfToPptx(buffer: ArrayBuffer, onProgress?: (p: number) => void): Promise<Blob> {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pptx = new PptxGenJS();
  // Set default slide size to match standard 16:9
  pptx.defineLayout({ name: "LAYOUT_WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "LAYOUT_WIDE";

  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const scale = 2.5; // Higher scale for better quality
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const dataUrl = canvas.toDataURL("image/jpeg", 0.95);

      const slide = pptx.addSlide();

      // Calculate aspect-fit dimensions
      const pageAspect = viewport.width / viewport.height;
      const slideAspect = 13.33 / 7.5;
      let imgW: number, imgH: number, imgX: number, imgY: number;

      if (pageAspect > slideAspect) {
        imgW = 13.33;
        imgH = 13.33 / pageAspect;
        imgX = 0;
        imgY = (7.5 - imgH) / 2;
      } else {
        imgH = 7.5;
        imgW = 7.5 * pageAspect;
        imgX = (13.33 - imgW) / 2;
        imgY = 0;
      }

      slide.addImage({
        data: dataUrl,
        x: imgX,
        y: imgY,
        w: imgW,
        h: imgH,
      });
    } catch (err) {
      console.warn(`Failed to render page ${i}:`, err);
      const slide = pptx.addSlide();
      slide.addText(`Page ${i} — could not be rendered`, {
        x: 1, y: 3, w: 8, h: 1,
        fontSize: 18, color: "999999", italic: true, align: "center",
      });
    }

    onProgress?.(Math.round((i / pdf.numPages) * 90));
  }

  const arrayBuffer = await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer;
  onProgress?.(100);
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

export default function PdfToPowerPoint() {
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
        const blob = await pdfToPptx(buffer, (p) => {
          setProgress(Math.round(((i + p / 100) / files.length) * 100));
        });
        const baseName = file.name.replace(/\.pdf$/i, "");
        results.push({ name: `${baseName}.pptx`, blob });
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
      toast.success(`Converted ${results.length} file${results.length > 1 ? "s" : ""} to PowerPoint`);
    } catch (err) {
      console.error("PDF to PowerPoint failed:", err);
      toast.error("Conversion failed", { description: String(err instanceof Error ? err.message : "Could not process one or more files.") });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const filename = convertedCount > 1 ? "pdf-to-pptx.zip" : `${files[0]?.file.name.replace(/\.pdf$/i, "")}.pptx`;
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

  return (
    <ToolPageLayout
      icon={PresentationIcon}
      title="PDF to PowerPoint"
      subtitle="Convert PDF pages to PPTX slides — batch supported"
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
              dragIcon={PresentationIcon}
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
                dragIcon={PresentationIcon}
              />
              <button
                onClick={handleConvert}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <PresentationIcon className="w-5 h-5" />
                Convert {files.length} PDF{files.length !== 1 ? "s" : ""} to PowerPoint
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <ProcessingView title="Converting PDF to PowerPoint..." subtitle={`Processing ${files.length} file${files.length !== 1 ? "s" : ""} in your browser`} progress={progress} />
      )}

      {step === "done" && resultBlob && (
        <SuccessView
          title="Conversion Complete!"
          description={`<strong>${convertedCount}</strong> file${convertedCount > 1 ? "s" : ""} converted to PowerPoint`}
          fileName={convertedCount > 1 ? "pdf-to-pptx" : files[0]?.file.name.replace(/\.pdf$/i, "") || "presentation"}
          fileExtension={convertedCount > 1 ? ".zip" : ".pptx"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Convert More"
        />
      )}
    </ToolPageLayout>
  );
}
