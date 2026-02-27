import { Link } from "react-router-dom";
import {
  FileStack, Scissors, Minimize2, Image, FileDown, RotateCw, Lock, Languages,
  Wrench, Zap, ShieldCheck, Globe, Trash2, FileOutput, LayoutList,
  FileText, Table, Presentation, Code,
  ImageDown, PresentationIcon, TableProperties, Shield,
} from "lucide-react";

const highlights = [
  { icon: FileStack, label: "Merge PDF", desc: "Combine multiple PDFs into one", url: "/merge-pdf", enabled: true },
  { icon: Scissors, label: "Split PDF", desc: "Separate pages into new files", url: "/split-pdf", enabled: true },
  { icon: Trash2, label: "Remove Pages", desc: "Delete unwanted pages", url: "/remove-pages", enabled: true },
  { icon: FileOutput, label: "Extract Pages", desc: "Pull specific pages out", url: "/extract-pages", enabled: true },
  { icon: LayoutList, label: "Organize Pages", desc: "Reorder, rotate & duplicate", url: "/organize", enabled: true },
  { icon: Image, label: "Image to PDF", desc: "Convert images to PDF", url: "/image-to-pdf", enabled: true },
  { icon: Minimize2, label: "Compress PDF", desc: "Reduce file size instantly", url: "/compress", enabled: true },
  { icon: Wrench, label: "Repair PDF", desc: "Fix corrupted or broken PDFs", url: "/repair", enabled: true },
  { icon: FileText, label: "Word to PDF", desc: "Convert DOCX & DOC files", url: "/word-to-pdf", enabled: true },
  { icon: Presentation, label: "PowerPoint to PDF", desc: "Convert presentations", url: "/ppt-to-pdf", enabled: true },
  { icon: Table, label: "Excel to PDF", desc: "Convert spreadsheets", url: "/excel-to-pdf", enabled: true },
  { icon: Code, label: "HTML to PDF", desc: "Convert web pages", url: "/html-to-pdf", enabled: true },
  { icon: ImageDown, label: "PDF to Image", desc: "Convert pages to JPG/PNG/WebP", url: "/pdf-to-image", enabled: true },
  { icon: FileDown, label: "PDF to Word", desc: "Extract text to editable docs", url: "/pdf-to-word", enabled: true },
  { icon: PresentationIcon, label: "PDF to PowerPoint", desc: "Convert pages to slides", url: "/pdf-to-ppt", enabled: true },
  { icon: TableProperties, label: "PDF to Excel", desc: "Extract tables & data", url: "/pdf-to-excel", enabled: true },
  { icon: Shield, label: "PDF to PDF/A", desc: "Archival-compliant conversion", url: "/pdf-to-pdfa", enabled: true },
  { icon: RotateCw, label: "Rotate PDF", desc: "Fix page orientation", url: "/rotate-pdf", enabled: false },
  { icon: Lock, label: "Protect PDF", desc: "Add password security", url: "/protect-pdf", enabled: false },
  { icon: Languages, label: "Translate PDF", desc: "Translate documents", url: "/translate-pdf", enabled: false },
];

const perks = [
  { icon: ShieldCheck, title: "100% Private", desc: "Everything runs in your browser. Your files never leave your device." },
  { icon: Zap, title: "Instant Processing", desc: "No waiting for servers. Tools run at the speed of your machine." },
  { icon: Globe, title: "No Signups", desc: "No accounts, no emails, no tracking. Just open and use." },
  { icon: Wrench, title: "Growing Toolkit", desc: "PDF tools today, image & text tools tomorrow. Always expanding." },
];

const Index = () => {
  return (
    <div className="flex flex-col items-center px-6 py-16">
      {/* Hero */}
      <div className="text-center max-w-2xl mb-16 animate-fade-in">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          100% Client-Side · No Uploads · No Signups
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Free Tools, <br />
          <span className="text-primary">Zero Compromise.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-lg mx-auto">
          Open-source utility toolkit that runs entirely in your browser. PDFs, images, conversions & more — no file uploads, no servers, no accounts.
        </p>
      </div>

      {/* Perks */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl w-full mb-14">
        {perks.map((perk, i) => (
          <div
            key={perk.title}
            className="flex flex-col items-center text-center gap-2 p-4 animate-fade-in"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <perk.icon className="w-6 h-6 text-primary" />
            <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{perk.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{perk.desc}</p>
          </div>
        ))}
      </div>

      {/* Section label */}
      <div className="w-full max-w-3xl mb-5">
        <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Available Tools
        </h2>
        <p className="text-sm text-muted-foreground">Click an active tool to get started. More coming soon.</p>
      </div>

      {/* Tool Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl w-full">
        {highlights.map((tool, i) => {
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
                className="group relative bg-card border rounded-xl p-5 flex flex-col items-center text-center gap-3 hover:shadow-lg hover:border-primary/30 hover:scale-[1.03] transition-all duration-200 animate-fade-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {content}
              </Link>
            );
          }

          return (
            <div
              key={tool.label}
              className="group relative bg-card border rounded-xl p-5 flex flex-col items-center text-center gap-3 opacity-50 cursor-not-allowed transition-all animate-fade-in"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {content}
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="mt-16 text-sm text-muted-foreground/60 text-center">
        Tools light up as they're built. All processing happens in your browser — always.
      </p>
    </div>
  );
};

export default Index;
