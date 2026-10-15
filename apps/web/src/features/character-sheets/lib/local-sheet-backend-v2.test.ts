import { describe, expect, it } from "vitest";
import { DraftError } from "@repo/character-sheet-draft";
import { createBlankDraftV2, createExampleDraftV2 } from "./dev-fixture-v2";
import { createLocalSheetBackendV2 } from "./local-sheet-backend-v2";

describe("createLocalSheetBackendV2", () => {
  it("creates and reads back a session", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    expect(session.sessionId.length).toBeGreaterThan(0);

    const view = await api.getSession(session.sessionId, session.accessToken);
    expect(view.status).toBe("ACTIVE");
  });

  it("creates a canonical V2 draft at version 1 with baseVersion 1", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    const created = await api.createDraft(
      session.sessionId,
      session.accessToken,
      createBlankDraftV2(session.sessionId),
    );

    expect(created.schemaVersion).toBe("2");
    expect(created.version).toBe(1);
    expect(created.baseVersion).toBe(1);
    expect(created.structure).toHaveLength(1);
  });

  it("rejects duplicates and enforces the version 1 create policy", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    const draft = createBlankDraftV2(session.sessionId);
    await api.createDraft(session.sessionId, session.accessToken, draft);

    await expect(
      api.createDraft(session.sessionId, session.accessToken, draft),
    ).rejects.toThrowError(DraftError);
    await expect(
      api.createDraft(session.sessionId, session.accessToken, {
        ...draft,
        draftId: "draft.other",
        version: 2,
      }),
    ).rejects.toThrowError(DraftError);
  });

  it("applies real V2 domain mutations without an extra bump", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    const created = await api.createDraft(
      session.sessionId,
      session.accessToken,
      createBlankDraftV2(session.sessionId),
    );

    const named = await api.mutateDraft(
      session.sessionId,
      session.accessToken,
      created.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "character_name", value: "Mara" },
      },
    );

    expect(named.draft.values["character_name"]).toBe("Mara");
    expect(named.draft.characterName).toBe("Mara");
    expect(named.draft.version).toBe(2);
  });

  it("reroll checks expectedVersion first and persists N+1", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    const created = await api.createDraft(
      session.sessionId,
      session.accessToken,
      createExampleDraftV2(session.sessionId),
    );

    await expect(
      api.rerollDraft(session.sessionId, session.accessToken, created.draftId, {
        expectedVersion: 99,
        seed: "seed-1",
      }),
    ).rejects.toThrowError(DraftError);

    const result = await api.rerollDraft(
      session.sessionId,
      session.accessToken,
      created.draftId,
      { expectedVersion: 1, seed: "seed-1" },
    );
    expect(result.draft.version).toBe(2);
  });

  it("confirm checks expectedVersion first and finalizes without an extra bump", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    const created = await api.createDraft(
      session.sessionId,
      session.accessToken,
      createBlankDraftV2(session.sessionId),
    );

    await expect(
      api.confirmDraft(
        session.sessionId,
        session.accessToken,
        created.draftId,
        {
          expectedVersion: 99,
        },
      ),
    ).rejects.toThrowError(DraftError);

    const confirmed = await api.confirmDraft(
      session.sessionId,
      session.accessToken,
      created.draftId,
      { expectedVersion: 1 },
    );
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.version).toBe(2);
  });

  it("stores an uploaded portrait and round-trips its bytes", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
      0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
      0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08,
      0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xfb, 0x03,
      0x0c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const ref = await api.uploadPortrait(
      session.sessionId,
      session.accessToken,
      new File([png.buffer as ArrayBuffer], "art.png", { type: "image/png" }),
    );
    expect(ref.source).toBe("upload");
    const downloaded = await api.downloadPortrait(
      session.sessionId,
      session.accessToken,
      ref.assetId,
    );
    expect([...downloaded.bytes]).toEqual([...png]);
    expect(downloaded.mimeType).toBe("image/png");
  });

  it("rejects non-image uploads and fails URL/AI closed in local mode", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");
    await expect(
      api.uploadPortrait(
        session.sessionId,
        session.accessToken,
        new File([new Uint8Array([1, 2, 3]).buffer as ArrayBuffer], "a.bin", {
          type: "application/octet-stream",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      api.importPortraitUrl(session.sessionId, session.accessToken, "https://example.com/a.png"),
    ).rejects.toThrow();
    await expect(
      api.generatePortrait(session.sessionId, session.accessToken, "a ranger"),
    ).rejects.toThrow();
  });

  it("rejects a session-mismatched draft as invalid", async () => {
    const api = createLocalSheetBackendV2();
    const session = await api.createSession("token");

    await expect(
      api.createDraft(session.sessionId, session.accessToken, {
        ...createBlankDraftV2("some-other-session"),
      }),
    ).rejects.toThrowError(DraftError);
  });
});
