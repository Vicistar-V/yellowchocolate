import { useState } from "react";
import { GripVertical, X, FileText } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FileItem } from "@/lib/file-utils";

interface FileListProps {
  files: FileItem[];
  onRemove: (id: string) => void;
  onReorder: (files: FileItem[]) => void;
  headerTitle?: string;
  headerHint?: string;
}

function FileCard({ item, index, onRemove, isDragging, isOverlay }: {
  item: FileItem;
  index: number;
  onRemove?: (id: string) => void;
  isDragging?: boolean;
  isOverlay?: boolean;
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
      <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5 text-destructive" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{item.file.name}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted-foreground">{item.sizeFormatted}</span>
          {item.pageCount !== null && (
            <span className="text-xs text-muted-foreground">
              {item.pageCount} page{item.pageCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      {onRemove && !isOverlay && (
        <button
          onClick={() => onRemove(item.id)}
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all duration-200"
        >
          <X className="w-4 h-4 text-destructive" />
        </button>
      )}
    </div>
  );
}

function SortableItem({ item, index, onRemove }: { item: FileItem; index: number; onRemove: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="animate-fade-in">
      <FileCard item={item} index={index} onRemove={onRemove} isDragging={isDragging} />
    </div>
  );
}

export function FileList({
  files,
  onRemove,
  onReorder,
  headerTitle = "Selected files",
  headerHint = "Drag to reorder",
}: FileListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeItem = activeId ? files.find((f) => f.id === activeId) : null;
  const activeIndex = activeId ? files.findIndex((f) => f.id === activeId) : -1;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = files.findIndex((f) => f.id === active.id);
      const newIndex = files.findIndex((f) => f.id === over.id);
      onReorder(arrayMove(files, oldIndex, newIndex));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {headerTitle} ({files.length})
        </h3>
        <p className="text-xs text-muted-foreground">{headerHint}</p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          {files.map((item, index) => (
            <SortableItem key={item.id} item={item} index={index} onRemove={onRemove} />
          ))}
        </SortableContext>

        <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
          {activeItem ? (
            <FileCard item={activeItem} index={activeIndex} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
