// Client-side PDF text extraction via pdf.js. Imported dynamically from
// the upload flow so the 2MB pdf.js bundle doesn't ship on initial
// landing-page load (see design review).
//
// Runs entirely in the browser. No PDF ever hits our servers — the user's
// lecture material stays on their device; we transport only the extracted
// text.

export interface ExtractedPdf {
  filename: string;
  pages: number;
  /** Full text, with per-page headers (`=== Page N ===`) between them. */
  text: string;
}

export async function extractPdf(file: File): Promise<ExtractedPdf> {
  // Dynamic import keeps pdf.js off the landing-page bundle.
  const pdfjs = await import("pdfjs-dist");
  // Configure the worker to come from the same bundle. Vite handles
  // `new URL(...)` imports correctly in production + dev.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buf = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: buf });
  const doc = await task.promise;

  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();
    parts.push(`=== ${file.name} · Page ${i} ===\n${pageText}`);
  }

  await doc.destroy();

  return {
    filename: file.name,
    pages: doc.numPages,
    text: parts.join("\n\n"),
  };
}

/** Extract multiple PDFs in parallel (capped so we don't thrash memory
 *  on mobile). Returns joined text with per-PDF headers. */
export async function extractPdfs(files: File[]): Promise<{
  text: string;
  perFile: ExtractedPdf[];
}> {
  // Cap parallelism at 2 on mobile to avoid OOM on large decks.
  const perFile: ExtractedPdf[] = [];
  for (const file of files) {
    const ex = await extractPdf(file);
    perFile.push(ex);
  }
  return {
    text: perFile.map((p) => p.text).join("\n\n"),
    perFile,
  };
}
