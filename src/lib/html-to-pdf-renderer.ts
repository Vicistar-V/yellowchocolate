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
    pageWidth?: number;
    pageHeight?: number;
  }
): Promise<Blob> {
  const {
    css = "",
    onProgress,
    pageWidth = 794,
    pageHeight = 1123,
  } = options ?? {};

  onProgress?.(5);

  // Create hidden container — use clip instead of extreme offsets for reliable rendering
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; left: -9999px; top: -9999px;
    width: ${pageWidth}px; background: white; color: black;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px; line-height: 1.6; padding: 48px;
    box-sizing: border-box;
    pointer-events: none;
    overflow: visible;
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

  onProgress?.(10);

  try {
    // Wait for fonts
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    // Wait for all images to load
    const images = container.querySelectorAll("img");
    if (images.length > 0) {
      await Promise.all(
        Array.from(images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
              setTimeout(resolve, 3000);
            })
        )
      );
    }

    // Small layout settle delay
    await new Promise((r) => setTimeout(r, 100));

    onProgress?.(15);

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

    // Guard: detect blank canvas
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const sample = ctx.getImageData(0, 0, canvas.width, Math.min(100, canvas.height));
      let nonWhitePixels = 0;
      for (let i = 0; i < sample.data.length; i += 4) {
        if (sample.data[i] < 250 || sample.data[i + 1] < 250 || sample.data[i + 2] < 250) {
          nonWhitePixels++;
        }
      }
      if (nonWhitePixels < 10 && canvas.height > 200) {
        // Canvas appears blank — check full height
        const fullSample = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let totalNonWhite = 0;
        for (let i = 0; i < fullSample.data.length; i += 16) {
          if (fullSample.data[i] < 250 || fullSample.data[i + 1] < 250 || fullSample.data[i + 2] < 250) {
            totalNonWhite++;
          }
        }
        if (totalNonWhite < 50) {
          throw new Error("Rendered content appears blank. The document may be empty or unsupported.");
        }
      }
    }

    // Split canvas into pages
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const scaledPageHeight = pageHeight * 2; // because scale: 2
    const totalPages = Math.max(1, Math.ceil(canvasHeight / scaledPageHeight));

    const pdfDoc = await PDFDocument.create();
    const a4Width = 595.28;
    const a4Height = 841.89;

    for (let i = 0; i < totalPages; i++) {
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvasWidth;
      const sliceHeight = Math.min(scaledPageHeight, canvasHeight - i * scaledPageHeight);
      pageCanvas.height = sliceHeight;

      const pCtx = pageCanvas.getContext("2d")!;
      pCtx.fillStyle = "#ffffff";
      pCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pCtx.drawImage(
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
