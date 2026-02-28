import { useState, useCallback } from "react";
import JSZip from "jszip";
import { Presentation, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

const ACCEPT = ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/* ─── PPTX Parser ─── */

interface SlideContent {
  texts: string[];
  images: { data: Uint8Array; mime: string }[];
}

/** Decode common XML entities */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

async function parsePptx(buffer: ArrayBuffer): Promise<SlideContent[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slides: SlideContent[] = [];

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

    // Extract text — improved regex to handle attributes on <a:t>
    const texts: string[] = [];
    const paragraphs = xml.split(/<a:p[\s>]/);

    for (const para of paragraphs) {
      const paraTexts: string[] = [];
      // Match <a:t> with optional attributes
      const matches = para.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/gs);
      for (const m of matches) {
        paraTexts.push(decodeXmlEntities(m[1]));
      }
      const joined = paraTexts.join("").trim();
      if (joined) {
        texts.push(joined);
      }
    }

    // Extract image relationships
    const images: { data: Uint8Array; mime: string }[] = [];
    const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relFile = zip.file(relPath);

    if (relFile) {
      const relXml = await relFile.async("text");
      const imgRels = relXml.matchAll(/Target="([^"]*\.(png|jpe?g|gif|bmp|svg|tif|tiff|emf|wmf))"/gi);

      for (const rel of imgRels) {
        let imgPath = rel[1];
        if (imgPath.startsWith("../")) {
          imgPath = "ppt/" + imgPath.slice(3);
        }
        const imgFile = zip.file(imgPath);
        if (imgFile) {
          try {
            const data = await imgFile.async("uint8array");
            const ext = rel[2].toLowerCase();
            const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
            images.push({ data, mime });
          } catch {
            // skip unreadable images
          }
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
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const slideW = 720; // 10" * 72
  const slideH = 405; // 5.625" * 72 (16:9)
  const marginX = 40;
  const marginTop = 50;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const page = pdfDoc.addPage([slideW, slideH]);

    // White background
    page.drawRectangle({ x: 0, y: 0, width: slideW, height: slideH, color: rgb(1, 1, 1) });

    let y = slideH - marginTop;

    // Embed images
    if (slide.images.length > 0) {
      for (const imgData of slide.images.slice(0, 2)) {
        try {
          let embeddedImg;
          if (imgData.mime === "image/png") {
            embeddedImg = await pdfDoc.embedPng(imgData.data);
          } else if (imgData.mime === "image/jpeg" || imgData.mime === "image/jpg") {
            embeddedImg = await pdfDoc.embedJpg(imgData.data);
          } else {
            continue; // skip unsupported formats
          }

          const maxW = slideW - marginX * 2;
          const maxH = 180;
          const scale = Math.min(maxW / embeddedImg.width, maxH / embeddedImg.height, 1);
          const drawW = embeddedImg.width * scale;
          const drawH = embeddedImg.height * scale;
          const drawX = (slideW - drawW) / 2;

          page.drawImage(embeddedImg, { x: drawX, y: y - drawH, width: drawW, height: drawH });
          y -= drawH + 12;
        } catch {
          // skip problematic images
        }
      }
    }

    // Draw title
    if (slide.texts.length > 0) {
      const titleSize = 22;
      const titleText = slide.texts[0];
      const titleWidth = bold.widthOfTextAtSize(titleText, titleSize);
      const titleX = Math.max(marginX, (slideW - titleWidth) / 2);

      if (y - titleSize > 20) {
        page.drawText(titleText.slice(0, 80), {
          x: titleX,
          y: y - titleSize,
          size: titleSize,
          font: bold,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= titleSize * 1.5;
      }
    }

    // Draw body text
    for (let t = 1; t < slide.texts.length && y > 30; t++) {
      const bodySize = 13;
      const lineH = bodySize * 1.5;
      const text = slide.texts[t];
      const textWidth = regular.widthOfTextAtSize(text, bodySize);
      const textX = Math.max(marginX, (slideW - textWidth) / 2);

      page.drawText(text.slice(0, 120), {
        x: textX,
        y: y - bodySize,
        size: bodySize,
        font: regular,
        color: rgb(0.25, 0.25, 0.25),
      });
      y -= lineH;
    }

    // Empty slide placeholder
    if (slide.texts.length === 0 && slide.images.length === 0) {
      const placeholderText = `Slide ${i + 1}`;
      const phSize = 20;
      const phWidth = italic.widthOfTextAtSize(placeholderText, phSize);
      page.drawText(placeholderText, {
        x: (slideW - phWidth) / 2,
        y: slideH / 2,
        size: phSize,
        font: italic,
        color: rgb(0.6, 0.6, 0.6),
      });
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
      toast.error("Conversion failed", { description: String(err instanceof Error ? err.message : "Could not process one or more files.") });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const isZip = convertedCount > 1;
    const filename = isZip ? "pptx-to-pdf.zip" : `${files[0]?.file.name.replace(/\.(pptx?|PPTX?)$/, "")}.pdf`;
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
