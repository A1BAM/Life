import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Extract text from a lecture PDF in the browser.
 * Keeps 80MB decks off the Worker request path entirely — only the extracted
 * text chunks are posted.
 */
export async function extractText(file, onProgress) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    if (text) pages.push(text);
    onProgress?.(i, doc.numPages);
  }
  return pages;
}

/**
 * Group pages into generator-sized chunks (~8k chars), never splitting a page.
 * Slide decks run 200-260 pages, so this lands around 10-20 chunks.
 */
export function chunkPages(pages, target = 8000) {
  const chunks = [];
  let cur = "";
  for (const page of pages) {
    if (cur.length + page.length > target && cur.length > 500) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += page + "\n\n";
  }
  if (cur.trim().length > 200) chunks.push(cur.trim());
  return chunks;
}
