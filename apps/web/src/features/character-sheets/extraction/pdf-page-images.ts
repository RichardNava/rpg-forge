const MAX_VISUAL_PAGES = 3;
const MAX_PAGE_EDGE = 1600;

/** Renders only the requested PDF pages in the browser for visual extraction. */
export async function renderPdfPageImages(
  file: Blob,
  startPage = 1,
): Promise<Blob[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // PDF.js requires an explicit ESM worker URL when bundled by Next.js.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  try {
    const pdf = await loadingTask.promise;
    const pages: Blob[] = [];
    for (
      let pageNumber = startPage;
      pageNumber <= Math.min(pdf.numPages, startPage + MAX_VISUAL_PAGES - 1);
      pageNumber += 1
    ) {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2,
        MAX_PAGE_EDGE / Math.max(base.width, base.height),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("PDF pages cannot be rendered.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const image = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      if (image === null)
        throw new Error("PDF page image could not be created.");
      pages.push(image);
      page.cleanup();
    }
    if (pages.length === 0)
      throw new Error("The selected PDF pages do not exist.");
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

/** Normalizes direct PNG/JPEG uploads to the Worker-required JPEG page format. */
export async function normalizeImageToJpeg(file: Blob): Promise<Blob> {
  if (file.type === "image/jpeg") return file;
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Image cannot be rendered.");
    context.drawImage(image, 0, 0);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (jpeg === null) throw new Error("Image cannot be converted.");
    return jpeg;
  } finally {
    image.close();
  }
}
