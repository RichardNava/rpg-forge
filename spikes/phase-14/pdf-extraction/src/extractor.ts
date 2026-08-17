import "pdfjs-dist/build/pdf.worker.mjs";

export interface PageTextRecord {
  readonly pageNumber: number;
  readonly text: string;
  readonly extractionQuality: number;
}

export interface ExtractionResult {
  readonly pageCount: number;
  readonly pages: readonly PageTextRecord[];
}

interface TextContentItem {
  readonly str: string;
  readonly hasEOL: boolean;
}

type PdfJsModule = Pick<
  typeof import("pdfjs-dist"),
  "getDocument" | "VerbosityLevel"
>;

let pdfJsModule: Promise<PdfJsModule> | undefined;

export async function extractPdfPages(
  data: Uint8Array,
): Promise<ExtractionResult> {
  if (data.byteLength === 0) {
    throw new Error("A PDF payload must not be empty.");
  }

  const { getDocument, VerbosityLevel } = await loadPdfJs();

  // The bundled PDF.js worker exposes its message handler in-process; no canvas is used.
  const loadingTask = getDocument({
    data,
    verbosity: VerbosityLevel.ERRORS,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
  });

  try {
    const document = await loadingTask.promise;
    const pages: PageTextRecord[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });
      const textItems = textContent.items.filter(isTextContentItem);
      const text = rebuildText(textItems);
      const nonBlankItemCount = textItems.filter((item) =>
        item.str.trim(),
      ).length;

      pages.push({
        pageNumber,
        text,
        // This is an extraction signal, not OCR or semantic-fidelity confidence.
        extractionQuality:
          textItems.length === 0 ? 0 : nonBlankItemCount / textItems.length,
      });
    }

    return { pageCount: document.numPages, pages };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

async function loadPdfJs(): Promise<PdfJsModule> {
  ensureDomMatrixForTextExtraction();
  pdfJsModule ??= import("pdfjs-dist");
  return pdfJsModule;
}

function ensureDomMatrixForTextExtraction(): void {
  if ("DOMMatrix" in globalThis) {
    return;
  }

  // PDF.js eagerly constructs a matrix in its unused canvas display module.
  // Text extraction never invokes matrix operations, so this avoids a canvas dependency.
  Object.defineProperty(globalThis, "DOMMatrix", {
    configurable: true,
    value: TextExtractionDOMMatrix,
    writable: true,
  });
}

class TextExtractionDOMMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;

  constructor(values?: readonly number[]) {
    this.a = values?.[0] ?? 1;
    this.b = values?.[1] ?? 0;
    this.c = values?.[2] ?? 0;
    this.d = values?.[3] ?? 1;
    this.e = values?.[4] ?? 0;
    this.f = values?.[5] ?? 0;
  }
}

function isTextContentItem<T>(item: T): item is T & TextContentItem {
  if (typeof item !== "object" || item === null) {
    return false;
  }

  return "str" in item && "hasEOL" in item && typeof item.str === "string";
}

function rebuildText(items: readonly TextContentItem[]): string {
  let text = "";

  for (const item of items) {
    if (!item.str) {
      continue;
    }

    if (text && !text.endsWith("\n") && !text.endsWith(" ")) {
      text += " ";
    }
    text += item.str;
    if (item.hasEOL) {
      text += "\n";
    }
  }

  return text.trim();
}
