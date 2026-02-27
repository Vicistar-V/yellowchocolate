import { useState, useCallback } from "react";
import JSZip from "jszip";
import { Presentation, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { toast } from "sonner";
import html2canvas from "html2canvas";

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

const ACCEPT = ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/* ─── PPTX Parser ─── */

interface SlideContent {
  texts: string[];
  images: { data: Uint8Array; mime: string }[];
}

async function parsePptx(buffer: ArrayBuffer): Promise<SlideContent[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slides: SlideContent[] = [];

  // Find slide files
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  for (const slidePath of slideFiles) {
    const xml = await zip.file(slidePath)?.async("text");
    if (!xml) continue;

    // Extract text content from XML
    const texts: string[] = [];
    const textMatches = xml.matchAll(/<a:t>(.*?)<\/a:t>/g);
    let currentParagraph = "";
    const paragraphs = xml.split(/<a:p[\s>]/);

    for (const para of paragraphs) {
      const paraTexts: string[] = [];
      const matches = para.matchAll(/<a:t>(.*?)<\/a:t>/g);
      for (const m of matches) {
        paraTexts.push(m[1]);
      }
      if (paraTexts.length > 0) {
        texts.push(paraTexts.join(""));
      }
    }

    // Extract image relationships
    const images: { data: Uint8Array; mime: string }[] = [];
    const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relFile = zip.file(relPath);

    if (relFile) {
      const relXml = await relFile.async("text");
      const imgRels = relXml.matchAll(/Target="([^"]*\.(png|jpe?g|gif|bmp|svg))"/gi);

      for (const rel of imgRels) {
        let imgPath = rel[1];
        if (imgPath.startsWith("../")) {
          imgPath = "ppt/" + imgPath.slice(3);
        }
        const imgFile = zip.file(imgPath);
        if (imgFile) {
          const data = await imgFile.async("uint8array");
          const ext = rel[2].toLowerCase();
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
          images.push({ data, mime });
        }
      }
    }

    slides.push({ texts, images });
  }

  return slides;
}

async function renderSlidesToPdf(
  slides: SlideContent[],
  onProgress?: (p: number) => void
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const slideWidth = 960;
  const slideHeight = 540;
  const pdfW = 720;  // 10in * 72pt
  const pdfH = 405;  // 5.625in * 72pt (16:9)

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];

    // Build slide HTML
    const container = document.createElement("div");
    container.style.cssText = `
      position: fixed; top: -99999px; left: -99999px;
      width: ${slideWidth}px; height: ${slideHeight}px;
      background: white; padding: 40px 50px;
      box-sizing: border-box; display: flex; flex-direction: column;
      justify-content: center; font-family: 'Segoe UI', Arial, sans-serif;
      overflow: hidden;
    `;

    // Add images first (as background / visual)
    if (slide.images.length > 0) {
      for (const img of slide.images.slice(0, 2)) {
        const blob = new Blob([img.data.buffer as ArrayBuffer], { type: img.mime });
        const url = URL.createObjectURL(blob);
        const imgEl = document.createElement("img");
        imgEl.src = url;
        imgEl.style.cssText = "max-width: 100%; max-height: 200px; object-fit: contain; margin: 8px auto; display: block;";
        container.appendChild(imgEl);

        // Wait for image to load
        await new Promise<void>((resolve) => {
          imgEl.onload = () => resolve();
          imgEl.onerror = () => resolve();
          setTimeout(resolve, 1000);
        });
      }
    }

    // Add text content
    if (slide.texts.length > 0) {
      const titleText = slide.texts[0];
      const titleEl = document.createElement("h1");
      titleEl.textContent = titleText;
      titleEl.style.cssText = "font-size: 28px; font-weight: 700; margin: 0 0 16px; color: #1a1a1a; text-align: center;";
      container.appendChild(titleEl);

      for (let t = 1; t < slide.texts.length; t++) {
        const pEl = document.createElement("p");
        pEl.textContent = slide.texts[t];
        pEl.style.cssText = "font-size: 16px; margin: 4px 0; color: #333; text-align: center; line-height: 1.5;";
        container.appendChild(pEl);
      }
    }

    // If slide is empty, show placeholder
    if (slide.texts.length === 0 && slide.images.length === 0) {
      const emptyEl = document.createElement("p");
      emptyEl.textContent = `Slide ${i + 1}`;
      emptyEl.style.cssText = "font-size: 24px; color: #999; text-align: center; font-style: italic;";
      container.appendChild(emptyEl);
    }

    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, {
        scale: 2,
        backgroundColor: "#ffffff",
        width: slideWidth,
        height: slideHeight,
        logging: false,
      });

      const dataUrl = canvas.toDataURL("image/png");
      const imgBytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
      const img = await pdfDoc.embedPng(imgBytes);

      const page = pdfDoc.addPage([pdfW, pdfH]);
      page.drawImage(img, { x: 0, y: 0, width: pdfW, height: pdfH });
    } finally {
      document.body.removeChild(container);
      // Clean up blob URLs
    }

    onProgress?.(Math.round(((i + 1) / slides.length) * 95));
  }

  const bytes = await pdfDoc.save();
  onProgress?.(100);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

/* ─── Main Component ─── */

export default function PowerPointToPdf() {
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
      const pdfBlobs: { name: string; blob: Blob }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i].file;
        const buffer = await file.arrayBuffer();
        const slides = await parsePptx(buffer);

        if (slides.length === 0) {
          toast.error(`No slides found in ${file.name}`);
          continue;
        }

        const blob = await renderSlidesToPdf(slides, (p) => {
          const fileProgress = ((i + p / 100) / files.length) * 100;
          setProgress(Math.round(fileProgress));
        });

        const baseName = file.name.replace(/\.(pptx?|PPTX?)$/, "");
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
      toast.success(`Converted ${pdfBlobs.length} presentation${pdfBlobs.length > 1 ? "s" : ""} successfully`);
    } catch (err) {
      console.error("PowerPoint to PDF failed:", err);
      toast.error("Conversion failed", { description: "Could not process one or more files." });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    const isZip = convertedCount > 1;
    a.download = isZip ? "pptx-to-pdf.zip" : `${files[0]?.file.name.replace(/\.(pptx?|PPTX?)$/, "")}.pdf`;
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
      icon={Presentation}
      title="PowerPoint to PDF"
      subtitle="Convert PPTX presentations to PDF — batch supported"
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
              title={isDragging ? "Drop your presentations here!" : "Drag & drop PowerPoint files here"}
              subtitle="PPTX supported · Multiple files allowed"
              buttonLabel="Select PowerPoint Files"
              dragIcon={Presentation}
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
                title={isDragging ? "Drop more files!" : "Add more presentations"}
                buttonLabel="Add More Files"
                dragIcon={Presentation}
              />

              <button
                onClick={handleConvert}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Presentation className="w-5 h-5" />
                Convert {files.length} File{files.length !== 1 ? "s" : ""} to PDF
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <ProcessingView
          title="Converting PowerPoint to PDF..."
          subtitle={`Processing ${files.length} presentation${files.length !== 1 ? "s" : ""} in your browser`}
          progress={progress}
        />
      )}

      {step === "done" && resultBlob && (
        <SuccessView
          title="Conversion Complete!"
          description={`<strong>${convertedCount}</strong> presentation${convertedCount > 1 ? "s" : ""} converted to PDF`}
          fileName={convertedCount > 1 ? "pptx-to-pdf" : files[0]?.file.name.replace(/\.(pptx?|PPTX?)$/, "") || "presentation"}
          fileExtension={convertedCount > 1 ? ".zip" : ".pdf"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Convert More"
        />
      )}
    </ToolPageLayout>
  );
}
