import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

/**
 * Text-based PDF renderer — produces real selectable text PDFs from HTML content.
 * Uses pdf-lib's native text drawing instead of html2canvas image rasterization.
 */

interface TextBlock {
  type: "heading1" | "heading2" | "heading3" | "paragraph" | "list-item" | "table-row" | "empty-line";
  text: string;
  cells?: string[]; // for table rows
  bold?: boolean;
}

/** Parse HTML string into structured text blocks */
function parseHtmlToBlocks(html: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild || doc.body;

  function processNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    switch (tag) {
      case "h1":
        blocks.push({ type: "heading1", text: el.textContent?.trim() || "" });
        break;
      case "h2":
        blocks.push({ type: "heading2", text: el.textContent?.trim() || "" });
        break;
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        blocks.push({ type: "heading3", text: el.textContent?.trim() || "" });
        break;
      case "p":
      case "div":
      case "span":
      case "section":
      case "article": {
        // Check if it contains block-level children
        const hasBlockChildren = Array.from(el.children).some((c) =>
          ["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "table", "ul", "ol", "blockquote"].includes(c.tagName.toLowerCase())
        );
        if (hasBlockChildren) {
          Array.from(el.childNodes).forEach(processNode);
        } else {
          const text = el.textContent?.trim();
          if (text) {
            blocks.push({ type: "paragraph", text });
          }
        }
        break;
      }
      case "br":
        blocks.push({ type: "empty-line", text: "" });
        break;
      case "ul":
      case "ol": {
        const items = el.querySelectorAll(":scope > li");
        items.forEach((li, idx) => {
          const prefix = tag === "ol" ? `${idx + 1}. ` : "• ";
          blocks.push({ type: "list-item", text: prefix + (li.textContent?.trim() || "") });
        });
        break;
      }
      case "table": {
        const rows = el.querySelectorAll("tr");
        rows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll("th, td")).map(
            (cell) => cell.textContent?.trim() || ""
          );
          blocks.push({
            type: "table-row",
            text: cells.join(" | "),
            cells,
            bold: idx === 0 && tr.querySelector("th") !== null,
          });
        });
        blocks.push({ type: "empty-line", text: "" });
        break;
      }
      case "blockquote": {
        const text = el.textContent?.trim();
        if (text) {
          blocks.push({ type: "paragraph", text: `"${text}"` });
        }
        break;
      }
      case "pre":
      case "code": {
        const text = el.textContent?.trim();
        if (text) {
          // Split code blocks into individual lines
          text.split("\n").forEach((line) => {
            blocks.push({ type: "paragraph", text: line || " " });
          });
        }
        break;
      }
      case "strong":
      case "b":
      case "em":
      case "i":
      case "a":
      case "u": {
        const text = el.textContent?.trim();
        if (text) {
          blocks.push({ type: "paragraph", text });
        }
        break;
      }
      default:
        // Process children for unknown elements
        Array.from(el.childNodes).forEach(processNode);
    }
  }

  Array.from(root.childNodes).forEach(processNode);
  return blocks;
}

/** Wrap a single line of text to fit within maxWidth */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [""];
}

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

interface DrawState {
  y: number;
  page: PDFPage;
}

export async function renderHtmlToPdf(
  htmlContent: string,
  options?: {
    css?: string;
    onProgress?: (progress: number) => void;
    pageWidth?: number;
    pageHeight?: number;
  }
): Promise<Blob> {
  const { onProgress } = options ?? {};

  onProgress?.(5);

  const pdfDoc = await PDFDocument.create();

  // Embed standard fonts — these support real selectable text
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fonts: FontSet = { regular, bold, italic };

  onProgress?.(10);

  // Page dimensions (A4 in points)
  const pageW = 595.28;
  const pageH = 841.89;
  const marginX = 50;
  const marginTop = 60;
  const marginBottom = 60;
  const contentWidth = pageW - marginX * 2;
  const usableHeight = pageH - marginTop - marginBottom;

  // Parse HTML into text blocks
  const blocks = parseHtmlToBlocks(htmlContent);

  onProgress?.(20);

  if (blocks.length === 0) {
    // Empty content — create a single page with a message
    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawText("No extractable content found.", {
      x: marginX,
      y: pageH - marginTop - 20,
      size: 14,
      font: italic,
      color: rgb(0.6, 0.6, 0.6),
    });
    const bytes = await pdfDoc.save();
    onProgress?.(100);
    return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  }

  // Create first page
  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH - marginTop;

  function newPage(): PDFPage {
    page = pdfDoc.addPage([pageW, pageH]);
    y = pageH - marginTop;
    return page;
  }

  function ensureSpace(needed: number) {
    if (y - needed < marginBottom) {
      newPage();
    }
  }

  // Render blocks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const progress = 20 + Math.round((i / blocks.length) * 70);
    onProgress?.(progress);

    switch (block.type) {
      case "heading1": {
        const fontSize = 22;
        const lineHeight = fontSize * 1.4;
        ensureSpace(lineHeight + 16);
        y -= 16; // space before heading
        const lines = wrapText(block.text, bold, fontSize, contentWidth);
        for (const line of lines) {
          ensureSpace(lineHeight);
          page.drawText(line, { x: marginX, y: y - fontSize, size: fontSize, font: bold, color: rgb(0.1, 0.1, 0.1) });
          y -= lineHeight;
        }
        y -= 6; // space after heading
        break;
      }
      case "heading2": {
        const fontSize = 18;
        const lineHeight = fontSize * 1.4;
        ensureSpace(lineHeight + 14);
        y -= 14;
        const lines = wrapText(block.text, bold, fontSize, contentWidth);
        for (const line of lines) {
          ensureSpace(lineHeight);
          page.drawText(line, { x: marginX, y: y - fontSize, size: fontSize, font: bold, color: rgb(0.1, 0.1, 0.1) });
          y -= lineHeight;
        }
        y -= 4;
        break;
      }
      case "heading3": {
        const fontSize = 14;
        const lineHeight = fontSize * 1.4;
        ensureSpace(lineHeight + 10);
        y -= 10;
        const lines = wrapText(block.text, bold, fontSize, contentWidth);
        for (const line of lines) {
          ensureSpace(lineHeight);
          page.drawText(line, { x: marginX, y: y - fontSize, size: fontSize, font: bold, color: rgb(0.15, 0.15, 0.15) });
          y -= lineHeight;
        }
        y -= 3;
        break;
      }
      case "paragraph": {
        const fontSize = 11;
        const lineHeight = fontSize * 1.6;
        const lines = wrapText(block.text, regular, fontSize, contentWidth);
        for (const line of lines) {
          ensureSpace(lineHeight);
          page.drawText(line, { x: marginX, y: y - fontSize, size: fontSize, font: regular, color: rgb(0.15, 0.15, 0.15) });
          y -= lineHeight;
        }
        y -= 4; // paragraph spacing
        break;
      }
      case "list-item": {
        const fontSize = 11;
        const lineHeight = fontSize * 1.6;
        const indent = 16;
        const lines = wrapText(block.text, regular, fontSize, contentWidth - indent);
        for (const line of lines) {
          ensureSpace(lineHeight);
          page.drawText(line, { x: marginX + indent, y: y - fontSize, size: fontSize, font: regular, color: rgb(0.15, 0.15, 0.15) });
          y -= lineHeight;
        }
        y -= 2;
        break;
      }
      case "table-row": {
        const fontSize = 10;
        const lineHeight = fontSize * 1.6;
        const cellFont = block.bold ? bold : regular;

        if (block.cells && block.cells.length > 0) {
          const colCount = block.cells.length;
          const colWidth = contentWidth / colCount;

          ensureSpace(lineHeight + 2);

          // Draw row background for header
          if (block.bold) {
            page.drawRectangle({
              x: marginX,
              y: y - lineHeight - 1,
              width: contentWidth,
              height: lineHeight + 2,
              color: rgb(0.94, 0.94, 0.94),
            });
          }

          // Draw cell borders
          for (let c = 0; c <= colCount; c++) {
            page.drawLine({
              start: { x: marginX + c * colWidth, y: y + 1 },
              end: { x: marginX + c * colWidth, y: y - lineHeight - 1 },
              thickness: 0.5,
              color: rgb(0.78, 0.78, 0.78),
            });
          }
          // Top and bottom lines
          page.drawLine({
            start: { x: marginX, y: y + 1 },
            end: { x: marginX + contentWidth, y: y + 1 },
            thickness: 0.5,
            color: rgb(0.78, 0.78, 0.78),
          });
          page.drawLine({
            start: { x: marginX, y: y - lineHeight - 1 },
            end: { x: marginX + contentWidth, y: y - lineHeight - 1 },
            thickness: 0.5,
            color: rgb(0.78, 0.78, 0.78),
          });

          // Draw cell text
          for (let c = 0; c < colCount; c++) {
            const cellText = block.cells[c] || "";
            // Truncate if too wide
            let displayText = cellText;
            while (displayText.length > 0 && cellFont.widthOfTextAtSize(displayText, fontSize) > colWidth - 8) {
              displayText = displayText.slice(0, -1);
            }
            if (displayText.length < cellText.length) displayText += "…";

            page.drawText(displayText, {
              x: marginX + c * colWidth + 4,
              y: y - fontSize - 1,
              size: fontSize,
              font: cellFont,
              color: rgb(0.15, 0.15, 0.15),
            });
          }

          y -= lineHeight + 2;
        }
        break;
      }
      case "empty-line": {
        y -= 10;
        break;
      }
    }
  }

  onProgress?.(95);

  const pdfBytes = await pdfDoc.save();
  onProgress?.(100);

  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}
