import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import worker from "../src/worker";

const extractionResponseSchema = z.object({
  pageCount: z.number().int().positive(),
  pages: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      text: z.string(),
      extractionQuality: z.number().min(0).max(1),
      containsExpectedMarker: z.boolean(),
    }),
  ),
});

describe("PDF.js page-aware extraction in workerd", () => {
  it("returns one text record per original fixture page with page provenance", async () => {
    const startedAt = performance.now();
    const response = await worker.fetch(
      new Request("https://spike.test/extract"),
    );
    const elapsedMilliseconds = performance.now() - startedAt;
    const result = extractionResponseSchema.parse(await response.json());
    const pageSeven = result.pages.find((page) => page.pageNumber === 7);

    expect(response.status).toBe(200);
    expect(result.pageCount).toBe(12);
    expect(result.pages).toHaveLength(12);
    expect(result.pages.every((page) => page.containsExpectedMarker)).toBe(
      true,
    );
    expect(pageSeven?.text).toContain("PAGE_TEST_07");
    expect(
      result.pages
        .filter((page) => page.text.includes("PAGE_TEST_07"))
        .map((page) => page.pageNumber),
    ).toEqual([7]);
    expect(result.pages[1]?.text).toMatch(/Attribute\s+Use\s+Example/);
    expect(result.pages[9]?.text).toContain("daño físico");
    expect(result.pages[10]?.text).toContain("acción");
    expect(elapsedMilliseconds).toBeGreaterThan(0);
  });

  it("handles a one-page textual PDF and a blank valid PDF", async () => {
    const onePagePdf = await createPdf("ONE_PAGE_TEXT");
    const blankPdf = await createPdf();

    const onePageResult = await extractResponse(onePagePdf);
    const blankResult = await extractResponse(blankPdf);

    expect(onePageResult.pageCount).toBe(1);
    expect(onePageResult.pages[0]?.text).toContain("ONE_PAGE_TEXT");
    expect(blankResult.pageCount).toBe(1);
    expect(blankResult.pages[0]?.text).toBe("");
    expect(blankResult.pages[0]?.extractionQuality).toBe(0);
  });

  it("rejects invalid and zero-byte PDF payloads", async () => {
    const invalidResponse = await worker.fetch(
      new Request("https://spike.test/extract", {
        method: "POST",
        body: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    const emptyResponse = await worker.fetch(
      new Request("https://spike.test/extract", {
        method: "POST",
        body: new Uint8Array(),
      }),
    );

    expect(invalidResponse.status).toBe(400);
    expect(emptyResponse.status).toBe(400);
  });

  it("serves the original PDF fixture without using filesystem APIs", async () => {
    const response = await worker.fetch(
      new Request("https://spike.test/fixture.pdf"),
    );
    const document = await PDFDocument.load(await response.arrayBuffer());

    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(document.getPageCount()).toBe(12);
  });
});

async function extractResponse(pdf: Uint8Array) {
  const response = await worker.fetch(
    new Request("https://spike.test/extract", {
      method: "POST",
      body: copyToArrayBuffer(pdf),
    }),
  );

  expect(response.status).toBe(200);
  return extractionResponseSchema.parse(await response.json());
}

async function createPdf(text?: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage();

  if (text) {
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 72, y: 700, font, size: 14 });
  }

  return document.save({ useObjectStreams: false });
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
