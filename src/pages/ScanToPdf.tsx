import { useState, useCallback, useRef, useEffect } from "react";
import { PDFDocument } from "pdf-lib";
import {
  ScanLine, ShieldCheck, Zap, ArrowRight, RotateCw,
  Trash2, GripVertical, Camera, Upload, Sun, Contrast,
  Palette, Image as ImageIcon, Plus, X,
} from "lucide-react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  TouchSensor, useSensor, useSensors, DragOverlay,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { OutputConfig, type OutputOptions } from "@/components/tool/OutputConfig";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { generateId } from "@/lib/file-utils";
import { toast } from "sonner";

type Step = "capture" | "configure" | "processing" | "done";

type ColorFilter = "color" | "grayscale" | "bw";
type PageSize = "a4" | "letter" | "fit";

interface ScannedPage {
  id: string;
  originalDataUrl: string; // original image
  rotation: number; // 0, 90, 180, 270
  brightness: number; // -100 to 100, default 0
  contrast: number; // -100 to 100, default 0
  filter: ColorFilter;
  width: number;
  height: number;
}

const STEPS = [
  { key: "capture", label: "1. Capture" },
  { key: "configure", label: "2. Enhance" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: ScanLine, label: "Camera & files" },
] as const;

const PAGE_SIZES: { value: PageSize; label: string; desc: string }[] = [
  { value: "a4", label: "A4", desc: "210 × 297 mm" },
  { value: "letter", label: "Letter", desc: "8.5 × 11 in" },
  { value: "fit", label: "Fit to Image", desc: "Original size" },
];

const FILTER_OPTIONS: { value: ColorFilter; label: string }[] = [
  { value: "color", label: "Color" },
  { value: "grayscale", label: "Grayscale" },
  { value: "bw", label: "B&W" },
];

/* ─── Apply image enhancements via canvas ─── */
function applyEnhancements(
  img: HTMLImageElement,
  page: ScannedPage,
  targetWidth?: number,
  targetHeight?: number,
): HTMLCanvasElement {
  const w = targetWidth ?? img.naturalWidth;
  const h = targetHeight ?? img.naturalHeight;
  
  // Handle rotation dimensions
  const isRotated = page.rotation === 90 || page.rotation === 270;
  const canvasW = isRotated ? h : w;
  const canvasH = isRotated ? w : h;
  
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;
  
  // Apply rotation
  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.rotate((page.rotation * Math.PI) / 180);
  if (isRotated) {
    ctx.drawImage(img, -canvasH / 2, -canvasW / 2, canvasH, canvasW);
  } else {
    ctx.drawImage(img, -canvasW / 2, -canvasH / 2, canvasW, canvasH);
  }
  ctx.restore();
  
  // Apply brightness and contrast
  if (page.brightness !== 0 || page.contrast !== 0) {
    const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
    const data = imageData.data;
    const brightnessAdj = (page.brightness / 100) * 255;
    const contrastFactor = (259 * (page.contrast + 255)) / (255 * (259 - page.contrast));
    
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.max(0, Math.min(255, contrastFactor * (data[i] - 128) + 128 + brightnessAdj));
      data[i + 1] = Math.max(0, Math.min(255, contrastFactor * (data[i + 1] - 128) + 128 + brightnessAdj));
      data[i + 2] = Math.max(0, Math.min(255, contrastFactor * (data[i + 2] - 128) + 128 + brightnessAdj));
    }
    ctx.putImageData(imageData, 0, 0);
  }
  
  // Apply color filter
  if (page.filter !== "color") {
    const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (page.filter === "grayscale") {
        data[i] = data[i + 1] = data[i + 2] = gray;
      } else {
        // B&W with threshold
        const val = gray > 128 ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = val;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }
  
  return canvas;
}

/* ─── Thumbnail preview with enhancements ─── */
function PageThumbnail({ page }: { page: ScannedPage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      const enhanced = applyEnhancements(img, page, 80, 80 * (img.naturalHeight / img.naturalWidth));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = enhanced.width;
      canvas.height = enhanced.height;
      canvas.getContext("2d")!.drawImage(enhanced, 0, 0);
    };
    img.src = page.originalDataUrl;
  }, [page]);
  
  return (
    <canvas
      ref={canvasRef}
      className="w-14 h-14 object-cover rounded-lg border bg-muted"
      style={{ objectFit: "cover" }}
    />
  );
}

/* ─── Camera Modal ─── */
function CameraCapture({ onCapture, onClose }: { onCapture: (dataUrl: string, w: number, h: number) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      })
      .catch(() => {
        toast.error("Camera access denied", { description: "Please allow camera access in your browser settings." });
        onClose();
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onClose]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    onCapture(dataUrl, video.videoWidth, video.videoHeight);
  }, [onCapture]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center animate-fade-in">
      <div className="absolute top-4 right-4 z-10">
        <button onClick={onClose} className="p-2 rounded-full bg-card/80 hover:bg-card transition-colors">
          <X className="w-5 h-5 text-foreground" />
        </button>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="max-h-[70vh] max-w-[90vw] rounded-xl border-2 border-primary/30"
      />
      {ready && (
        <button
          onClick={capture}
          className="mt-6 flex items-center gap-2 px-8 py-4 rounded-full bg-primary text-primary-foreground font-bold text-lg shadow-xl hover:scale-105 transition-all"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          <Camera className="w-6 h-6" />
          Capture
        </button>
      )}
    </div>
  );
}

/* ─── Sortable page card ─── */
function ScanPageCard({
  item,
  index,
  onRotate,
  onDelete,
  isDragging,
  isOverlay,
  totalPages,
}: {
  item: ScannedPage;
  index: number;
  onRotate?: (id: string) => void;
  onDelete?: (id: string) => void;
  isDragging?: boolean;
  isOverlay?: boolean;
  totalPages?: number;
}) {
  return (
    <div
      className={`flex items-center gap-3 bg-card border rounded-xl px-4 py-3 transition-all duration-200 ${
        isOverlay
          ? "shadow-2xl scale-[1.03] border-primary ring-2 ring-primary/20 rotate-[1deg]"
          : isDragging
          ? "opacity-30 border-dashed"
          : "group hover:shadow-md"
      }`}
    >
      <div className="p-1 rounded cursor-grab active:cursor-grabbing touch-none">
        <GripVertical className="w-4 h-4 text-muted-foreground/60" />
      </div>
      <span className="text-xs font-bold text-primary w-5 text-center shrink-0">{index + 1}</span>
      <PageThumbnail page={item} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Page {index + 1}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{item.width}×{item.height}</span>
          {item.rotation !== 0 && <span className="text-xs text-primary font-medium">↻ {item.rotation}°</span>}
          {item.filter !== "color" && <span className="text-xs text-accent font-medium">{item.filter}</span>}
          {(item.brightness !== 0 || item.contrast !== 0) && (
            <span className="text-xs text-muted-foreground">adjusted</span>
          )}
        </div>
      </div>
      {!isOverlay && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onRotate?.(item.id)}
            className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
            title="Rotate 90°"
          >
            <RotateCw className="w-4 h-4 text-primary" />
          </button>
          {(totalPages ?? 0) > 1 && (
            <button
              onClick={() => onDelete?.(item.id)}
              className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SortableScanItem({
  item, index, onRotate, onDelete, totalPages,
}: {
  item: ScannedPage; index: number;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  totalPages: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="animate-fade-in">
      <ScanPageCard
        item={item}
        index={index}
        onRotate={onRotate}
        onDelete={onDelete}
        isDragging={isDragging}
        totalPages={totalPages}
      />
    </div>
  );
}

/* ─── Enhancement panel for selected page ─── */
function EnhancementPanel({
  page,
  onUpdate,
}: {
  page: ScannedPage;
  onUpdate: (id: string, updates: Partial<ScannedPage>) => void;
}) {
  return (
    <div className="bg-card border rounded-xl p-5 space-y-4 animate-fade-in">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        <Palette className="w-4 h-4 text-primary" />
        Image Enhancements
      </h3>

      {/* Color filter */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Color Mode</label>
        <div className="flex gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              onClick={() => onUpdate(page.id, { filter: f.value })}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                page.filter === f.value
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Brightness */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Sun className="w-3.5 h-3.5" />
            Brightness
          </label>
          <span className="text-xs text-primary font-medium">{page.brightness > 0 ? "+" : ""}{page.brightness}</span>
        </div>
        <input
          type="range"
          min={-100}
          max={100}
          value={page.brightness}
          onChange={(e) => onUpdate(page.id, { brightness: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>

      {/* Contrast */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Contrast className="w-3.5 h-3.5" />
            Contrast
          </label>
          <span className="text-xs text-primary font-medium">{page.contrast > 0 ? "+" : ""}{page.contrast}</span>
        </div>
        <input
          type="range"
          min={-100}
          max={100}
          value={page.contrast}
          onChange={(e) => onUpdate(page.id, { contrast: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>

      {/* Auto-enhance preset */}
      <button
        onClick={() => onUpdate(page.id, { brightness: 10, contrast: 30, filter: "grayscale" })}
        className="w-full py-2 px-3 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      >
        ✨ Auto-Enhance (Document Preset)
      </button>

      {/* Reset */}
      <button
        onClick={() => onUpdate(page.id, { brightness: 0, contrast: 0, filter: "color", rotation: 0 })}
        className="w-full py-2 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
      >
        Reset to Original
      </button>
    </div>
  );
}

/* ─── Large preview with enhancements ─── */
function LargePreview({ page }: { page: ScannedPage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      // Scale to max 400px wide for preview
      const scale = Math.min(400 / img.naturalWidth, 400 / img.naturalHeight, 1);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      const enhanced = applyEnhancements(img, page, w, h);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = enhanced.width;
      canvas.height = enhanced.height;
      canvas.getContext("2d")!.drawImage(enhanced, 0, 0);
    };
    img.src = page.originalDataUrl;
  }, [page]);

  return (
    <div className="bg-card border rounded-xl p-4 flex items-center justify-center">
      <canvas ref={canvasRef} className="max-w-full max-h-[300px] rounded-lg" />
    </div>
  );
}

/* ─── Main Component ─── */
export default function ScanToPdf() {
  const [step, setStep] = useState<Step>("capture");
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFileName, setResultFileName] = useState("");
  const [resultStats, setResultStats] = useState("");
  const [options, setOptions] = useState<OutputOptions>({ outputFileName: "scanned-document" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeItem = activeId ? pages.find((p) => p.id === activeId) : null;
  const activeIndex = activeId ? pages.findIndex((p) => p.id === activeId) : -1;
  const selectedPage = selectedPageId ? pages.find((p) => p.id === selectedPageId) : null;

  const addImageFromDataUrl = useCallback((dataUrl: string, width: number, height: number) => {
    const newPage: ScannedPage = {
      id: generateId(),
      originalDataUrl: dataUrl,
      rotation: 0,
      brightness: 0,
      contrast: 0,
      filter: "color",
      width,
      height,
    };
    setPages((prev) => [...prev, newPage]);
    setSelectedPageId(newPage.id);
  }, []);

  const handleCameraCapture = useCallback((dataUrl: string, w: number, h: number) => {
    addImageFromDataUrl(dataUrl, w, h);
    setShowCamera(false);
  }, [addImageFromDataUrl]);

  const handleFilesSelected = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      toast.error("No valid images", { description: "Please select image files (JPG, PNG, WEBP, etc.)." });
      return;
    }
    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const img = new window.Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          addImageFromDataUrl(dataUrl, img.naturalWidth, img.naturalHeight);
          resolve();
        };
        img.onerror = () => {
          toast.error("Failed to load image", { description: file.name });
          resolve();
        };
        img.src = dataUrl;
      });
    }
  }, [addImageFromDataUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) handleFilesSelected(files);
  }, [handleFilesSelected]);

  const handleRotate = useCallback((id: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p))
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (selectedPageId === id) setSelectedPageId(null);
  }, [selectedPageId]);

  const handleUpdatePage = useCallback((id: string, updates: Partial<ScannedPage>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  const handleApplyToAll = useCallback(() => {
    if (!selectedPage) return;
    const { brightness, contrast, filter } = selectedPage;
    setPages((prev) => prev.map((p) => ({ ...p, brightness, contrast, filter })));
    toast.success("Applied to all pages");
  }, [selectedPage]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = pages.findIndex((p) => p.id === active.id);
      const newIndex = pages.findIndex((p) => p.id === over.id);
      setPages(arrayMove(pages, oldIndex, newIndex));
    }
  }

  const handleProcess = useCallback(async () => {
    if (pages.length === 0) return;
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();

    try {
      const pdfDoc = await PDFDocument.create();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        
        // Load and enhance image
        const img = new window.Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = page.originalDataUrl;
        });

        const enhanced = applyEnhancements(img, page);
        const jpegDataUrl = enhanced.toDataURL("image/jpeg", 0.92);
        const jpegBytes = Uint8Array.from(atob(jpegDataUrl.split(",")[1]), (c) => c.charCodeAt(0));
        const embeddedImage = await pdfDoc.embedJpg(jpegBytes);

        // Determine page dimensions
        let pageWidth: number;
        let pageHeight: number;

        if (pageSize === "a4") {
          pageWidth = 595.28; // A4 in points
          pageHeight = 841.89;
        } else if (pageSize === "letter") {
          pageWidth = 612;
          pageHeight = 792;
        } else {
          // fit to image
          pageWidth = enhanced.width;
          pageHeight = enhanced.height;
        }

        const pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);

        if (pageSize === "fit") {
          pdfPage.drawImage(embeddedImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
        } else {
          // Scale image to fit within page with margins
          const margin = 36; // 0.5 inch margin
          const availW = pageWidth - margin * 2;
          const availH = pageHeight - margin * 2;
          const scale = Math.min(availW / enhanced.width, availH / enhanced.height);
          const drawW = enhanced.width * scale;
          const drawH = enhanced.height * scale;
          const x = margin + (availW - drawW) / 2;
          const y = margin + (availH - drawH) / 2;
          pdfPage.drawImage(embeddedImage, { x, y, width: drawW, height: drawH });
        }

        setProgress(Math.round(((i + 1) / pages.length) * 75));
      }

      setProgress(85);
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });

      const elapsed = Date.now() - startTime;
      if (elapsed < 2000) {
        setProgress(95);
        await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.4));
      }

      setResultBlob(blob);
      setResultFileName(options.outputFileName || "scanned-document");
      setResultStats(`<strong>${pages.length} page${pages.length !== 1 ? "s" : ""}</strong> scanned to PDF`);
      setStep("done");
    } catch (err) {
      console.error("Scan to PDF failed:", err);
      toast.error("Processing failed", { description: "Something went wrong while creating your PDF." });
      setStep("configure");
    }
  }, [pages, pageSize, options.outputFileName]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resultFileName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlob, resultFileName]);

  const handleReset = useCallback(() => {
    setPages([]);
    setSelectedPageId(null);
    setProgress(0);
    setResultBlob(null);
    setResultFileName("");
    setResultStats("");
    setStep("capture");
  }, []);

  const completedSteps = [
    ...(step !== "capture" ? ["capture"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const currentStepKey = step === "processing" ? "configure" : step;

  return (
    <ToolPageLayout
      icon={ScanLine}
      title="Scan to PDF"
      subtitle="Capture or upload images → enhance → convert to PDF"
      steps={STEPS}
      currentStep={currentStepKey}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="capture"
    >
      {/* Camera modal */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          if (e.target.files?.length) handleFilesSelected(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />

      {/* Step: Capture */}
      {step === "capture" && (
        <div className="space-y-4 animate-fade-in">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`relative rounded-2xl border-2 border-dashed p-10 flex flex-col items-center justify-center gap-4 transition-all duration-300 ${
              isDragging
                ? "border-primary bg-primary/5 scale-[1.02] shadow-lg"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
              isDragging ? "bg-primary text-primary-foreground scale-110" : "bg-muted text-muted-foreground"
            }`}>
              {isDragging ? <ScanLine className="w-7 h-7" /> : <ImageIcon className="w-7 h-7" />}
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {isDragging ? "Drop your images here!" : "Drag & drop images here"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                JPG, PNG, WEBP supported · Multiple images
              </p>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Browse Files
              </button>
              <button
                onClick={() => setShowCamera(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-md"
              >
                <Camera className="w-4 h-4" />
                Use Camera
              </button>
            </div>
          </div>

          {/* Thumbnails of added pages */}
          {pages.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {pages.length} page{pages.length !== 1 ? "s" : ""} captured
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs text-primary font-medium px-2.5 py-1.5 rounded-md hover:bg-primary/10 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add More
                  </button>
                  <button
                    onClick={() => setShowCamera(true)}
                    className="flex items-center gap-1.5 text-xs text-primary font-medium px-2.5 py-1.5 rounded-md hover:bg-primary/10 transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" /> Capture More
                  </button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {pages.map((p, i) => (
                  <div key={p.id} className="relative group">
                    <PageThumbnail page={p} />
                    <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setStep("configure")}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <ScanLine className="w-5 h-5" />
                Enhance & Configure
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step: Configure / Enhance */}
      {step === "configure" && (
        <div className="space-y-5 animate-fade-in">
          {/* Page size selector */}
          <div className="bg-card border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              <ImageIcon className="w-4 h-4 text-primary" />
              Page Size
            </h3>
            <div className="flex gap-2">
              {PAGE_SIZES.map((ps) => (
                <button
                  key={ps.value}
                  onClick={() => setPageSize(ps.value)}
                  className={`flex-1 py-2.5 px-3 rounded-lg text-center transition-all ${
                    pageSize === ps.value
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <span className="text-sm font-medium block">{ps.label}</span>
                  <span className="text-[10px] opacity-70">{ps.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Add more buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => { setStep("capture"); }}
              className="flex items-center gap-1.5 text-xs text-primary font-medium px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add More Pages
            </button>
            {selectedPage && (
              <button
                onClick={handleApplyToAll}
                className="flex items-center gap-1.5 text-xs text-primary font-medium px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors ml-auto"
              >
                Apply Settings to All
              </button>
            )}
          </div>

          {/* Sortable list + enhancement panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: sortable list */}
            <div className="space-y-1.5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                  {pages.map((item, index) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedPageId(item.id)}
                      className={`rounded-xl transition-all cursor-pointer ${
                        selectedPageId === item.id ? "ring-2 ring-primary" : ""
                      }`}
                    >
                      <SortableScanItem
                        item={item}
                        index={index}
                        onRotate={handleRotate}
                        onDelete={handleDelete}
                        totalPages={pages.length}
                      />
                    </div>
                  ))}
                </SortableContext>
                <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
                  {activeItem ? (
                    <ScanPageCard item={activeItem} index={activeIndex} isOverlay />
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>

            {/* Right: preview + enhancements */}
            <div className="space-y-4">
              {selectedPage ? (
                <>
                  <LargePreview page={selectedPage} />
                  <EnhancementPanel page={selectedPage} onUpdate={handleUpdatePage} />
                </>
              ) : (
                <div className="bg-card border rounded-xl p-8 flex flex-col items-center justify-center text-center h-full min-h-[200px]">
                  <Palette className="w-8 h-8 text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">Click a page to preview and enhance it</p>
                </div>
              )}
            </div>
          </div>

          {/* Output config */}
          <OutputConfig options={options} onChange={setOptions} title="Output Settings" />

          {/* Action */}
          <button
            onClick={handleProcess}
            disabled={pages.length === 0}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <ScanLine className="w-5 h-5" />
            Create PDF ({pages.length} page{pages.length !== 1 ? "s" : ""})
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Creating your PDF..."
          subtitle={`Processing ${pages.length} page${pages.length !== 1 ? "s" : ""} in your browser`}
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && resultBlob && (
        <SuccessView
          title="PDF Created!"
          description={resultStats}
          fileName={resultFileName}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Scan Another"
        />
      )}
    </ToolPageLayout>
  );
}
