import "pdfjs-dist/build/pdf.worker.mjs";

import type {
  PdfExtractionOutcome,
  PdfPageExtractorPort,
  RulebookBinarySource,
} from "@repo/rulebook-ingestion";

const RANGE_CHUNK_BYTES = 64 * 1024;

interface TextContentItem {
  readonly str: string;
  readonly hasEOL: boolean;
}

type PdfJsModule = Pick<
  typeof import("pdfjs-dist"),
  "getDocument" | "PDFDataRangeTransport" | "VerbosityLevel"
>;

let pdfJsModule: Promise<PdfJsModule> | undefined;

/**
 * Page-aware textual extraction only. DOMMatrix must be present before the
 * dynamic display-module import; no canvas rendering API is used.
 */
export function createPdfJsPageExtractor(): PdfPageExtractorPort {
  return {
    async extract(input): Promise<PdfExtractionOutcome> {
      if (input.source.sizeBytes === 0) {
        return { kind: "invalid_pdf" };
      }

      const { getDocument, PDFDataRangeTransport, VerbosityLevel } =
        await loadPdfJs();
      const initialData = await input.source.readRange(
        0,
        Math.min(RANGE_CHUNK_BYTES, input.source.sizeBytes),
      );
      if (initialData.byteLength === 0) {
        return { kind: "invalid_pdf" };
      }

      const transport = createRangeTransport(
        PDFDataRangeTransport,
        input.source,
        initialData,
      );
      const loadingTask = getDocument({
        range: transport,
        rangeChunkSize: RANGE_CHUNK_BYTES,
        verbosity: VerbosityLevel.ERRORS,
        disableRange: false,
        disableStream: true,
        disableAutoFetch: true,
        useSystemFonts: false,
        disableFontFace: true,
        useWasm: false,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false,
      });

      try {
        const document = await loadingTask.promise;
        if (document.numPages > input.maxPages) {
          return { kind: "too_many_pages", pageCount: document.numPages };
        }

        const pages = [];
        for (
          let pageNumber = 1;
          pageNumber <= document.numPages;
          pageNumber += 1
        ) {
          const page = await document.getPage(pageNumber);
          try {
            const textContent = await page.getTextContent({
              includeMarkedContent: false,
              disableNormalization: false,
            });
            pages.push({
              pageNumber,
              text: rebuildText(textContent.items.filter(isTextContentItem)),
            });
          } finally {
            page.cleanup();
          }
        }
        return { kind: "extracted", pageCount: document.numPages, pages };
      } catch {
        const rangeError = transport.getFailure();
        if (rangeError !== undefined) {
          throw rangeError;
        }
        return { kind: "invalid_pdf" };
      } finally {
        await loadingTask.destroy().catch(() => undefined);
      }
    },
  };
}

async function loadPdfJs(): Promise<PdfJsModule> {
  ensureDomMatrixForTextExtraction();
  pdfJsModule ??= import("pdfjs-dist");
  return pdfJsModule;
}

function createRangeTransport(
  BaseRangeTransport: PdfJsModule["PDFDataRangeTransport"],
  source: RulebookBinarySource,
  initialData: Uint8Array,
) {
  class R2RangeTransport extends BaseRangeTransport {
    private aborted = false;
    private failure: unknown;

    constructor() {
      super(source.sizeBytes, initialData, false);
    }

    getFailure(): unknown {
      return this.failure;
    }

    override requestDataRange(begin: number, end: number): void {
      void this.readRange(begin, end);
    }

    override abort(): void {
      this.aborted = true;
      super.abort();
    }

    private async readRange(begin: number, end: number): Promise<void> {
      try {
        const bytes = await source.readRange(begin, end - begin);
        if (!this.aborted) {
          this.onDataRange(begin, bytes);
        }
      } catch (error) {
        this.failure = error;
        this.abort();
      }
    }
  }

  return new R2RangeTransport();
}

function ensureDomMatrixForTextExtraction(): void {
  if ("DOMMatrix" in globalThis) {
    return;
  }

  Object.defineProperty(globalThis, "DOMMatrix", {
    configurable: true,
    value: TextExtractionDomMatrix,
    writable: true,
  });
}

class TextExtractionDomMatrix {
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
    if (item.str.length === 0) {
      continue;
    }
    if (text.length > 0 && !text.endsWith("\n") && !text.endsWith(" ")) {
      text += " ";
    }
    text += item.str;
    if (item.hasEOL) {
      text += "\n";
    }
  }
  return text;
}
