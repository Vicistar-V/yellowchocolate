import { useState, useCallback } from "react";
import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { FileText, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
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

// Only accept .docx
const ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DOCX_RENDER_CSS = `
  .docx-wrapper { background: white; }
`;

const waitForImage = (img: HTMLImageElement) =>
  new Promise<void>((resolve) => {
    if (img.complete) return resolve();
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });

const canvasToPngBytes = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not generate image for PDF page");
  return new Uint8Array(await blob.arrayBuffer());
};

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
        const { renderAsync } = await import("docx-preview");

        const A4_WIDTH_PX = 794;
        const SCALE = 2;
        const PDF_PAGE_WIDTH = 595.28;
        const PDF_PAGE_HEIGHT = 841.89;

        const renderRoot = document.createElement("div");
        renderRoot.style.cssText = `position:fixed;left:-100000px;top:0;width:${A4_WIDTH_PX}px;opacity:1;pointer-events:none;z-index:-1;overflow:visible;background:#fff;`;
        document.body.appendChild(renderRoot);

        // styleHost must be OUTSIDE bodyContainer because renderAsync clears bodyContainer innerHTML
        const styleHost = document.createElement("div");
        renderRoot.appendChild(styleHost);

        const globalStyle = document.createElement("style");
        globalStyle.textContent = DOCX_RENDER_CSS;
        styleHost.appendChild(globalStyle);

        const container = document.createElement("div");
        container.style.cssText = `position:relative;width:${A4_WIDTH_PX}px;min-height:1px;background:#fff;overflow:visible;`;
        renderRoot.appendChild(container);

        try {
          await renderAsync(buffer, container, styleHost, {
            inWrapper: true,
            breakPages: true,
            ignoreWidth: false,
            ignoreHeight: false,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
            experimental: true,
          });

          await Promise.all(Array.from(renderRoot.querySelectorAll("img")).map((img) => waitForImage(img as HTMLImageElement)));

          // Give fonts & layout time to settle
          await new Promise<void>((resolve) => setTimeout(() => resolve(), 300));
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

          setProgress(Math.round(((i + 0.35) / files.length) * 100));

          if (!document.body.contains(container)) {
            throw new Error("Render target detached before capture");
          }

          setProgress(Math.round(((i + 0.55) / files.length) * 100));

          const pdfDoc = await PDFDocument.create();
          const docxPages = Array.from(container.querySelectorAll(".docx-wrapper > section, .docx > section")) as HTMLElement[];
          const pageElements = docxPages.filter((el) => el.scrollWidth > 0 && el.scrollHeight > 0);

          if (pageElements.length > 0) {
            for (const pageEl of pageElements) {
              const pageCanvas = await html2canvas(pageEl, {
                scale: SCALE,
                useCORS: true,
                allowTaint: false,
                backgroundColor: "#ffffff",
                windowWidth: pageEl.scrollWidth || A4_WIDTH_PX,
                width: pageEl.scrollWidth || A4_WIDTH_PX,
                height: pageEl.scrollHeight,
                scrollX: 0,
                scrollY: 0,
              });

              const pngImage = await pdfDoc.embedPng(await canvasToPngBytes(pageCanvas));
              const pageHeight = (pageCanvas.height * PDF_PAGE_WIDTH) / pageCanvas.width;
              const page = pdfDoc.addPage([PDF_PAGE_WIDTH, pageHeight]);
              page.drawImage(pngImage, { x: 0, y: 0, width: PDF_PAGE_WIDTH, height: pageHeight });
            }
          } else {
            const canvas = await html2canvas(container, {
              scale: SCALE,
              useCORS: true,
              allowTaint: false,
              backgroundColor: "#ffffff",
              windowWidth: A4_WIDTH_PX,
              width: container.scrollWidth || A4_WIDTH_PX,
              height: container.scrollHeight,
              scrollX: 0,
              scrollY: 0,
            });

            const pageHeightPx = Math.round((canvas.width * PDF_PAGE_HEIGHT) / PDF_PAGE_WIDTH);
            const numPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

            for (let p = 0; p < numPages; p++) {
              const yOffset = p * pageHeightPx;
              const sliceHeight = Math.min(pageHeightPx, canvas.height - yOffset);

              const sliceCanvas = document.createElement("canvas");
              sliceCanvas.width = canvas.width;
              sliceCanvas.height = sliceHeight;
              const ctx = sliceCanvas.getContext("2d");
              if (!ctx) throw new Error("Could not render PDF page slice");

              ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

              const pngImage = await pdfDoc.embedPng(await canvasToPngBytes(sliceCanvas));
              const pageHeight = (sliceHeight / pageHeightPx) * PDF_PAGE_HEIGHT;
              const page = pdfDoc.addPage([PDF_PAGE_WIDTH, pageHeight]);
              page.drawImage(pngImage, { x: 0, y: 0, width: PDF_PAGE_WIDTH, height: pageHeight });
            }
          }

          setProgress(Math.round(((i + 0.65) / files.length) * 100));
          const pdfBytes = await pdfDoc.save();
          const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });

          setProgress(Math.round(((i + 0.9) / files.length) * 100));

          const baseName = file.name.replace(/\.(docx?|DOCX?)$/, "");
          pdfBlobs.push({ name: `${baseName}.pdf`, blob });
        } finally {
          renderRoot.remove();
        }
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
