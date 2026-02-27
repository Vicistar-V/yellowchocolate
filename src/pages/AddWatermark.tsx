import { useState, useCallback, useRef } from "react";
import { PDFDocument, rgb, StandardFonts, degrees as pdfDegrees } from "pdf-lib";
import JSZip from "jszip";
import {
  Droplets, ShieldCheck, Zap, ArrowRight, Files, Download,
  FileText, CheckCircle2, RotateCcw, Type, ImageIcon,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { toast } from "sonner";

type Step = "upload" | "configure" | "processing" | "done";
type WatermarkType = "text" | "image";
type WatermarkPosition = "center" | "top" | "bottom" | "diagonal" | "tile";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Settings" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: Files, label: "Batch support" },
] as const;

const POSITION_OPTIONS: { value: WatermarkPosition; label: string; desc: string }[] = [
  { value: "center", label: "Center", desc: "Middle of the page" },
  { value: "diagonal", label: "Diagonal", desc: "Angled across page" },
  { value: "top", label: "Top", desc: "Top of the page" },
  { value: "bottom", label: "Bottom", desc: "Bottom of the page" },
  { value: "tile", label: "Tile", desc: "Repeated pattern" },
];

export default function AddWatermark() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlobs, setResultBlobs] = useState<{ name: string; blob: Blob }[]>([]);

  // Watermark settings
  const [watermarkType, setWatermarkType] = useState<WatermarkType>("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [fontSize, setFontSize] = useState(48);
  const [opacity, setOpacity] = useState(0.15);
  const [position, setPosition] = useState<WatermarkPosition>("diagonal");
  const [color, setColor] = useState<"gray" | "red" | "blue">("gray");

  // Image watermark
  const [watermarkImage, setWatermarkImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(0.3); // 30% of page width
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      const pdfFiles = newFiles.filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfFiles.length === 0) {
        toast.error("Please select PDF files");
        return;
      }
      const items: FileItem[] = pdfFiles.map((file) => ({
        id: generateId(),
        file,
        pageCount: null,
        sizeFormatted: formatFileSize(file.size),
      }));
      if (step === "upload") setStep("configure");
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

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setWatermarkImage(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const colorToRgb = (c: "gray" | "red" | "blue") => {
    if (c === "red") return rgb(0.8, 0.1, 0.1);
    if (c === "blue") return rgb(0.1, 0.1, 0.8);
    return rgb(0.5, 0.5, 0.5);
  };

  const handleProcess = useCallback(async () => {
    if (watermarkType === "text" && !text.trim()) {
      toast.error("Please enter watermark text");
      return;
    }
    if (watermarkType === "image" && !watermarkImage) {
      toast.error("Please select a watermark image");
      return;
    }

    setStep("processing");
    setProgress(0);
    const startTime = Date.now();
    const results: { name: string; blob: Blob }[] = [];

    // Pre-load image bytes if needed
    let imageBytes: Uint8Array | null = null;
    if (watermarkType === "image" && watermarkImage) {
      imageBytes = new Uint8Array(await watermarkImage.arrayBuffer());
    }

    try {
      for (let fi = 0; fi < files.length; fi++) {
        const fileItem = files[fi];
        const buffer = await fileItem.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();

        if (watermarkType === "text") {
          const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
          const textColor = colorToRgb(color);

          for (const page of pages) {
            const { width, height } = page.getSize();
            const textWidth = font.widthOfTextAtSize(text, fontSize);

            if (position === "diagonal") {
              const angle = Math.atan2(height, width) * (180 / Math.PI);
              page.drawText(text, {
                x: width / 2 - textWidth / 2 * Math.cos(angle * Math.PI / 180),
                y: height / 2 - fontSize / 2,
                size: fontSize,
                font,
                color: textColor,
                opacity,
                rotate: pdfDegrees(angle),
              });
            } else if (position === "center") {
              page.drawText(text, {
                x: (width - textWidth) / 2,
                y: height / 2 - fontSize / 2,
                size: fontSize,
                font,
                color: textColor,
                opacity,
              });
            } else if (position === "top") {
              page.drawText(text, {
                x: (width - textWidth) / 2,
                y: height - 60,
                size: fontSize,
                font,
                color: textColor,
                opacity,
              });
            } else if (position === "bottom") {
              page.drawText(text, {
                x: (width - textWidth) / 2,
                y: 40,
                size: fontSize,
                font,
                color: textColor,
                opacity,
              });
            } else if (position === "tile") {
              const spacingX = textWidth + 80;
              const spacingY = fontSize + 100;
              for (let ty = -height; ty < height * 2; ty += spacingY) {
                for (let tx = -width; tx < width * 2; tx += spacingX) {
                  page.drawText(text, {
                    x: tx,
                    y: ty,
                    size: fontSize * 0.6,
                    font,
                    color: textColor,
                    opacity: opacity * 0.7,
                    rotate: pdfDegrees(45),
                  });
                }
              }
            }
          }
        } else if (watermarkType === "image" && imageBytes) {
          let embeddedImage;
          const isPng = watermarkImage!.type === "image/png";
          if (isPng) {
            embeddedImage = await pdfDoc.embedPng(imageBytes);
          } else {
            embeddedImage = await pdfDoc.embedJpg(imageBytes);
          }

          for (const page of pages) {
            const { width, height } = page.getSize();
            const imgWidth = width * imageScale;
            const imgHeight = (embeddedImage.height / embeddedImage.width) * imgWidth;

            let x: number, y: number;
            if (position === "center" || position === "diagonal") {
              x = (width - imgWidth) / 2;
              y = (height - imgHeight) / 2;
            } else if (position === "top") {
              x = (width - imgWidth) / 2;
              y = height - imgHeight - 40;
            } else if (position === "bottom") {
              x = (width - imgWidth) / 2;
              y = 40;
            } else {
              // tile
              const spacingX = imgWidth + 50;
              const spacingY = imgHeight + 50;
              for (let ty = 0; ty < height; ty += spacingY) {
                for (let tx = 0; tx < width; tx += spacingX) {
                  page.drawImage(embeddedImage, {
                    x: tx,
                    y: ty,
                    width: imgWidth * 0.5,
                    height: imgHeight * 0.5,
                    opacity,
                  });
                }
              }
              continue; // skip single draw below
            }

            page.drawImage(embeddedImage, {
              x,
              y,
              width: imgWidth,
              height: imgHeight,
              opacity,
            });
          }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const name = fileItem.file.name.replace(/\.pdf$/i, "_watermarked.pdf");
        results.push({ name, blob });
        setProgress(Math.round(((fi + 1) / files.length) * 90));
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < 800) {
        setProgress(95);
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
      setProgress(100);
      setResultBlobs(results);
      setStep("done");
      toast.success(`Watermark added to ${results.length} PDF${results.length > 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Watermark failed:", err);
      toast.error("Failed to add watermark");
      setStep("configure");
    }
  }, [files, watermarkType, text, fontSize, opacity, position, color, watermarkImage, imageScale]);

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
    a.download = "watermarked-pdfs.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlobs, downloadSingle]);

  const handleReset = useCallback(() => {
    setFiles([]);
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
      icon={Droplets}
      title="Add Watermark"
      subtitle="Stamp text or image watermarks on your PDF pages"
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
          title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
          subtitle="PDF files · Multiple files supported"
          buttonLabel="Select PDF Files"
          dragIcon={Droplets}
        />
      )}

      {/* Configure */}
      {step === "configure" && (
        <div className="space-y-5">
          <FileList
            files={files}
            onRemove={handleRemove}
            onReorder={setFiles}
            headerTitle="PDFs to watermark"
            headerHint="Drag to reorder"
          />

          <FileDropZone
            onFilesSelected={handleFilesSelected}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            accept="application/pdf,.pdf"
            title={isDragging ? "Drop more!" : "Add more PDFs"}
            buttonLabel="Add More"
            dragIcon={Droplets}
          />

          {/* Watermark Settings */}
          <div className="bg-card border rounded-xl p-5 animate-fade-in space-y-6">
            <div className="flex items-center gap-2 mb-1">
              <Droplets className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Watermark Settings
              </h3>
            </div>

            {/* Type toggle */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Watermark Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setWatermarkType("text")}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all border ${
                    watermarkType === "text"
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card text-foreground border-border hover:border-primary/40"
                  }`}
                >
                  <Type className="w-4 h-4" /> Text
                </button>
                <button
                  onClick={() => setWatermarkType("image")}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all border ${
                    watermarkType === "image"
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card text-foreground border-border hover:border-primary/40"
                  }`}
                >
                  <ImageIcon className="w-4 h-4" /> Image
                </button>
              </div>
            </div>

            {/* Text settings */}
            {watermarkType === "text" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Watermark Text</label>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Enter watermark text..."
                    className="w-full px-4 py-3 rounded-lg border bg-card text-foreground text-sm"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">
                    Font Size: {fontSize}pt
                  </label>
                  <input
                    type="range"
                    min={16}
                    max={120}
                    step={2}
                    value={fontSize}
                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                    <span>Small</span>
                    <span>Large</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Color</label>
                  <div className="flex gap-2">
                    {(["gray", "red", "blue"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all border ${
                          color === c
                            ? "bg-primary text-primary-foreground border-primary shadow-md"
                            : "bg-card text-foreground border-border hover:border-primary/40"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Image settings */}
            {watermarkType === "image" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Watermark Image</label>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                  {imagePreview ? (
                    <div className="flex items-center gap-3">
                      <img src={imagePreview} alt="Watermark" className="w-16 h-16 object-contain border rounded-lg" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{watermarkImage?.name}</p>
                        <button
                          onClick={() => imageInputRef.current?.click()}
                          className="text-xs text-primary hover:underline mt-1"
                        >
                          Change image
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      className="w-full px-4 py-6 rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
                    >
                      Click to select a PNG or JPEG image
                    </button>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">
                    Image Size: {Math.round(imageScale * 100)}% of page width
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={0.8}
                    step={0.05}
                    value={imageScale}
                    onChange={(e) => setImageScale(parseFloat(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                    <span>Small</span>
                    <span>Large</span>
                  </div>
                </div>
              </>
            )}

            {/* Position */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Position</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {POSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPosition(opt.value)}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all border text-center ${
                      position === opt.value
                        ? "bg-primary text-primary-foreground border-primary shadow-md"
                        : "bg-card text-foreground border-border hover:border-primary/40"
                    }`}
                  >
                    <div>{opt.label}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Opacity */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                Opacity: {Math.round(opacity * 100)}%
              </label>
              <input
                type="range"
                min={0.02}
                max={0.8}
                step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                <span>Subtle</span>
                <span>Bold</span>
              </div>
            </div>
          </div>

          {/* Process button */}
          <button
            onClick={handleProcess}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <Droplets className="w-5 h-5" />
            Add Watermark to {files.length} PDF{files.length !== 1 ? "s" : ""}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Adding watermark..."
          subtitle={`Processing ${files.length} file${files.length > 1 ? "s" : ""}`}
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
              Watermark Added!
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {resultBlobs.length} PDF{resultBlobs.length > 1 ? "s" : ""} watermarked successfully
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={downloadAll}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Download className="w-5 h-5" />
                {resultBlobs.length === 1 ? `Download ${resultBlobs[0].name}` : "Download All (.zip)"}
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-5 py-3 rounded-xl border bg-card text-foreground font-medium hover:bg-muted transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                Start Over
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/60 text-center">
            Everything processed in your browser — nothing was uploaded.
          </p>
        </div>
      )}
    </ToolPageLayout>
  );
}
