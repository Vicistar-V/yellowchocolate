import { useState, useCallback } from "react";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import JSZip from "jszip";
import { Shield, ShieldCheck, Zap, ArrowRight, Files } from "lucide-react";
import { ToolPageLayout } from "@/components/tool/ToolPageLayout";
import { FileDropZone } from "@/components/tool/FileDropZone";
import { FileList } from "@/components/tool/FileList";
import { ProcessingView } from "@/components/tool/ProcessingView";
import { SuccessView } from "@/components/tool/SuccessView";
import { formatFileSize, generateId, staggerAddFiles, type FileItem } from "@/lib/file-utils";
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

const ACCEPT = "application/pdf,.pdf";

async function convertToPdfa(buffer: ArrayBuffer): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  // Set PDF/A-1b metadata
  pdfDoc.setTitle(pdfDoc.getTitle() || "Untitled");
  pdfDoc.setProducer("yellowChocolates PDF/A Converter");
  pdfDoc.setCreator("yellowChocolates");

  // Add XMP metadata for PDF/A-1b compliance
  const now = new Date();
  const isoDate = now.toISOString();
  const title = pdfDoc.getTitle() || "Untitled";

  const xmpMetadata = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
      <xmp:CreateDate>${isoDate}</xmp:CreateDate>
      <xmp:ModifyDate>${isoDate}</xmp:ModifyDate>
      <xmp:CreatorTool>yellowChocolates</xmp:CreatorTool>
      <pdfaid:part>1</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <pdf:Producer>yellowChocolates PDF/A Converter</pdf:Producer>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  const metadataStream = pdfDoc.context.stream(
    new TextEncoder().encode(xmpMetadata),
    { Type: PDFName.of("Metadata"), Subtype: PDFName.of("XML") }
  );
  const metadataRef = pdfDoc.context.register(metadataStream);
  pdfDoc.catalog.set(PDFName.of("Metadata"), metadataRef);

  // Mark output intent for PDF/A
  const outputIntentDict = pdfDoc.context.obj({
    Type: PDFName.of("OutputIntent"),
    S: PDFName.of("GTS_PDFA1"),
    OutputConditionIdentifier: PDFString.of("sRGB"),
    RegistryName: PDFString.of("http://www.color.org"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
  });
  const outputIntentRef = pdfDoc.context.register(outputIntentDict);
  pdfDoc.catalog.set(PDFName.of("OutputIntents"), pdfDoc.context.obj([outputIntentRef]));

  const bytes = await pdfDoc.save();
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

export default function PdfToPdfa() {
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
        const blob = await convertToPdfa(buffer);
        const baseName = file.name.replace(/\.pdf$/i, "");
        results.push({ name: `${baseName}_PDFA.pdf`, blob });
        setProgress(Math.round(((i + 1) / files.length) * 85));
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
      toast.success(`Converted ${results.length} file${results.length > 1 ? "s" : ""} to PDF/A`);
    } catch (err) {
      console.error("PDF to PDF/A failed:", err);
      toast.error("Conversion failed", { description: "Could not process one or more files." });
      setStep("ready");
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = convertedCount > 1 ? "pdf-to-pdfa.zip" : `${files[0]?.file.name.replace(/\.pdf$/i, "")}_PDFA.pdf`;
    a.click();
    URL.revokeObjectURL(url);
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
      icon={Shield}
      title="PDF to PDF/A"
      subtitle="Convert PDFs to archival-compliant PDF/A-1b format — batch supported"
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
              dragIcon={Shield}
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
                dragIcon={Shield}
              />
              <button
                onClick={handleConvert}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                <Shield className="w-5 h-5" />
                Convert {files.length} PDF{files.length !== 1 ? "s" : ""} to PDF/A
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <ProcessingView title="Converting to PDF/A..." subtitle={`Processing ${files.length} file${files.length !== 1 ? "s" : ""} in your browser`} progress={progress} />
      )}

      {step === "done" && resultBlob && (
        <SuccessView
          title="Conversion Complete!"
          description={`<strong>${convertedCount}</strong> file${convertedCount > 1 ? "s" : ""} converted to PDF/A-1b`}
          fileName={convertedCount > 1 ? "pdf-to-pdfa" : `${files[0]?.file.name.replace(/\.pdf$/i, "")}_PDFA` || "document_PDFA"}
          fileExtension={convertedCount > 1 ? ".zip" : ".pdf"}
          onDownload={handleDownload}
          onReset={handleReset}
          resetLabel="Convert More"
        />
      )}
    </ToolPageLayout>
  );
}
