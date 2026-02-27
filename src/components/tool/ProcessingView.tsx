import { Loader2 } from "lucide-react";

interface ProcessingViewProps {
  title?: string;
  subtitle?: string;
  progress: number;
}

export function ProcessingView({
  title = "Processing...",
  subtitle,
  progress,
}: ProcessingViewProps) {
  return (
    <div className="flex flex-col items-center py-16 animate-fade-in">
      <Loader2 className="w-12 h-12 text-primary animate-spin mb-6" />
      <h2
        className="text-xl font-bold text-foreground mb-2"
        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {title}
      </h2>
      {subtitle && (
        <p className="text-sm text-muted-foreground mb-6">{subtitle}</p>
      )}

      <div className="w-full max-w-sm h-3 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-2">{progress}%</p>
    </div>
  );
}
