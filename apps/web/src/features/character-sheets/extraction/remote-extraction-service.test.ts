import { describe, expect, it, vi } from "vitest";
import { createRemoteSheetDocumentExtractionService } from "./remote-extraction-service";

const DRAFT = {
  schemaVersion: "1",
  draftId: "draft.abc",
  sessionId: "session.123",
  baseVersion: 1,
  version: 1,
  mode: "pc",
  characterName: "Nyra",
  rulesContextId: null,
  fields: [{ key: "character_name", label: "Character name", type: "text", locked: false }],
  values: { character_name: "Nyra" },
  source: { sourceSheetId: "nyra", sourceRunId: null },
  confirmed: false,
};

describe("remote sheet document extraction", () => {
  it("sends the original file as authenticated multipart data and validates the draft", async () => {
    const fetchImpl = vi.fn(async () => Response.json(DRAFT));
    const service = createRemoteSheetDocumentExtractionService({
      baseUrl: "/api/character-sheets",
      fetchImpl,
    });
    const blob = new Blob(["sheet"], { type: "application/pdf" });

    const draft = await service.extractSheetDocument({
      sessionId: "session.123",
      accessToken: "token.123",
      file: { name: "nyra.pdf", mimeType: "application/pdf", size: blob.size, blob },
    });

    expect(draft.characterName).toBe("Nyra");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl.mock.calls as unknown as [
      string,
      RequestInit,
    ][])[0]!;
    expect(url).toBe("/api/character-sheets/sessions/session.123/extraction");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token.123");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("rejects descriptor-only input and malformed worker payloads", async () => {
    const service = createRemoteSheetDocumentExtractionService({
      fetchImpl: vi.fn(async () => Response.json({ unexpected: true })),
    });
    await expect(
      service.extractSheetDocument({
        sessionId: "session.123",
        accessToken: "token.123",
        file: { name: "nyra.pdf", mimeType: "application/pdf", size: 1 },
      }),
    ).rejects.toThrow("cannot be sent");
  });
});
