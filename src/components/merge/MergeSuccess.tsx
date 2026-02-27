import { CheckCircle2, Download, RotateCcw } from "lucide-react";

interface MergeSuccessProps {
  fileName: string;
  totalPages: number;
  fileCount: number;
  onDownload: () => void;
  onReset: () => void;
}

export function MergeSuccess({ fileName, totalPages, fileCount, onDownload, onReset }: MergeSuccessProps) {
  return (
    <div className="flex flex-col items-center text-center py-12 animate-scale-in">
      <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-6">
        <CheckCircle2 className="w-10 h-10 text-primary" />
      </div>

      <h2
        className="text-2xl font-bold text-foreground mb-2"
        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
      >
        Merge Complete!
      </h2>
      <p className="text-muted-foreground mb-1">
        {fileCount} files merged into <strong>{totalPages} pages</strong>
      </p>
      <p className="text-sm text-muted-foreground/70 mb-8">
        Everything processed in your browser — nothing was uploaded.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          <Download className="w-5 h-5" />
          Download {fileName}.pdf
        </button>

        <button
          onClick={onReset}
          className="flex items-center gap-2 px-5 py-3 rounded-xl border bg-card text-foreground font-medium hover:bg-muted transition-all duration-200"
        >
          <RotateCcw className="w-4 h-4" />
          Merge More
        </button>
      </div>
    </div>
  );
}
