import { describe, expect, it, vi } from "vitest";
import { CHARACTER_SHEET_DRAFT_V2_VERSION } from "@repo/character-sheet-draft";
import { createRemoteSheetDocumentExtractionServiceV2 } from "./remote-extraction-service-v2";

const DRAFT_V2 = {
  schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
  draftId: "draft.abc",
  sessionId: "session.123",
  baseVersion: 1,
  version: 1,
  mode: "pc",
  characterName: "Nyra",
  rulesContextId: null,
  fields: [
    {
      key: "character_name",
      label: "Character name",
      type: "text",
      locked: false,
    },
  ],
  sections: [],
  structure: [{ kind: "field", key: "character_name", parentKey: null }],
  values: { character_name: "Nyra" },
  source: { sourceSheetId: "nyra", sourceRunId: null },
  confirmed: false,
};

describe("remote sheet document extraction V2", () => {
  it("sends the original file as authenticated multipart data and validates V2", async () => {
    const fetchImpl = vi.fn(async () => Response.json(DRAFT_V2));
    const service = createRemoteSheetDocumentExtractionServiceV2({
      baseUrl: "/api/character-sheets",
      fetchImpl,
    });
    // image/jpeg passes through without canvas rendering in tests.
    const blob = new Blob(["sheet"], { type: "image/jpeg" });

    const draft = await service.extractSheetDocument({
      sessionId: "session.123",
      accessToken: "token.123",
      file: { name: "nyra.jpg", mimeType: "image/jpeg", size: blob.size, blob },
    });

    expect(draft.schemaVersion).toBe("2");
    expect(draft.characterName).toBe("Nyra");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (
      fetchImpl.mock.calls as unknown as [string, RequestInit][]
    )[0]!;
    expect(url).toBe("/api/character-sheets/sessions/session.123/extraction");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer token.123",
    );
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("rejects a V1 payload instead of letting it enter the V2 store", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ...DRAFT_V2, schemaVersion: "1" }),
    );
    const service = createRemoteSheetDocumentExtractionServiceV2({
      fetchImpl,
    });
    const blob = new Blob(["sheet"], { type: "image/jpeg" });

    await expect(
      service.extractSheetDocument({
        sessionId: "session.123",
        accessToken: "token.123",
        file: {
          name: "nyra.jpg",
          mimeType: "image/jpeg",
          size: blob.size,
          blob,
        },
      }),
    ).rejects.toThrow("invalid character sheet");
  });

  it("rejects descriptor-only input and malformed worker payloads", async () => {
    const service = createRemoteSheetDocumentExtractionServiceV2({
      fetchImpl: vi.fn(async () => Response.json({ unexpected: true })),
    });
    await expect(
      service.extractSheetDocument({
        sessionId: "session.123",
        accessToken: "token.123",
        file: { name: "nyra.jpg", mimeType: "image/jpeg", size: 1 },
      }),
    ).rejects.toThrow("cannot be sent");
  });
});
