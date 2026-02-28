import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { Table, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
import { renderHtmlToPdf } from "@/lib/html-to-pdf-renderer";
import { downloadBlob } from "@/lib/download-utils";
import { toast } from "sonner";

type Step = "upload" | "ready" | "processing" | "done";

const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "ready", label: "2. Convert" },
  { key: "done", label: "3. Download" },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "No uploads" },
  { icon: Zap, label: "Instant conversion" },
  { icon: Files, label: "Batch support" },
] as const;

const ACCEPT = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

const EXCEL_CSS = `
  h2 { font-size: 18px; font-weight: 700; margin: 24px 0 8px; color: #1a1a1a; padding-bottom: 4px; border-bottom: 2px solid #e5e5e5; }
  h2:first-child { margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 20px; font-size: 12px; }
  th { background: #f0f0f0; font-weight: 600; text-align: left; padding: 6px 10px; border: 1px solid #d0d0d0; white-space: nowrap; }
  td { padding: 5px 10px; border: 1px solid #d0d0d0; word-break: break-word; }
  tr:nth-child(even) td { background: #fafafa; }
`;

/**
 * Convert workbook to HTML using AOA (array-of-arrays) for reliability.
 * Falls back gracefully for empty sheets.
 */
function workbookToHtml(workbook: XLSX.WorkBook): string {
  const sheets = workbook.SheetNames;
  let html = "";
  let hasContent = false;

  for (const name of sheets) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    // Use AOA for more reliable rendering
    const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    // Filter out completely empty rows
    const rows = aoa.filter((row) => row.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== ""));

    if (rows.length === 0) {
      if (sheets.length > 1) {
        html += `<h2>${name}</h2><p style="color:#999;font-style:italic;">Empty sheet</p>`;
      }
      continue;
    }

    hasContent = true;
    if (sheets.length > 1) {
      html += `<h2>${name}</h2>`;
    }

    // Find max columns
    const maxCols = Math.max(...rows.map((r) => r.length));

    html += `<table>`;
    // First row as header
    html += `<thead><tr>`;
    for (let c = 0; c < maxCols; c++) {
      const val = rows[0]?.[c];
      html += `<th>${val !== undefined && val !== null ? String(val) : ""}</th>`;
    }
    html += `</tr></thead>`;

    // Remaining rows
    if (rows.length > 1) {
      html += `<tbody>`;
      for (let r = 1; r < rows.length; r++) {
        html += `<tr>`;
        for (let c = 0; c < maxCols; c++) {
          const val = rows[r]?.[c];
          html += `<td>${val !== undefined && val !== null ? String(val) : ""}</td>`;
        }
        html += `</tr>`;
      }
      html += `</tbody>`;
    }
    html += `</table>`;
  }

  if (!hasContent) {
    html = `<p style="color:#999;font-style:italic;">No data found in the spreadsheet.</p>`;
  }

  return html;
}

export default function ExcelToPdf() {
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
      const pdfBlobs: { name: string; blob: Blob }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i].file;
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
        const htmlContent = workbookToHtml(workbook);

        const blob = await renderHtmlToPdf(htmlContent, {
          css: EXCEL_CSS,
          pageWidth: 1100,
          onProgress: (p) => {
            const fileProgress = ((i + p / 100) / files.length) * 100;
            setProgress(Math.round(fileProgress));
          },
        });

        const baseName = file.name.replace(/\.(xlsx?|csv|XLSX?|CSV)$/, "");
        pdfBlobs.push({ name: `${baseName}.pdf`, blob });
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(2000 - elapsed, 0);
      if (remaining > 0) {
        setProgress(90);
        await new Promise((r) => setTimeout(r, remaining * 0.6));
        setProgress(100);
        await new Promise((r) => setTimeout(r, remaining * 0.4));
      }

      if (pdfBlobs.length === 1) {
        setResultBlob(pdfBlobs[0].blob);
      } else {
        const zip = new JSZip();
        pdfBlobs.forEach((item) => zip.file(item.name, item.blob));
        const zipBlob = await zip.generateAsync({ type: "blob" });
        setResultBlob(zipBlob);
      }

      setConvertedCount(pdfBlobs.length);
      setStep("done");
      toast.success(`Converted ${pdfBlobs.length} file${pdfBlobs.length > 1 ? "s" : ""} successfully`);
    } catch (err) {
      console.error("Excel to PDF failed:", err);
      toast.error("Conversion failed", { description: String(err instanceof Error ? err.message : "Could not process one or more files.") });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const isZip = convertedCount > 1;
    const filename = isZip ? "excel-to-pdf.zip" : `${files[0]?.file.name.replace(/\.(xlsx?|csv|XLSX?|CSV)$/, "")}.pdf`;
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
      icon={Table}
      title="Excel to PDF"
      subtitle="Convert XLSX, XLS & CSV files to PDF — batch supported"
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
              title={isDragging ? "Drop your spreadsheets here!" : "Drag & drop Excel files here"}
              subtitle="XLSX, XLS & CSV supported · Multiple files allowed"
              buttonLabel="Select Excel Files"
              dragIcon={Table}
            />
          )}

          {step === "ready" && (
            <>
              <FileList
                files={files}
                onRemove={handleRemove}
                onReorder={setFiles}
                headerTitle="Files to convert"
                headerHint="Drag to reorder"
              />

              <FileDropZone
                onFilesSelected={handleFilesSelected}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
                accept={ACCEPT}
                title={isDragging ? "Drop more files!" : "Add more spreadsheets"}
                buttonLabel="Add More Files"
                dragIcon={Table}
              />

              <button
                onClick={handleConvert}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Table className="w-5 h-5" />
                Convert {files.length} File{files.length !== 1 ? "s" : ""} to PDF
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <ProcessingView
          title="Converting Excel to PDF..."
          subtitle={`Processing ${files.length} spreadsheet${files.length !== 1 ? "s" : ""} in your browser`}
          progress={progress}
        />
      )}

      {step === "done" && resultBlob && (
        <SuccessView
          title="Conversion Complete!"
          description={`<strong>${convertedCount}</strong> spreadsheet${convertedCount > 1 ? "s" : ""} converted to PDF`}
          fileName={convertedCount > 1 ? "excel-to-pdf" : files[0]?.file.name.replace(/\.(xlsx?|csv|XLSX?|CSV)$/, "") || "spreadsheet"}
          fileExtension={convertedCount > 1 ? ".zip" : ".pdf"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Convert More"
        />
      )}
    </ToolPageLayout>
  );
}
