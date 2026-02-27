import { GripVertical, X, FileText } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
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

export interface PdfFileItem {
  id: string;
  file: File;
  pageCount: number | null;
  sizeFormatted: string;
}

interface FileListProps {
  files: PdfFileItem[];
  onRemove: (id: string) => void;
  onReorder: (files: PdfFileItem[]) => void;
}

function SortableItem({ item, index, onRemove }: { item: PdfFileItem; index: number; onRemove: (id: string) => void }) {
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
    animationDelay: `${index * 50}ms`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 bg-card border rounded-xl px-4 py-3 animate-scale-in transition-all duration-200 ${
        isDragging ? "shadow-xl scale-[1.02] border-primary/40 z-50 relative" : "hover:shadow-md"
      }`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-1 rounded hover:bg-muted cursor-grab active:cursor-grabbing transition-colors touch-none"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground/60" />
      </button>

      {/* Order number */}
      <span className="text-xs font-bold text-primary w-5 text-center shrink-0">{index + 1}</span>

      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5 text-destructive" />
      </div>

      {/* Info */}
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

      {/* Remove */}
      <button
        onClick={() => onRemove(item.id)}
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all duration-200"
      >
        <X className="w-4 h-4 text-destructive" />
      </button>
    </div>
  );
}

export function FileList({ files, onRemove, onReorder }: FileListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
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
          Files to merge ({files.length})
        </h3>
        <p className="text-xs text-muted-foreground">
          Drag to reorder · First file = first pages
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          {files.map((item, index) => (
            <SortableItem key={item.id} item={item} index={index} onRemove={onRemove} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
