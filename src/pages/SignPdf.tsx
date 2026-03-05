import { useState, useCallback, useRef, useEffect } from "react";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import {
  PenTool, ShieldCheck, Zap, ArrowRight, Download,
  FileText, CheckCircle2, RotateCcw, Type, ImageIcon,
  Pencil, ChevronLeft, ChevronRight, Move, ToggleLeft, ToggleRight,
} from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { formatFileSize, generateId, type FileItem } from "@/lib/file-utils";
import { downloadBlob } from "@/lib/download-utils";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "sign" | "processing" | "done";
type SignatureMethod = "draw" | "type" | "upload";

interface SignaturePlacement {
  xPct: number;
  yPct: number;
  widthPct: number;
  pageIndex: number;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "sign", label: "2. Sign" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
] as const;

const SIGNATURE_COLORS = [
  { value: "#000000", label: "Black" },
  { value: "#1a3a8a", label: "Blue" },
  { value: "#8b1a1a", label: "Red" },
];

const CANVAS_W = 400;
const CANVAS_H = 150;

export default function SignPdf() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<FileItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<{ name: string; blob: Blob } | null>(null);

  // Signature state
  const [method, setMethod] = useState<SignatureMethod>("draw");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [sigColor, setSigColor] = useState("#000000");

  // Draw canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Upload signature
  const sigUploadRef = useRef<HTMLInputElement>(null);

  // Page preview
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pageDims, setPageDims] = useState<{ w: number; h: number }[]>([]);

  // Placement
  const [placement, setPlacement] = useState<SignaturePlacement | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Dragging placement
  const [isDraggingPlacement, setIsDraggingPlacement] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Load PDF pages
  const loadPages = useCallback(async (f: File) => {
    const buffer = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const images: string[] = [];
    const dims: { w: number; h: number }[] = [];
    setTotalPages(pdf.numPages);

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      dims.push({ w: vp.width, h: vp.height });
      const scale = 500 / vp.width;
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      images.push(canvas.toDataURL("image/png"));
    }
    pdf.destroy();
    setPageImages(images);
    setPageDims(dims);
  }, []);

  const handleFilesSelected = useCallback(async (newFiles: File[]) => {
    const pdfFile = newFiles.find(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (!pdfFile) {
      toast.error("Please select a PDF file");
      return;
    }
    const item: FileItem = {
      id: generateId(),
      file: pdfFile,
      pageCount: null,
      sizeFormatted: formatFileSize(pdfFile.size),
    };
    setFile(item);
    setStep("sign");
    await loadPages(pdfFile);
  }, [loadPages]);

  // Draw canvas setup
  useEffect(() => {
    if (method !== "draw" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }, [method]);

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    isDrawingRef.current = true;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const point = "touches" in e ? e.touches[0] : e;
    lastPointRef.current = {
      x: (point.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (point.clientY - rect.top) * (CANVAS_H / rect.height),
    };
  }, []);

  const moveDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const point = "touches" in e ? e.touches[0] : e;
    const x = (point.clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (point.clientY - rect.top) * (CANVAS_H / rect.height);

    if (lastPointRef.current) {
      ctx.beginPath();
      ctx.strokeStyle = sigColor;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    lastPointRef.current = { x, y };
  }, [sigColor]);

  const endDraw = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    if (canvasRef.current) {
      setSignatureDataUrl(canvasRef.current.toDataURL("image/png"));
    }
  }, []);

  const clearCanvas = useCallback(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    setSignatureDataUrl(null);
  }, []);

  // Type signature → canvas
  useEffect(() => {
    if (method !== "type" || !typedName.trim()) {
      if (method === "type") setSignatureDataUrl(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = sigColor;
    ctx.font = "italic 48px 'Dancing Script', 'Brush Script MT', cursive";
    ctx.textBaseline = "middle";
    ctx.fillText(typedName, 20, CANVAS_H / 2);
    setSignatureDataUrl(canvas.toDataURL("image/png"));
  }, [typedName, sigColor, method]);

  // Upload signature image
  const handleSigUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSignatureDataUrl(reader.result as string);
    reader.readAsDataURL(f);
    e.target.value = "";
  }, []);

  // Click on page preview to place signature
  const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!signatureDataUrl || isDraggingPlacement) return;
    const container = previewContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    setPlacement({
      xPct: Math.max(0, Math.min(xPct, 80)),
      yPct: Math.max(0, Math.min(yPct, 90)),
      widthPct: 25,
      pageIndex: currentPage,
    });
  }, [signatureDataUrl, currentPage, isDraggingPlacement]);

  // Drag placed signature
  const handlePlacementMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlacement(true);
    const container = previewContainerRef.current;
    if (!container || !placement) return;
    const rect = container.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left - (placement.xPct / 100) * rect.width,
      y: e.clientY - rect.top - (placement.yPct / 100) * rect.height,
    };
  }, [placement]);

  useEffect(() => {
    if (!isDraggingPlacement) return;
    const handleMove = (e: MouseEvent) => {
      const container = previewContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left - dragOffsetRef.current.x) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top - dragOffsetRef.current.y) / rect.height) * 100;
      setPlacement((prev) => prev ? {
        ...prev,
        xPct: Math.max(0, Math.min(xPct, 100 - prev.widthPct)),
        yPct: Math.max(0, Math.min(yPct, 90)),
      } : null);
    };
    const handleUp = () => setIsDraggingPlacement(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDraggingPlacement]);

  // Resize signature
  const handleResize = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const container = previewContainerRef.current;
    if (!container || !placement) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startWidth = placement.widthPct;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dPct = (dx / rect.width) * 100;
      setPlacement((prev) => prev ? { ...prev, widthPct: Math.max(10, Math.min(60, startWidth + dPct)) } : null);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [placement]);

  // Process
  const handleProcess = useCallback(async () => {
    if (!file || !signatureDataUrl || !placement) {
      toast.error("Please create and place your signature first");
      return;
    }
    setStep("processing");
    setProgress(0);

    try {
      // Convert signature data URL to bytes
      const sigResponse = await fetch(signatureDataUrl);
      const sigBlob = await sigResponse.blob();
      const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());

      const buffer = await file.file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const sigImage = await pdfDoc.embedPng(sigBytes);

      const pages = pdfDoc.getPages();
      const pagesToSign = applyToAll
        ? pages.map((_, i) => i)
        : [placement.pageIndex];

      for (const pi of pagesToSign) {
        if (pi >= pages.length) continue;
        const page = pages[pi];
        const { width, height } = page.getSize();
        const sigW = (placement.widthPct / 100) * width;
        const sigH = (sigImage.height / sigImage.width) * sigW;
        const x = (placement.xPct / 100) * width;
        const y = height - (placement.yPct / 100) * height - sigH;

        page.drawImage(sigImage, { x, y, width: sigW, height: sigH });
        setProgress(Math.round(((pagesToSign.indexOf(pi) + 1) / pagesToSign.length) * 80));
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const name = file.file.name.replace(/\.pdf$/i, "_signed.pdf");

      setProgress(100);
      setResultBlob({ name, blob });
      setStep("done");
      toast.success("PDF signed successfully!");
    } catch (err) {
      console.error("Sign failed:", err);
      toast.error("Failed to sign PDF");
      setStep("sign");
    }
  }, [file, signatureDataUrl, placement, applyToAll]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResultBlob(null);
    setSignatureDataUrl(null);
    setTypedName("");
    setPlacement(null);
    setPageImages([]);
    setCurrentPage(0);
    setProgress(0);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["sign"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  return (
    <ToolPageLayout
      icon={PenTool}
      title="Sign PDF"
      subtitle="Add your signature to any PDF document"
      steps={STEPS}
      currentStep={step === "processing" ? "sign" : step}
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
          title={isDragging ? "Drop your PDF here!" : "Drag & drop a PDF file here"}
          subtitle="PDF file · Single file"
          buttonLabel="Select PDF File"
          dragIcon={PenTool}
        />
      )}

      {/* Sign step */}
      {step === "sign" && (
        <div className="space-y-5 animate-fade-in">
          {/* Signature creation */}
          <div className="bg-card border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <PenTool className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Create Signature
              </h3>
            </div>

            {/* Method tabs */}
            <div className="flex gap-2">
              {([
                { key: "draw" as const, icon: Pencil, label: "Draw" },
                { key: "type" as const, icon: Type, label: "Type" },
                { key: "upload" as const, icon: ImageIcon, label: "Upload" },
              ]).map((m) => (
                <button
                  key={m.key}
                  onClick={() => { setMethod(m.key); setSignatureDataUrl(null); }}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                    method === m.key
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card text-foreground border-border hover:border-primary/40"
                  }`}
                >
                  <m.icon className="w-4 h-4" /> {m.label}
                </button>
              ))}
            </div>

            {/* Color picker */}
            {(method === "draw" || method === "type") && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Color:</span>
                {SIGNATURE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setSigColor(c.value)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      sigColor === c.value ? "border-primary scale-110" : "border-border"
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            )}

            {/* Draw mode */}
            {method === "draw" && (
              <div>
                <canvas
                  ref={canvasRef}
                  width={CANVAS_W}
                  height={CANVAS_H}
                  className="w-full border rounded-lg cursor-crosshair bg-white touch-none"
                  style={{ maxWidth: CANVAS_W }}
                  onMouseDown={startDraw}
                  onMouseMove={moveDraw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={moveDraw}
                  onTouchEnd={endDraw}
                />
                <button
                  onClick={clearCanvas}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium text-muted-foreground hover:bg-muted transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Clear
                </button>
              </div>
            )}

            {/* Type mode */}
            {method === "type" && (
              <div>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Type your name..."
                  className="w-full px-4 py-3 rounded-lg border bg-card text-foreground text-sm"
                  maxLength={60}
                />
                {typedName && (
                  <div className="mt-3 p-4 bg-white border rounded-lg">
                    <p className="text-3xl" style={{ fontFamily: "'Dancing Script', 'Brush Script MT', cursive", color: sigColor }}>
                      {typedName}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Upload mode */}
            {method === "upload" && (
              <div>
                <input
                  ref={sigUploadRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleSigUpload}
                  className="hidden"
                />
                {signatureDataUrl ? (
                  <div className="flex items-center gap-3">
                    <img src={signatureDataUrl} alt="Signature" className="h-16 object-contain border rounded-lg bg-white p-2" />
                    <button
                      onClick={() => sigUploadRef.current?.click()}
                      className="text-xs text-primary hover:underline"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => sigUploadRef.current?.click()}
                    className="w-full py-6 border-2 border-dashed rounded-lg text-sm text-muted-foreground hover:border-primary/40 transition-all"
                  >
                    Click to upload signature image (PNG/JPG)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Page preview & placement */}
          {pageImages.length > 0 && (
            <div className="bg-card border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Place Signature
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <button
                    onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                    disabled={currentPage === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span>Page {currentPage + 1} of {totalPages}</span>
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {!signatureDataUrl && (
                <p className="text-xs text-muted-foreground italic">Create a signature above first, then click on the page to place it.</p>
              )}

              <div
                ref={previewContainerRef}
                className="relative border rounded-lg overflow-hidden cursor-crosshair bg-white mx-auto"
                style={{ maxWidth: 500, aspectRatio: pageDims[currentPage] ? `${pageDims[currentPage].w} / ${pageDims[currentPage].h}` : "612 / 792" }}
                onClick={handlePreviewClick}
              >
                <img
                  src={pageImages[currentPage]}
                  alt={`Page ${currentPage + 1}`}
                  className="w-full h-full object-contain"
                />

                {/* Placed signature overlay */}
                {placement && (placement.pageIndex === currentPage || applyToAll) && signatureDataUrl && (
                  <div
                    className="absolute border-2 border-primary/60 bg-primary/5 cursor-move"
                    style={{
                      left: `${placement.xPct}%`,
                      top: `${placement.yPct}%`,
                      width: `${placement.widthPct}%`,
                    }}
                    onMouseDown={handlePlacementMouseDown}
                  >
                    <img src={signatureDataUrl} alt="Signature" className="w-full pointer-events-none" />
                    {/* Resize handle */}
                    <div
                      className="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-primary rounded-full cursor-se-resize border-2 border-primary-foreground"
                      onMouseDown={handleResize}
                    />
                    <div className="absolute -top-5 left-0 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Move className="w-2.5 h-2.5" /> Drag to move
                    </div>
                  </div>
                )}
              </div>

              {/* Apply to all toggle */}
              <button
                onClick={() => setApplyToAll(!applyToAll)}
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {applyToAll ? <ToggleRight className="w-5 h-5 text-primary" /> : <ToggleLeft className="w-5 h-5" />}
                Apply signature to all pages
              </button>
            </div>
          )}

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={!signatureDataUrl || !placement}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <PenTool className="w-5 h-5" />
            Sign PDF
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Signing PDF..."
          subtitle="Embedding your signature"
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && resultBlob && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              PDF Signed!
            </h2>
            <p className="text-muted-foreground text-sm">Your signature has been embedded into the document.</p>
          </div>

          <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{resultBlob.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(resultBlob.blob.size)}</p>
            </div>
            <button
              onClick={() => downloadBlob(resultBlob.blob, resultBlob.name)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:shadow-md transition-all"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          </div>

          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium text-foreground hover:bg-muted transition-all"
          >
            <RotateCcw className="w-4 h-4" /> Sign Another PDF
          </button>
        </div>
      )}
    </ToolPageLayout>
  );
}
