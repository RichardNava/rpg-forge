import type {
  ExtractedPage,
  RulebookBinarySource,
} from "@repo/rulebook-ingestion";
import { testRulebookPdfBase64 } from "../../../../spikes/phase-14/fixtures/test-rulebook.base64.js";
import { describe, expect, it } from "vitest";
import { createPdfJsPageExtractor } from "./pdfjs-extractor.js";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const RULEBOOK_BYTES = base64ToBytes(testRulebookPdfBase64);

function memorySource(bytes: Uint8Array): RulebookBinarySource {
  return {
    sizeBytes: bytes.byteLength,
    async readRange(offset: number, length: number): Promise<Uint8Array> {
      return bytes
        .subarray(offset, Math.min(offset + length, bytes.byteLength))
        .slice();
    },
  };
}

describe("pdfjs page extractor (workerd)", () => {
  it("installs a DOMMatrix shim and extracts 12 pages (1-based) from the fixture", async () => {
    const extractor = createPdfJsPageExtractor();
    const outcome = await extractor.extract({
      source: memorySource(RULEBOOK_BYTES),
      maxPages: 500,
    });
    expect(outcome.kind).toBe("extracted");
    if (outcome.kind !== "extracted") {
      return;
    }
    expect(outcome.pageCount).toBe(12);
    const pageNumbers = outcome.pages.map((p: ExtractedPage) => p.pageNumber);
    expect(pageNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const page of outcome.pages) {
      expect(page.text.length).toBeGreaterThan(0);
    }
  });

  it("returns invalid_pdf for empty input", async () => {
    const extractor = createPdfJsPageExtractor();
    const outcome = await extractor.extract({
      source: memorySource(new Uint8Array(0)),
      maxPages: 500,
    });
    expect(outcome.kind).toBe("invalid_pdf");
  });

  it("returns invalid_pdf for bytes that are not a PDF", async () => {
    const extractor = createPdfJsPageExtractor();
    const outcome = await extractor.extract({
      source: memorySource(new TextEncoder().encode("this is not a pdf")),
      maxPages: 500,
    });
    expect(outcome.kind).toBe("invalid_pdf");
  });

  it("reports too_many_pages with the real page count when maxPages is exceeded", async () => {
    const extractor = createPdfJsPageExtractor();
    const outcome = await extractor.extract({
      source: memorySource(RULEBOOK_BYTES),
      maxPages: 5,
    });
    expect(outcome.kind).toBe("too_many_pages");
    if (outcome.kind === "too_many_pages") {
      expect(outcome.pageCount).toBe(12);
    }
  });
});
