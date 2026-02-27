import { PDFDocument } from "pdf-lib";
import html2canvas from "html2canvas";

/**
 * Renders an HTML string into a multi-page PDF blob.
 * The HTML is rendered into a hidden container, captured via html2canvas,
 * then split into A4-sized pages and embedded in a pdf-lib document.
 */
export async function renderHtmlToPdf(
  htmlContent: string,
  options?: {
    css?: string;
    onProgress?: (progress: number) => void;
    pageWidth?: number;    // render width in px (default 794 ≈ A4 at 96dpi)
    pageHeight?: number;   // page height in px for splitting (default 1123 ≈ A4)
  }
): Promise<Blob> {
  const {
    css = "",
    onProgress,
    pageWidth = 794,
    pageHeight = 1123,
  } = options ?? {};

  onProgress?.(5);

  // Create hidden container
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; top: -99999px; left: -99999px;
    width: ${pageWidth}px; background: white; color: black;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px; line-height: 1.6; padding: 48px;
    box-sizing: border-box;
  `;
  if (css) {
    const style = document.createElement("style");
    style.textContent = css;
    container.appendChild(style);
  }

  const content = document.createElement("div");
  content.innerHTML = htmlContent;
  container.appendChild(content);
  document.body.appendChild(container);

  onProgress?.(15);

  try {
    // Render to canvas
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: pageWidth,
      windowWidth: pageWidth,
      logging: false,
    });

    onProgress?.(50);

    // Split canvas into pages
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const scaledPageHeight = pageHeight * 2; // because scale: 2
    const totalPages = Math.max(1, Math.ceil(canvasHeight / scaledPageHeight));

    const pdfDoc = await PDFDocument.create();
    const a4Width = 595.28;  // A4 in PDF points
    const a4Height = 841.89;

    for (let i = 0; i < totalPages; i++) {
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvasWidth;
      const sliceHeight = Math.min(scaledPageHeight, canvasHeight - i * scaledPageHeight);
      pageCanvas.height = sliceHeight;

      const ctx = pageCanvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(
        canvas,
        0, i * scaledPageHeight,
        canvasWidth, sliceHeight,
        0, 0,
        canvasWidth, sliceHeight
      );

      const pageDataUrl = pageCanvas.toDataURL("image/png");
      const imgBytes = await fetch(pageDataUrl).then((r) => r.arrayBuffer());
      const img = await pdfDoc.embedPng(imgBytes);

      const aspectRatio = sliceHeight / canvasWidth;
      const pdfPageHeight = a4Width * aspectRatio;
      const page = pdfDoc.addPage([a4Width, Math.min(pdfPageHeight, a4Height)]);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: a4Width,
        height: Math.min(pdfPageHeight, a4Height),
      });

      onProgress?.(50 + Math.round(((i + 1) / totalPages) * 45));
    }

    const pdfBytes = await pdfDoc.save();
    onProgress?.(100);

    return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
  } finally {
    document.body.removeChild(container);
  }
}
