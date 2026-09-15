import { describe, expect, it } from "vitest";
import type { CharacterSheetDraft } from "@repo/character-sheet-draft";
import { createBlankDraft, createExampleDraft } from "./dev-fixture";
import { createLocalSheetBackend } from "./local-sheet-backend";

function makeLockedDraft(sessionId: string): CharacterSheetDraft {
  return {
    schemaVersion: "1",
    draftId: "draft.locked",
    sessionId,
    baseVersion: 1,
    version: 1,
    mode: "npc",
    characterName: "Sentinel",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Character name",
        type: "text",
        locked: false,
      },
      {
        key: "vigor",
        label: "Vigor",
        type: "number",
        locked: true,
        min: 1,
        max: 6,
      },
    ],
    values: { character_name: "Sentinel", vigor: 3 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

describe("createLocalSheetBackend", () => {
  it("creates and reads back a session", async () => {
    const api = createLocalSheetBackend();
    const session = await api.createSession("token");
    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(session.accessToken.length).toBeGreaterThan(0);

    const view = await api.getSession(session.sessionId, session.accessToken);
    expect(view.sessionId).toBe(session.sessionId);
    expect(view.status).toBe("ACTIVE");

    await expect(
      api.getSession(session.sessionId, "wrong-token"),
    ).rejects.toThrow("Session not found");
  });

  it("applies real domain mutations and bumps versions", async () => {
    const api = createLocalSheetBackend();
    const session = await api.createSession("token");
    const blank = createBlankDraft(session.sessionId);
    const created = await api.createDraft(
      session.sessionId,
      session.accessToken,
      blank,
    );

    expect(created.fields).toHaveLength(1);

    const withField = await api.mutateDraft(
      session.sessionId,
      session.accessToken,
      created.draftId,
      {
        op: "add_field",
        field: { key: "age", label: "Age", type: "number", locked: false },
      },
    );
    expect(withField.fields).toHaveLength(2);
    expect(withField.version).toBe(created.version + 1);

    const named = await api.mutateDraft(
      session.sessionId,
      session.accessToken,
      created.draftId,
      { op: "set_value", key: "character_name", value: "Mara" },
    );
    expect(named.values["character_name"]).toBe("Mara");
    expect(named.characterName).toBe("Mara");
  });

  it("rerolls only read-locked fields with a draw grammar", async () => {
    const api = createLocalSheetBackend();
    const session = await api.createSession("token");
    const draft = makeLockedDraft(session.sessionId);
    const created = await api.createDraft(
      session.sessionId,
      session.accessToken,
      draft,
    );

    const result = await api.rerollDraft(
      session.sessionId,
      session.accessToken,
      created.draftId,
      "test-seed",
    );
    expect(result.rerolledKeys).toEqual(["vigor"]);
    expect(result.draft.values["vigor"]).toBeGreaterThanOrEqual(1);
    expect(result.draft.values["vigor"]).toBeLessThanOrEqual(6);
    expect(result.draft.values["character_name"]).toBe("Sentinel");
    expect(result.draft.version).toBe(created.version + 1);
  });

  it("confirms a draft into a read-only immutable snapshot", async () => {
    const api = createLocalSheetBackend();
    const session = await api.createSession("token");
    const created = await api.createDraft(
      session.sessionId,
      session.accessToken,
      createExampleDraft(session.sessionId),
    );

    const confirmed = await api.confirmDraft(
      session.sessionId,
      session.accessToken,
      created.draftId,
    );
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.version).toBe(created.version + 1);

    await expect(
      api.mutateDraft(session.sessionId, session.accessToken, created.draftId, {
        op: "set_value",
        key: "vocation",
        value: "changed",
      }),
    ).rejects.toMatchObject({ code: "draft_confirmed" });
  });

  it("throws when the draft does not exist", async () => {
    const api = createLocalSheetBackend();
    const session = await api.createSession("token");
    await expect(
      api.getDraft(session.sessionId, session.accessToken, "draft.missing"),
    ).rejects.toThrow("Draft not found");
  });
});
