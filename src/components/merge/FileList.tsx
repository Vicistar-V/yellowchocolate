import { GripVertical, X, FileText, ChevronUp, ChevronDown } from "lucide-react";

export interface PdfFileItem {
  id: string;
  file: File;
  pageCount: number | null;
  sizeFormatted: string;
}

interface FileListProps {
  files: PdfFileItem[];
  onRemove: (id: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

export function FileList({ files, onRemove, onMoveUp, onMoveDown }: FileListProps) {
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

      {files.map((item, index) => (
        <div
          key={item.id}
          className="group flex items-center gap-3 bg-card border rounded-xl px-4 py-3 animate-scale-in hover:shadow-md transition-all duration-200"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {/* Order indicator */}
          <div className="flex flex-col items-center gap-0.5">
            <button
              onClick={() => onMoveUp(index)}
              disabled={index === 0}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20 transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <span className="text-xs font-bold text-primary w-5 text-center">{index + 1}</span>
            <button
              onClick={() => onMoveDown(index)}
              disabled={index === files.length - 1}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* Grip */}
          <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" />

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
      ))}
    </div>
  );
}
