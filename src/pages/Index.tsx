import { Link } from "react-router-dom";
import {
  FileStack, Scissors, Minimize2, Image, FileDown, RotateCw, Lock, Languages,
} from "lucide-react";

const highlights = [
  { icon: FileStack, label: "Merge PDF", desc: "Combine multiple PDFs into one", url: "/merge-pdf", enabled: true },
  { icon: Scissors, label: "Split PDF", desc: "Separate pages into new files", url: "/split", enabled: false },
  { icon: Minimize2, label: "Compress PDF", desc: "Reduce file size instantly", url: "/compress", enabled: false },
  { icon: Image, label: "JPG to PDF", desc: "Convert images to PDF", url: "/jpg-to-pdf", enabled: false },
  { icon: FileDown, label: "PDF to WORD", desc: "Extract text to editable docs", url: "/pdf-to-word", enabled: false },
  { icon: RotateCw, label: "Rotate PDF", desc: "Fix page orientation", url: "/rotate", enabled: false },
  { icon: Lock, label: "Protect PDF", desc: "Add password security", url: "/protect", enabled: false },
  { icon: Languages, label: "Translate PDF", desc: "Translate documents", url: "/translate", enabled: false },
];

const Index = () => {
  return (
    <div className="flex flex-col items-center px-6 py-16">
      {/* Hero */}
      <div className="text-center max-w-2xl mb-16">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          100% Client-Side · No Uploads
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Your PDFs, <br />
          <span className="text-primary">Your Privacy.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">
          Open-source PDF toolkit that runs entirely in your browser. No file uploads, no servers, no compromises.
        </p>
      </div>

      {/* Tool Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl w-full">
        {highlights.map((tool) => {
          const content = (
            <>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${tool.enabled ? "bg-primary/10" : "bg-muted"}`}>
                <tool.icon className={`h-5 w-5 ${tool.enabled ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className={`font-semibold text-sm ${tool.enabled ? "text-foreground" : "italic text-muted-foreground"}`}>{tool.label}</p>
                <p className="text-xs text-muted-foreground/70 mt-1">{tool.desc}</p>
              </div>
              {!tool.enabled && (
                <span className="absolute top-2 right-2 text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                  Soon
                </span>
              )}
            </>
          );

          if (tool.enabled) {
            return (
              <Link
                key={tool.label}
                to={tool.url}
                className="group relative bg-card border rounded-xl p-5 flex flex-col items-center text-center gap-3 hover:shadow-lg hover:border-primary/30 hover:scale-[1.03] transition-all duration-200"
              >
                {content}
              </Link>
            );
          }

          return (
            <div
              key={tool.label}
              className="group relative bg-card border rounded-xl p-5 flex flex-col items-center text-center gap-3 opacity-50 cursor-not-allowed transition-all"
            >
              {content}
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="mt-16 text-sm text-muted-foreground/60 text-center">
        Tools will light up as they're built. All processing happens in your browser.
      </p>
    </div>
  );
};

export default Index;
