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

    expect(named.values["character_name"]).toBe("Mara");
    expect(named.characterName).toBe("Mara");
    expect(named.version).toBe(2);
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
