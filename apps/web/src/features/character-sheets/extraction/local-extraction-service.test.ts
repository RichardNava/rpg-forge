import { describe, expect, it } from "vitest";
import { createLocalSheetDocumentExtractionService } from "./local-extraction-service";

describe("local sheet document extraction", () => {
  it("derives a valid draft surface from an uploaded PDF", async () => {
    const service = createLocalSheetDocumentExtractionService({ delayMs: 0 });
    const draft = await service.extractSheetDocument({
      sessionId: "session.123",
      file: { name: "Kaelen_the_Scout.pdf", mimeType: "application/pdf", size: 2048 },
    });

    expect(draft.schemaVersion).toBe("1");
    expect(draft.sessionId).toBe("session.123");
    expect(draft.confirmed).toBe(false);
    expect(draft.characterName).toBe("Kaelen_the_Scout");
    expect(draft.values["character_name"]).toBe("Kaelen_the_Scout");
    expect(draft.fields.some((field) => field.key === "character_name")).toBe(
      true,
    );
    expect(draft.fields.some((field) => field.key === "description")).toBe(
      true,
    );
    expect(draft.source.sourceSheetId).toBe("kaelen_the_scout");
  });

  it("falls back to a stable name for extension-less or blank files", async () => {
    const service = createLocalSheetDocumentExtractionService({ delayMs: 0 });
    const draft = await service.extractSheetDocument({
      sessionId: "session.1",
      file: { name: ".pdf", mimeType: "application/pdf", size: 256 },
    });

    expect(draft.characterName).toBe("Extracted character");
    expect(draft.source.sourceSheetId).toBe("extracted");
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

  it("respects the simulated extraction delay", async () => {
    const service = createLocalSheetDocumentExtractionService({ delayMs: 25 });
    const started = Date.now();
    await service.extractSheetDocument({
      sessionId: "session.3",
      file: { name: "hero.png", mimeType: "image/png", size: 512 },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });
});