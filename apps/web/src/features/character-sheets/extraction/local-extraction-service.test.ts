import { describe, expect, it } from "vitest";
import { createLocalSheetDocumentExtractionService } from "./local-extraction-service";

describe("local sheet document extraction", () => {
  it("rejects document extraction instead of inventing a draft from the file name", async () => {
    const service = createLocalSheetDocumentExtractionService({ delayMs: 0 });
    await expect(service.extractSheetDocument({
      sessionId: "session.1",
      file: { name: "Kaelen_the_Scout.pdf", mimeType: "application/pdf", size: 256 },
    })).rejects.toThrow(/remote AI service/i);
  });

  it("rejects unsupported files defensively", async () => {
    const service = createLocalSheetDocumentExtractionService({ delayMs: 0 });
    await expect(
      service.extractSheetDocument({
        sessionId: "session.2",
        file: { name: "notes.txt", mimeType: "text/plain", size: 100 },
      }),
    ).rejects.toThrow(/PDF, PNG and JPG/i);
  });

});
