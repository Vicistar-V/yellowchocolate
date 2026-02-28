/**
 * Assess whether text extracted from a PDF page/document is too poor to be useful.
 * Returns true when the extraction is likely from a scanned/image PDF.
 */
export function isExtractionPoor(text: string): boolean {
  if (!text || text.length < 10) return true;
  const letterMatch = text.match(/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF]/g);
  const letterCount = letterMatch ? letterMatch.length : 0;
  const whitespaceCount = (text.match(/\s/g) || []).length;
  const whitespaceRatio = text.length > 0 ? whitespaceCount / text.length : 1;

  // Only flag as poor if very little meaningful content
  return (
    letterCount < 10 ||
    whitespaceRatio > 0.85
  );
}

/**
 * Assess quality for a set of pages — returns true if overall quality is poor.
 */
export function isPagesExtractionPoor(pages: string[][]): boolean {
  const allText = pages.map((lines) => lines.join(" ")).join(" ");
  return isExtractionPoor(allText);
}
