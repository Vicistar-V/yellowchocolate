import { useState, useCallback, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import {
  GitCompare, ShieldCheck, Zap, ChevronLeft, ChevronRight,
  RotateCcw, Columns, Layers, SlidersHorizontal,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "compare";
type ViewMode = "side-by-side" | "overlay" | "slider";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "compare", label: "2. Compare" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Client-side diff" },
] as const;

interface PdfData {
  file: File;
  pages: string[]; // data URLs
  dims: { w: number; h: number }[];
}

export default function ComparePdf() {
  const [step, setStep] = useState<Step>("upload");
  const [leftPdf, setLeftPdf] = useState<PdfData | null>(null);
  const [rightPdf, setRightPdf] = useState<PdfData | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [diffImages, setDiffImages] = useState<(string | null)[]>([]);
  const [diffPercents, setDiffPercents] = useState<number[]>([]);
  const [sliderPos, setSliderPos] = useState(50);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDraggingSlider = useRef(false);

  const [leftDrag, setLeftDrag] = useState(false);
  const [rightDrag, setRightDrag] = useState(false);

  const loadPdf = useCallback(async (file: File): Promise<PdfData> => {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    const dims: { w: number; h: number }[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      dims.push({ w: vp.width, h: vp.height });
      const scale = 600 / vp.width;
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      pages.push(canvas.toDataURL("image/png"));
    }
    pdf.destroy();
    return { file, pages, dims };
  }, []);

  const handleDrop = useCallback(async (side: "left" | "right", files: File[]) => {
    const pdfFile = files.find(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (!pdfFile) {
      toast.error("Please select a PDF file");
      return;
    }
    try {
      const data = await loadPdf(pdfFile);
      if (side === "left") setLeftPdf(data);
      else setRightPdf(data);
    } catch {
      toast.error("Failed to load PDF");
    }
  }, [loadPdf]);

  // Auto-advance when both loaded
  useEffect(() => {
    if (leftPdf && rightPdf && step === "upload") {
      setStep("compare");
      setCurrentPage(0);
    }
  }, [leftPdf, rightPdf, step]);

  // Compute diff images
  useEffect(() => {
    if (!leftPdf || !rightPdf || step !== "compare") return;
    const maxPages = Math.max(leftPdf.pages.length, rightPdf.pages.length);
    const diffs: (string | null)[] = [];
    const pcts: number[] = [];

    const computeDiff = async () => {
      for (let i = 0; i < maxPages; i++) {
        const leftSrc = leftPdf.pages[i];
        const rightSrc = rightPdf.pages[i];
        if (!leftSrc || !rightSrc) {
          diffs.push(null);
          pcts.push(100);
          continue;
        }

        const [leftImg, rightImg] = await Promise.all([loadImage(leftSrc), loadImage(rightSrc)]);
        const w = Math.max(leftImg.width, rightImg.width);
        const h = Math.max(leftImg.height, rightImg.height);

        const c1 = document.createElement("canvas");
        c1.width = w; c1.height = h;
        const ctx1 = c1.getContext("2d")!;
        ctx1.drawImage(leftImg, 0, 0);
        const d1 = ctx1.getImageData(0, 0, w, h);

        const c2 = document.createElement("canvas");
        c2.width = w; c2.height = h;
        const ctx2 = c2.getContext("2d")!;
        ctx2.drawImage(rightImg, 0, 0);
        const d2 = ctx2.getImageData(0, 0, w, h);

        const diffCanvas = document.createElement("canvas");
        diffCanvas.width = w; diffCanvas.height = h;
        const diffCtx = diffCanvas.getContext("2d")!;
        const diffData = diffCtx.createImageData(w, h);

        let diffPixels = 0;
        const totalPixels = w * h;
        const threshold = 30;

        for (let p = 0; p < d1.data.length; p += 4) {
          const dr = Math.abs(d1.data[p] - d2.data[p]);
          const dg = Math.abs(d1.data[p + 1] - d2.data[p + 1]);
          const db = Math.abs(d1.data[p + 2] - d2.data[p + 2]);

          if (dr + dg + db > threshold) {
            diffData.data[p] = 255;     // R
            diffData.data[p + 1] = 0;   // G
            diffData.data[p + 2] = 100;  // B
            diffData.data[p + 3] = 160; // A
            diffPixels++;
          } else {
            diffData.data[p] = d1.data[p];
            diffData.data[p + 1] = d1.data[p + 1];
            diffData.data[p + 2] = d1.data[p + 2];
            diffData.data[p + 3] = 60;
          }
        }

        diffCtx.putImageData(diffData, 0, 0);
        diffs.push(diffCanvas.toDataURL("image/png"));
        pcts.push(Number(((diffPixels / totalPixels) * 100).toFixed(1)));
      }
      setDiffImages(diffs);
      setDiffPercents(pcts);
    };

    computeDiff();
  }, [leftPdf, rightPdf, step]);

  const maxPages = Math.max(leftPdf?.pages.length ?? 0, rightPdf?.pages.length ?? 0);

  // Slider drag
  const handleSliderMouseDown = useCallback(() => {
    isDraggingSlider.current = true;
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDraggingSlider.current || !sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSliderPos(Math.max(5, Math.min(95, pct)));
    };
    const handleUp = () => { isDraggingSlider.current = false; };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const handleReset = useCallback(() => {
    setLeftPdf(null);
    setRightPdf(null);
    setDiffImages([]);
    setDiffPercents([]);
    setCurrentPage(0);
    setStep("upload");
  }, []);

  const makeDragHandlers = useCallback((side: "left" | "right") => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); side === "left" ? setLeftDrag(true) : setRightDrag(true); },
    onDragLeave: () => { side === "left" ? setLeftDrag(false) : setRightDrag(false); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      side === "left" ? setLeftDrag(false) : setRightDrag(false);
      handleDrop(side, Array.from(e.dataTransfer.files));
    },
  }), [handleDrop]);

  const makeInputHandler = useCallback((side: "left" | "right") => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleDrop(side, Array.from(e.target.files));
    e.target.value = "";
  }, [handleDrop]);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "compare" ? ["compare"] : []),
  ];

  const leftPageImg = leftPdf?.pages[currentPage] ?? null;
  const rightPageImg = rightPdf?.pages[currentPage] ?? null;
  const diffImg = diffImages[currentPage] ?? null;

  return (
    <ToolPageLayout
      icon={GitCompare}
      title="Compare PDF"
      subtitle="Visually compare two PDF documents side by side"
      steps={STEPS}
      currentStep={step}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {/* Upload */}
      {step === "upload" && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-2 gap-4">
            {/* Left drop zone */}
            <div
              {...makeDragHandlers("left")}
              className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center gap-3 transition-all min-h-[200px] ${
                leftDrag ? "border-primary bg-primary/5" : leftPdf ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              {leftPdf ? (
                <>
                  <GitCompare className="w-8 h-8 text-primary" />
                  <p className="text-sm font-medium text-foreground truncate max-w-full">{leftPdf.file.name}</p>
                  <p className="text-xs text-muted-foreground">{leftPdf.pages.length} pages</p>
                  <label className="text-xs text-primary cursor-pointer hover:underline">
                    Change
                    <input type="file" accept=".pdf" className="hidden" onChange={makeInputHandler("left")} />
                  </label>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    Original PDF
                  </p>
                  <p className="text-xs text-muted-foreground">Drop or click to select</p>
                  <label className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium cursor-pointer hover:shadow-md transition-all">
                    Select File
                    <input type="file" accept=".pdf" className="hidden" onChange={makeInputHandler("left")} />
                  </label>
                </>
              )}
            </div>

            {/* Right drop zone */}
            <div
              {...makeDragHandlers("right")}
              className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center gap-3 transition-all min-h-[200px] ${
                rightDrag ? "border-primary bg-primary/5" : rightPdf ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              {rightPdf ? (
                <>
                  <GitCompare className="w-8 h-8 text-primary" />
                  <p className="text-sm font-medium text-foreground truncate max-w-full">{rightPdf.file.name}</p>
                  <p className="text-xs text-muted-foreground">{rightPdf.pages.length} pages</p>
                  <label className="text-xs text-primary cursor-pointer hover:underline">
                    Change
                    <input type="file" accept=".pdf" className="hidden" onChange={makeInputHandler("right")} />
                  </label>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    Modified PDF
                  </p>
                  <p className="text-xs text-muted-foreground">Drop or click to select</p>
                  <label className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium cursor-pointer hover:shadow-md transition-all">
                    Select File
                    <input type="file" accept=".pdf" className="hidden" onChange={makeInputHandler("right")} />
                  </label>
                </>
              )}
            </div>
          </div>

          {(leftPdf || rightPdf) && !(leftPdf && rightPdf) && (
            <p className="text-xs text-muted-foreground text-center animate-pulse">
              Upload both PDFs to start comparison
            </p>
          )}
        </div>
      )}

      {/* Compare step */}
      {step === "compare" && leftPdf && rightPdf && (
        <div className="space-y-4 animate-fade-in">
          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* View mode */}
            <div className="flex gap-1 bg-card border rounded-lg p-1">
              {([
                { key: "side-by-side" as const, icon: Columns, label: "Side by Side" },
                { key: "overlay" as const, icon: Layers, label: "Overlay" },
                { key: "slider" as const, icon: SlidersHorizontal, label: "Slider" },
              ]).map((mode) => (
                <button
                  key={mode.key}
                  onClick={() => setViewMode(mode.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    viewMode === mode.key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <mode.icon className="w-3.5 h-3.5" /> {mode.label}
                </button>
              ))}
            </div>

            {/* Diff badge */}
            {diffPercents[currentPage] !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                diffPercents[currentPage] === 0
                  ? "bg-primary/10 text-primary"
                  : "bg-destructive/10 text-destructive"
              }`}>
                {diffPercents[currentPage] === 0 ? "Identical" : `${diffPercents[currentPage]}% different`}
              </span>
            )}

            {/* Page nav */}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <button
                onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>Page {currentPage + 1} of {maxPages}</span>
              <button
                onClick={() => setCurrentPage(Math.min(maxPages - 1, currentPage + 1))}
                disabled={currentPage >= maxPages - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Views */}
          {viewMode === "side-by-side" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground text-center">Original</p>
                <div className="border rounded-lg overflow-hidden bg-white">
                  {leftPageImg ? (
                    <img src={leftPageImg} alt="Original" className="w-full" />
                  ) : (
                    <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No page</div>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground text-center">Modified</p>
                <div className="border rounded-lg overflow-hidden bg-white">
                  {rightPageImg ? (
                    <img src={rightPageImg} alt="Modified" className="w-full" />
                  ) : (
                    <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No page</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {viewMode === "overlay" && (
            <div className="border rounded-lg overflow-hidden bg-white">
              {diffImg ? (
                <img src={diffImg} alt="Diff overlay" className="w-full" />
              ) : leftPageImg ? (
                <img src={leftPageImg} alt="Original" className="w-full opacity-50" />
              ) : (
                <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading diff...</div>
              )}
              <p className="text-[10px] text-muted-foreground text-center py-1">Magenta highlights show differences</p>
            </div>
          )}

          {viewMode === "slider" && (
            <div
              ref={sliderRef}
              className="relative border rounded-lg overflow-hidden bg-white cursor-col-resize select-none"
            >
              {/* Right image (full) */}
              {rightPageImg && (
                <img src={rightPageImg} alt="Modified" className="w-full" />
              )}
              {/* Left image (clipped) */}
              {leftPageImg && (
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${sliderPos}%` }}
                >
                  <img src={leftPageImg} alt="Original" className="w-full" style={{ width: `${100 / (sliderPos / 100)}%`, maxWidth: "none" }} />
                </div>
              )}
              {/* Slider handle */}
              <div
                className="absolute top-0 bottom-0 w-1 bg-primary cursor-col-resize"
                style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}
                onMouseDown={handleSliderMouseDown}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg">
                  <SlidersHorizontal className="w-4 h-4 text-primary-foreground" />
                </div>
              </div>
              {/* Labels */}
              <div className="absolute top-2 left-2 text-[10px] bg-card/80 px-2 py-0.5 rounded font-medium">Original</div>
              <div className="absolute top-2 right-2 text-[10px] bg-card/80 px-2 py-0.5 rounded font-medium">Modified</div>
            </div>
          )}

          {/* Reset */}
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium text-foreground hover:bg-muted transition-all"
          >
            <RotateCcw className="w-4 h-4" /> Compare Different PDFs
          </button>
        </div>
      )}
    </ToolPageLayout>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
