import { extractPdfPages } from "./extractor";
import { testRulebookPdfBase64 } from "../../fixtures/test-rulebook.base64";

function loadFixturePdf(): Uint8Array {
  const base64 = testRulebookPdfBase64;
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/fixture.pdf") {
      const pdfBytes = loadFixturePdf();
      return new Response(pdfBytes.buffer as ArrayBuffer, {
        headers: { "content-type": "application/pdf" },
      });
    }

    if (url.pathname === "/extract") {
      let data: Uint8Array;

      if (request.method === "POST") {
        const arrayBuffer = await request.arrayBuffer();
        data = new Uint8Array(arrayBuffer);
      } else {
        data = loadFixturePdf();
      }

      if (data.byteLength === 0) {
        return Response.json({ error: "Empty PDF payload" }, { status: 400 });
      }

      try {
        const result = await extractPdfPages(data);
        return Response.json({
          pageCount: result.pageCount,
          pages: result.pages.map((page) => ({
            pageNumber: page.pageNumber,
            text: page.text,
            extractionQuality: page.extractionQuality,
            containsExpectedMarker: page.text.includes("PAGE_TEST_"),
          })),
        });
      } catch {
        return Response.json(
          { error: "Failed to extract PDF" },
          { status: 400 },
        );
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
