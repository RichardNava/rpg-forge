import { describe, expect, it, vi } from "vitest";
import { type CharacterSheetDraft } from "@repo/character-sheet-draft";
import type { SheetApiClientPort } from "../api/sheet-api-client";
import { SheetApiError } from "../api/sheet-api-errors";
import { createSheetStore } from "./sheet-store";

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";
const DRAFT_ID = "draft.abc123";

function makeDraft(
  overrides: Partial<CharacterSheetDraft> = {},
): CharacterSheetDraft {
  return {
    schemaVersion: "1",
    draftId: DRAFT_ID,
    sessionId: SESSION_ID,
    baseVersion: 1,
    version: 3,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Character Name",
        type: "text",
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: true,
      },
      { key: "veteran", label: "Veteran", type: "checkbox", locked: false },
    ],
    values: { character_name: "Aria Stone", strength: 12 },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

function makeApiClient(
  overrides: Partial<SheetApiClientPort> = {},
): SheetApiClientPort {
  return {
    createSession: vi.fn(async () => ({
      sessionId: SESSION_ID,
      accessToken: "token.123",
      expiresAt: "2026-09-07T12:00:00.000Z",
    })),
    getSession: vi.fn(async () => ({
      sessionId: SESSION_ID,
      status: "ACTIVE" as const,
      expiresAt: "2026-09-07T12:00:00.000Z",
    })),
    createDraft: vi.fn(async (_s, _t, draft) => draft),
    getDraft: vi.fn(async () => makeDraft()),
    mutateDraft: vi.fn(async (_s, _t, _d, mutation) => {
      const draft = makeDraft();
      if (mutation.op === "set_value") {
        return {
          ...draft,
          values: { ...draft.values, [mutation.key]: mutation.value },
        };
      }
      if (mutation.op === "add_field") {
        return {
          ...draft,
          fields: [...draft.fields, mutation.field],
        };
      }
      if (mutation.op === "remove_field") {
        return {
          ...draft,
          fields: draft.fields.filter((field) => field.key !== mutation.key),
          values: Object.fromEntries(
            Object.entries(draft.values).filter(
              ([key]) => key !== mutation.key,
            ),
          ),
        };
      }
      return draft;
    }),
    rerollDraft: vi.fn(async () => ({
      draft: makeDraft({ version: 4 }),
      rerolledKeys: ["strength"],
    })),
    confirmDraft: vi.fn(async () => makeDraft({ version: 4, confirmed: true })),
    ...overrides,
  };
}

describe("createSheetStore", () => {
  it("starts in the empty phase", () => {
    const store = createSheetStore({ api: makeApiClient() });
    expect(store.getState().phase).toBe("empty");
    expect(store.getState().draft).toBeNull();
  });

  it("creates a session and transitions to ready", async () => {
    const api = makeApiClient();
    const store = createSheetStore({ api });
    await store.startSession("turnstile-1");
    const state = store.getState();
    expect(state.phase).toBe("ready");
    expect(state.sessionId).toBe(SESSION_ID);
    expect(state.accessToken).toBe("token.123");
  });

  it("hydrates a draft and restores its state", async () => {
    const confirmedDraft = makeDraft({ confirmed: true, version: 9 });
    const api = makeApiClient({
      getDraft: vi.fn(async () => confirmedDraft),
    });
    const store = createSheetStore({ api });
    store.attachSession(SESSION_ID, "token.123");
    await store.hydrate(DRAFT_ID);
    const state = store.getState();
    expect(state.phase).toBe("ready");
    expect(state.draft?.confirmed).toBe(true);
    expect(state.savedVersion).toBe(9);
  });

  it("applies a mutation and commits the server snapshot", async () => {
    const committed = makeDraft({
      version: 4,
      values: { character_name: "Aria Stone", strength: 15 },
    });
    const api = makeApiClient({
      mutateDraft: vi.fn(async () => committed),
    });
    const store = createSheetStore({ api });
    store.attachSession(SESSION_ID, "token.123");
    await store.hydrate(DRAFT_ID);

    const outcome = await store.applyMutation({
      op: "set_value",
      key: "character_name",
      value: "Briar Vale",
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.draft.version).toBe(4);
    }
    expect(store.getState().saveStatus).toBe("saved");
  });

  it("adds and removes fields via applyMutation", async () => {
    const api = makeApiClient();
    const store = createSheetStore({ api });
    store.attachSession(SESSION_ID, "token.123");
    await store.hydrate(DRAFT_ID);

    const addResult = await store.applyMutation({
      op: "add_field",
      field: {
        key: "dexterity",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
    });
    expect(addResult.kind).toBe("ok");
    if (addResult.kind === "ok") {
      expect(
        addResult.draft.fields.some((field) => field.key === "dexterity"),
      ).toBe(true);
    }

    const removeResult = await store.applyMutation({
      op: "remove_field",
      key: "veteran",
    });
    expect(removeResult.kind).toBe("ok");
    if (removeResult.kind === "ok") {
      expect(
        removeResult.draft.fields.some((field) => field.key === "veteran"),
      ).toBe(false);
    }
  });

  it("rerolls locked values and records the drawn keys", async () => {
    const rerolledDraft = makeDraft({
      version: 4,
      values: { character_name: "Aria Stone", strength: 19 },
    });
    const api = makeApiClient({
      rerollDraft: vi.fn(async () => ({
        draft: rerolledDraft,
        rerolledKeys: ["strength"],
      })),
    });
    const store = createSheetStore({ api });
    store.attachSession(SESSION_ID, "token.123");
    await store.hydrate(DRAFT_ID);

    const outcome = await store.reroll("seed-1");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.rerolledKeys).toEqual(["strength"]);
    }
    expect(store.getState().rerolledKeys).toEqual(["strength"]);
  });

  it("confirms a draft and transitions to read-only", async () => {
    const confirmed = makeDraft({ version: 4, confirmed: true });
    const api = makeApiClient({
      confirmDraft: vi.fn(async () => confirmed),
    });
    const store = createSheetStore({ api });
    store.attachSession(SESSION_ID, "token.123");
    await store.hydrate(DRAFT_ID);

    const outcome = await store.confirm();
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.draft.confirmed).toBe(true);
    }
    const state = store.getState();
    expect(state.draft?.confirmed).toBe(true);
    expect(state.savedVersion).toBe(4);
  });

  it("rejects confirm when no draft is loaded", async () => {
    const store = createSheetStore({ api: makeApiClient() });
    store.attachSession(SESSION_ID, "token.123");
    const outcome = await store.confirm();
    expect(outcome.kind).toBe("not_ready");
  });

  it("returns an error outcome when confirm fails upstream", async () => {
    const api = makeApiClient({
      confirmDraft: vi.fn(async () => {
        throw new SheetApiError(
          "SHEET_DRAFT_CONFIRMED",
          "The draft is already confirmed.",
          409,
        );
      }),
    });
    const store = createSheetStore({ api });
    store.attachSession(SESSION_ID, "token.123");
    await store.hydrate(DRAFT_ID);

    const outcome = await store.confirm();
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.error.code).toBe("SHEET_DRAFT_CONFIRMED");
      expect(outcome.error.status).toBe(409);
    }
    expect(store.getState().error?.code).toBe("SHEET_DRAFT_CONFIRMED");
  });

  it("resets to the initial state", async () => {
    const store = createSheetStore({ api: makeApiClient() });
    store.attachSession(SESSION_ID, "token.123");
    await store.hydrate(DRAFT_ID);
    expect(store.getState().phase).toBe("ready");

    store.reset();
    const state = store.getState();
    expect(state.phase).toBe("empty");
    expect(state.draft).toBeNull();
    expect(state.sessionId).toBeNull();
  });
});
