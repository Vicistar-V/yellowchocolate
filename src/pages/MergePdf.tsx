import { useState, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import { FileStack, Plus, ShieldCheck, Zap, ArrowRight } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { OutputConfig, type OutputOptions } from "@/components/tool/OutputConfig";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";

type MergeStep = "upload" | "arrange" | "merging" | "done";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "arrange", label: "2. Arrange" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant processing" },
  { icon: FileStack, label: "Unlimited files" },
] as const;

export default function MergePdf() {
  const [step, setStep] = useState<MergeStep>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [options, setOptions] = useState<OutputOptions>({ outputFileName: "merged-document" });

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      const items: FileItem[] = [];
      for (const file of newFiles) {
        let pageCount: number | null = null;
        try {
          const buffer = await file.arrayBuffer();
          const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
          pageCount = pdf.getPageCount();
        } catch { /* can't read pages */ }
        items.push({ id: generateId(), file, pageCount, sizeFormatted: formatFileSize(file.size) });
      }
      if (step === "upload") setStep("arrange");
      await staggerAddFiles(items, setFiles);
    },
    [step]
  );

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (next.length === 0) setStep("upload");
      return next;
    });
  }, []);

  const handleMerge = useCallback(async () => {
    setStep("merging");
    setMergeProgress(0);
    const startTime = Date.now();
    try {
      const mergedPdf = await PDFDocument.create();
      let pagesTotal = 0;
      for (let i = 0; i < files.length; i++) {
        const buffer = await files[i].file.arrayBuffer();
        const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
        pagesTotal += pages.length;
        setMergeProgress(Math.round(((i + 1) / files.length) * 100));
      }
      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(2000 - elapsed, 0);
      if (remaining > 0) {
        setMergeProgress(90);
        await new Promise((r) => setTimeout(r, remaining * 0.6));
        setMergeProgress(100);
        await new Promise((r) => setTimeout(r, remaining * 0.4));
      }
      setMergedBlob(blob);
      setTotalPages(pagesTotal);
      setStep("done");
    } catch (err) {
      console.error("Merge failed:", err);
      setStep("arrange");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!mergedBlob) return;
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${options.outputFileName || "merged"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [mergedBlob, options.outputFileName]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setMergedBlob(null);
    setTotalPages(0);
    setMergeProgress(0);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "merging" ? ["arrange"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  const currentStepKey = step === "merging" ? "arrange" : step;

  return (
    <ToolPageLayout
      icon={FileStack}
      title="Merge PDF"
      subtitle="Combine multiple PDFs into a single document"
      steps={STEPS}
      currentStep={currentStepKey}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {(step === "upload" || step === "arrange") && (
        <div className="space-y-5">
          {step === "upload" && (
            <FileDropZone
              onFilesSelected={handleFilesSelected}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              accept="application/pdf"
              title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
              buttonLabel="Select PDF Files"
            />
          )}

          {step === "arrange" && (
            <>
              <FileList
                files={files}
                onRemove={handleRemove}
                onReorder={setFiles}
                headerTitle="Files to merge"
                headerHint="Drag to reorder · First file = first pages"
              />

              <FileDropZone
                onFilesSelected={handleFilesSelected}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
                accept="application/pdf"
                title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
                buttonLabel="Select PDF Files"
              />

              <OutputConfig
                options={options}
                onChange={setOptions}
                title="Merge Settings"
              />

              <button
                onClick={handleMerge}
                disabled={files.length < 2}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <FileStack className="w-5 h-5" />
                Merge {files.length} File{files.length !== 1 ? "s" : ""} into One PDF
                <ArrowRight className="w-5 h-5" />
              </button>

              {files.length < 2 && (
                <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Add at least 2 files to merge
                </p>
              )}
            </>
          )}
        </div>
      )}

      {step === "merging" && (
        <ProcessingView
          title="Merging your PDFs..."
          subtitle={`Processing ${files.length} files in your browser`}
          progress={mergeProgress}
        />
      )}

      {step === "done" && mergedBlob && (
        <SuccessView
          title="Merge Complete!"
          description={`${files.length} files merged into <strong>${totalPages} pages</strong>`}
          fileName={options.outputFileName || "merged"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Merge More"
        />
      )}
    </ToolPageLayout>
  );
}
