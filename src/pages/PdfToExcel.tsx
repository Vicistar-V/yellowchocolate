import { useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { TableProperties, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { downloadBlob } from "@/lib/download-utils";
import { isExtractionPoor } from "@/lib/extraction-quality";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Step = "upload" | "ready" | "processing" | "done";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "ready", label: "2. Convert" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant extraction" },
  { icon: Files, label: "Batch support" },
] as const;

const ACCEPT = "application/pdf,.pdf";

async function pdfToXlsx(buffer: ArrayBuffer, onProgress?: (p: number) => void): Promise<Blob> {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const wb = XLSX.utils.book_new();
  let hasAnyContent = false;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const lineMap = new Map<number, { x: number; text: string; width: number }[]>();

    for (const item of content.items) {
      if (!("str" in item) || !(item as any).str.trim()) continue;
      const textItem = item as { str: string; transform: number[]; width: number };
      const y = Math.round(textItem.transform[5]);
      const x = Math.round(textItem.transform[4]);

      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x, text: textItem.str, width: textItem.width || (textItem.str.length * 5) });
    }

    const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);

    const rows: string[][] = [];
    for (const y of sortedYs) {
      const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);

      const row: string[] = [];
      let prevEnd = -Infinity;
      let currentCell = "";

      for (const item of items) {
        const gap = item.x - prevEnd;
        // Use actual item width for better column detection
        if (gap > 15 && currentCell) {
          row.push(currentCell.trim());
          currentCell = "";
        }
        currentCell += item.text;
        prevEnd = item.x + item.width;
      }
      if (currentCell.trim()) row.push(currentCell.trim());
      if (row.length > 0) rows.push(row);
    }

    // Check quality for this page
    const pageText = rows.map((r) => r.join(" ")).join(" ");
    const poor = isExtractionPoor(pageText);

    let sheetData: any[][];
    if (rows.length === 0 || poor) {
      sheetData = [
        ["Page " + i + (poor ? " (limited text extraction — page may be scanned)" : "")],
        ...(rows.length > 0 ? rows : [["(No extractable text content on this page)"]]),
      ];
      if (rows.length > 0) hasAnyContent = true;
    } else {
      sheetData = rows;
      hasAnyContent = true;
    }

    const sheetName = pdf.numPages > 1 ? `Page ${i}` : "Sheet1";
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    onProgress?.(Math.round((i / pdf.numPages) * 90));
  }

  if (!hasAnyContent) {
    toast.info("PDF appears to be scanned/image-based — limited text was extracted");
  }

  const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([xlsxBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export default function PdfToExcel() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [convertedCount, setConvertedCount] = useState(0);

  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      const items: FileItem[] = newFiles.map((file) => ({
        id: generateId(),
        file,
        pageCount: null,
        sizeFormatted: formatFileSize(file.size),
      }));
      if (step === "upload") setStep("ready");
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

  const handleConvert = useCallback(async () => {
    setStep("processing");
    setProgress(0);
    const startTime = Date.now();

    try {
      const results: { name: string; blob: Blob }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i].file;
        const buffer = await file.arrayBuffer();
        const blob = await pdfToXlsx(buffer, (p) => {
          setProgress(Math.round(((i + p / 100) / files.length) * 100));
        });
        const baseName = file.name.replace(/\.pdf$/i, "");
        results.push({ name: `${baseName}.xlsx`, blob });
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(2000 - elapsed, 0);
      if (remaining > 0) {
        setProgress(90);
        await new Promise((r) => setTimeout(r, remaining * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, remaining * 0.4));
      }

      if (results.length === 1) {
        setResultBlob(results[0].blob);
      } else {
        const zip = new JSZip();
        results.forEach((item) => zip.file(item.name, item.blob));
        setResultBlob(await zip.generateAsync({ type: "blob" }));
      }

      setConvertedCount(results.length);
      setStep("done");
      toast.success(`Converted ${results.length} file${results.length > 1 ? "s" : ""} to Excel`);
    } catch (err) {
      console.error("PDF to Excel failed:", err);
      toast.error("Conversion failed", { description: String(err instanceof Error ? err.message : "Could not process one or more files.") });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const filename = convertedCount > 1 ? "pdf-to-excel.zip" : `${files[0]?.file.name.replace(/\.pdf$/i, "")}.xlsx`;
    downloadBlob(resultBlob, filename);
  }, [resultBlob, convertedCount, files]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setResultBlob(null);
    setConvertedCount(0);
    setProgress(0);
    setStep("upload");
  }, []);

  const completedSteps = [
    ...(step !== "upload" ? ["upload"] : []),
    ...(step === "done" || step === "processing" ? ["ready"] : []),
    ...(step === "done" ? ["done"] : []),
  ];

  return (
    <ToolPageLayout
      icon={TableProperties}
      title="PDF to Excel"
      subtitle="Extract text & tables from PDFs into XLSX — batch supported"
      steps={STEPS}
      currentStep={step === "processing" ? "ready" : step}
      completedSteps={completedSteps}
      trustBadges={[...TRUST_BADGES]}
      showBadgesOnStep="upload"
    >
      {(step === "upload" || step === "ready") && (
        <div className="space-y-5">
          {step === "upload" && (
            <FileDropZone
              onFilesSelected={handleFilesSelected}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              accept={ACCEPT}
              title={isDragging ? "Drop your PDFs here!" : "Drag & drop PDF files here"}
              subtitle="PDF files · Multiple files supported"
              buttonLabel="Select PDF Files"
              dragIcon={TableProperties}
            />
          )}
          {step === "ready" && (
            <>
              <FileList files={files} onRemove={handleRemove} onReorder={setFiles} headerTitle="Files to convert" headerHint="Drag to reorder" />
              <FileDropZone
                onFilesSelected={handleFilesSelected}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
                accept={ACCEPT}
                title={isDragging ? "Drop more files!" : "Add more PDFs"}
                buttonLabel="Add More Files"
                dragIcon={TableProperties}
              />
              <button
                onClick={handleConvert}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <TableProperties className="w-5 h-5" />
                Convert {files.length} PDF{files.length !== 1 ? "s" : ""} to Excel
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <ProcessingView title="Converting PDF to Excel..." subtitle={`Processing ${files.length} file${files.length !== 1 ? "s" : ""} in your browser`} progress={progress} />
      )}

      {step === "done" && resultBlob && (
        <SuccessView
          title="Conversion Complete!"
          description={`<strong>${convertedCount}</strong> file${convertedCount > 1 ? "s" : ""} converted to Excel`}
          fileName={convertedCount > 1 ? "pdf-to-excel" : files[0]?.file.name.replace(/\.pdf$/i, "") || "spreadsheet"}
          fileExtension={convertedCount > 1 ? ".zip" : ".xlsx"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Convert More"
        />
      )}
    </ToolPageLayout>
  );
}
