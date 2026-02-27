import { Settings2 } from "lucide-react";

export interface OutputOptions {
  outputFileName: string;
}

interface OutputConfigProps {
  options: OutputOptions;
  onChange: (options: OutputOptions) => void;
  title?: string;
  extension?: string;
}

export function OutputConfig({
  options,
  onChange,
  title = "Output Settings",
  extension = ".pdf",
}: OutputConfigProps) {
  return (
    <div className="bg-card border rounded-xl p-5 animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {title}
        </h3>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Output File Name
        </label>
        <div className="flex items-center">
          <input
            type="text"
            value={options.outputFileName}
            onChange={(e) => onChange({ ...options, outputFileName: e.target.value })}
            placeholder="output-file"
            className="flex-1 h-9 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
          <span className="text-sm text-muted-foreground ml-2">{extension}</span>
        </div>
      </div>
    </div>
  );
}
