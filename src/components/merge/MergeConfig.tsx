import { Settings2 } from "lucide-react";

export interface MergeOptions {
  outputFileName: string;
  addBookmarks: boolean;
}

interface MergeConfigProps {
  options: MergeOptions;
  onChange: (options: MergeOptions) => void;
}

export function MergeConfig({ options, onChange }: MergeConfigProps) {
  return (
    <div className="bg-card border rounded-xl p-5 animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Merge Settings
        </h3>
      </div>

      <div className="space-y-4">
        {/* Output filename */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Output File Name
          </label>
          <div className="flex items-center">
            <input
              type="text"
              value={options.outputFileName}
              onChange={(e) => onChange({ ...options, outputFileName: e.target.value })}
              placeholder="merged-document"
              className="flex-1 h-9 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
            <span className="text-sm text-muted-foreground ml-2">.pdf</span>
          </div>
        </div>

        {/* Bookmarks toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Add bookmarks</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add a bookmark for each file's start page
            </p>
          </div>
          <button
            onClick={() => onChange({ ...options, addBookmarks: !options.addBookmarks })}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
              options.addBookmarks ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform duration-200 ${
                options.addBookmarks ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
