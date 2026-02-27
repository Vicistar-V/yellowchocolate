import { useCallback, useRef } from "react";
import { Upload, Plus, FileStack, type LucideIcon } from "lucide-react";

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => void;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  /** MIME type filter, e.g. "application/pdf" or "image/*" */
  accept?: string;
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  /** Icon shown when dragging over the zone */
  dragIcon?: LucideIcon;
}

export function FileDropZone({
  onFilesSelected,
  isDragging,
  setIsDragging,
  accept = "application/pdf",
  title,
  subtitle,
  buttonLabel,
  dragIcon: DragIcon = FileStack,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => {
        if (!accept) return true;
        // support wildcards like "image/*"
        if (accept.endsWith("/*")) {
          return f.type.startsWith(accept.replace("/*", "/"));
        }
        return accept.split(",").some((a) => f.type === a.trim());
      });
      if (files.length) onFilesSelected(files);
    },
    [onFilesSelected, setIsDragging, accept]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length) onFilesSelected(files);
      e.target.value = "";
    },
    [onFilesSelected]
  );

  const defaultTitle = isDragging ? "Drop your files here!" : "Drag & drop files here";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        relative cursor-pointer rounded-2xl border-2 border-dashed p-12
        flex flex-col items-center justify-center gap-4 transition-all duration-300
        ${
          isDragging
            ? "border-primary bg-primary/5 scale-[1.02] shadow-lg"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={handleFileInput}
        className="hidden"
      />

      <div
        className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
          isDragging ? "bg-primary text-primary-foreground scale-110" : "bg-muted text-muted-foreground"
        }`}
      >
        {isDragging ? (
          <DragIcon className="w-7 h-7" />
        ) : (
          <Upload className="w-7 h-7" />
        )}
      </div>

      <div className="text-center">
        <p className="font-semibold text-foreground text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {title ?? defaultTitle}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {subtitle ?? "or click to browse · Multiple files supported"}
        </p>
      </div>

      <div className="flex items-center gap-2 mt-2 px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium">
        <Plus className="w-4 h-4" />
        {buttonLabel ?? "Select Files"}
      </div>
    </div>
  );
}
