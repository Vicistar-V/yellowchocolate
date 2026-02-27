import { useState, useCallback } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import {
  LayoutList, ShieldCheck, Zap, ArrowRight, RotateCw,
  Copy, Trash2, GripVertical, FileOutput, ArrowDownUp,
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
import { FileDropZone } from "@/components/tool/FileDropZone";
import { OutputConfig, type OutputOptions } from "@/components/tool/OutputConfig";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize } from "@/lib/file-utils";

type Step = "upload" | "configure" | "processing" | "done";

interface PageItem {
  id: string;
  sourceIndex: number; // 0-based index in original PDF
  rotation: number; // 0, 90, 180, 270
  label: string; // display label
}

let nextId = 1;
function makeId() {
  return `page-${nextId++}`;
}

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "configure", label: "2. Organize" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: LayoutList, label: "Full control" },
] as const;

/* ─── Sortable page card ─── */
function PageCard({
  item,
  index,
  onRotate,
  onDuplicate,
  onDelete,
  isDragging,
  isOverlay,
  totalPages,
}: {
  item: PageItem;
  index: number;
  onRotate?: (id: string) => void;
  onDuplicate?: (id: string) => void;
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
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <FileOutput className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {item.label}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">Original page {item.sourceIndex + 1}</span>
          {item.rotation !== 0 && (
            <span className="text-xs text-primary font-medium">↻ {item.rotation}°</span>
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
          <button
            onClick={() => onDuplicate?.(item.id)}
            className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
            title="Duplicate"
          >
            <Copy className="w-4 h-4 text-muted-foreground" />
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

function SortablePageItem({
  item, index, onRotate, onDuplicate, onDelete, totalPages,
}: {
  item: PageItem; index: number;
  onRotate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  totalPages: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="animate-fade-in">
      <PageCard
        item={item}
        index={index}
        onRotate={onRotate}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        isDragging={isDragging}
        totalPages={totalPages}
      />
    </div>
  );
}

export default function OrganizePages() {
  const [step, setStep] = useState<Step>("upload");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [originalPageCount, setOriginalPageCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFileName, setResultFileName] = useState("");
  const [resultStats, setResultStats] = useState("");
  const [options, setOptions] = useState<OutputOptions>({ outputFileName: "organized" });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeItem = activeId ? pages.find((p) => p.id === activeId) : null;
  const activeIndex = activeId ? pages.findIndex((p) => p.id === activeId) : -1;

  const rotatedCount = pages.filter((p) => p.rotation !== 0).length;
  const duplicatedCount = pages.length - originalPageCount;

  const handleFileSelected = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const count = pdf.getPageCount();
      setSourceFile(file);
      setOriginalPageCount(count);
      setPages(
        Array.from({ length: count }, (_, i) => ({
          id: makeId(),
          sourceIndex: i,
          rotation: 0,
          label: `Page ${i + 1}`,
        }))
      );
      setOptions({ outputFileName: file.name.replace(/\.pdf$/i, "") + "-organized" });
      setStep("configure");
    } catch {
      console.error("Could not read PDF");
    }
  }, []);

  const handleRotate = useCallback((id: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p))
    );
  }, []);

  const handleDuplicate = useCallback((id: string) => {
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const source = prev[idx];
      const copy: PageItem = {
        id: makeId(),
        sourceIndex: source.sourceIndex,
        rotation: source.rotation,
        label: `${source.label} (copy)`,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, []);

  const handleDeletePage = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleReverse = useCallback(() => {
    setPages((prev) => [...prev].reverse());
  }, []);

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
    if (!sourceFile || pages.length === 0) return;
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();

    try {
      const buffer = await sourceFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const newPdf = await PDFDocument.create();

      for (let i = 0; i < pages.length; i++) {
        const item = pages[i];
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [item.sourceIndex]);
        if (item.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees(currentRotation + item.rotation));
        }
        newPdf.addPage(copiedPage);
        setProgress(Math.round(((i + 1) / pages.length) * 75));
      }

      setProgress(85);
      const bytes = await newPdf.save();
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });

      const elapsed = Date.now() - startTime;
      if (elapsed < 2000) {
        setProgress(95);
        await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, (2000 - elapsed) * 0.4));
      }

      setResultBlob(blob);
      setResultFileName(options.outputFileName || "organized");

      const parts: string[] = [`<strong>${pages.length} page${pages.length !== 1 ? "s" : ""}</strong>`];
      if (rotatedCount > 0) parts.push(`${rotatedCount} rotated`);
      if (duplicatedCount > 0) parts.push(`${duplicatedCount} duplicated`);
      setResultStats(parts.join(" · "));
      setStep("done");
    } catch (err) {
      console.error("Organize failed:", err);
      setStep("configure");
    }
  }, [sourceFile, pages, options.outputFileName, rotatedCount, duplicatedCount]);

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
    setSourceFile(null);
    setOriginalPageCount(0);
    setPages([]);
    setProgress(0);
    setResultBlob(null);
    setResultFileName("");
    setResultStats("");
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["configure"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const currentStepKey = step === "processing" ? "configure" : step;

  return (
    <ToolPageLayout
      icon={LayoutList}
      title="Organize Pages"
      subtitle="Reorder, rotate, duplicate & delete pages"
      steps={STEPS}
      currentStep={currentStepKey}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {/* Upload */}
      {step === "upload" && (
        <FileDropZone
          onFilesSelected={handleFileSelected}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          accept="application/pdf"
          title={isDragging ? "Drop your PDF here!" : "Drag & drop a PDF file here"}
          subtitle="or click to browse · Single file"
          buttonLabel="Select PDF File"
          dragIcon={LayoutList}
        />
      )}

      {/* Configure */}
      {step === "configure" && sourceFile && (
        <div className="space-y-5 animate-fade-in">
          {/* File info */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-card border">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <FileOutput className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {sourceFile.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {originalPageCount} original page{originalPageCount !== 1 ? "s" : ""} · {formatFileSize(sourceFile.size)}
              </p>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
            >
              Change file
            </button>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <h3
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {pages.length} page{pages.length !== 1 ? "s" : ""}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {rotatedCount > 0 && `${rotatedCount} rotated`}
                {rotatedCount > 0 && duplicatedCount > 0 && " · "}
                {duplicatedCount > 0 && `${duplicatedCount} duplicated`}
              </span>
            </h3>
            <button
              onClick={handleReverse}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium px-2.5 py-1.5 rounded-md hover:bg-primary/10 transition-colors"
            >
              <ArrowDownUp className="w-3.5 h-3.5" />
              Reverse Order
            </button>
          </div>

          {/* Sortable list */}
          <div className="space-y-1.5">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                {pages.map((item, index) => (
                  <SortablePageItem
                    key={item.id}
                    item={item}
                    index={index}
                    onRotate={handleRotate}
                    onDuplicate={handleDuplicate}
                    onDelete={handleDeletePage}
                    totalPages={pages.length}
                  />
                ))}
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
                {activeItem ? (
                  <PageCard item={activeItem} index={activeIndex} isOverlay />
                ) : null}
              </DragOverlay>
            </DndContext>
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
            <LayoutList className="w-5 h-5" />
            Save Organized PDF
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Processing */}
      {step === "processing" && (
        <ProcessingView
          title="Organizing pages..."
          subtitle={`Processing ${pages.length} pages in your browser`}
          progress={progress}
        />
      )}

      {/* Done */}
      {step === "done" && resultBlob && (
        <SuccessView
          title="PDF Organized!"
          description={resultStats}
          fileName={resultFileName}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Organize Another"
        />
      )}
    </ToolPageLayout>
  );
}
