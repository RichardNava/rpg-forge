import { describe, expect, it, vi } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import type { SheetApiClientV2Port } from "../api/sheet-api-client-v2";
import { SheetApiError } from "../api/sheet-api-errors";
import { createSheetStoreV2 } from "./sheet-store-v2";

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";
const DRAFT_ID = "draft.abc123";

function makeDraftV2(
  overrides: Partial<CharacterSheetDraftV2> = {},
): CharacterSheetDraftV2 {
  return {
    schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
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
    sections: [],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "field", key: "strength", parentKey: null },
      { kind: "field", key: "veteran", parentKey: null },
    ],
    values: { character_name: "Aria Stone", strength: 12 },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

function makeApiClient(
  overrides: Partial<SheetApiClientV2Port> = {},
): SheetApiClientV2Port {
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
    getDraft: vi.fn(async () => makeDraftV2()),
    mutateDraft: vi.fn(async () => makeDraftV2({ version: 4 })),
    rerollDraft: vi.fn(async () => ({
      draft: makeDraftV2({ version: 4 }),
      rerolledKeys: ["strength"],
    })),
    confirmDraft: vi.fn(async () =>
      makeDraftV2({ version: 4, confirmed: true }),
    ),
    ...overrides,
  };
}

async function readyStore(
  overrides: Partial<SheetApiClientV2Port> = {},
  draft: CharacterSheetDraftV2 = makeDraftV2(),
) {
  const api = makeApiClient({
    getDraft: vi.fn(async () => draft),
    ...overrides,
  });
  const store = createSheetStoreV2({ api });
  store.attachSession(SESSION_ID, "token.123");
  await store.hydrate(DRAFT_ID);
  return { api, store };
}

describe("createSheetStoreV2", () => {
  it("A. hydrate stores the canonical V2 draft", async () => {
    const { store } = await readyStore();
    const state = store.getState();
    expect(state.phase).toBe("ready");
    expect(state.draft?.schemaVersion).toBe("2");
    expect(state.draft?.version).toBe(3);
  });

  it("B. create stores the authoritative V2 response", async () => {
    const api = makeApiClient();
    const store = createSheetStoreV2({ api });
    store.attachSession(SESSION_ID, "token.123");
    await store.createDraft(makeDraftV2({ version: 1 }));
    expect(store.getState().draft?.version).toBe(1);
    expect(store.getState().savedVersion).toBe(1);
  });

  it("C/D. mutation captures the pre-mutation version as expectedVersion", async () => {
    let seen: unknown;
    const mutateDraft = vi.fn(
      async (_s: string, _t: string, _d: string, request: unknown) => {
        seen = request;
        return makeDraftV2({ version: 4 });
      },
    );
    const { store } = await readyStore({ mutateDraft });
    await store.applyMutation({
      op: "set_value",
      key: "character_name",
      value: "Mara",
    });
    expect(mutateDraft).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({
      expectedVersion: 3,
      mutation: { op: "set_value", key: "character_name", value: "Mara" },
    });
  });

  it("E. optimistic mutation previews through applyDraftMutationV2", async () => {
    let resolveMutate!: (draft: CharacterSheetDraftV2) => void;
    const mutateDraft = vi.fn(
      () =>
        new Promise<CharacterSheetDraftV2>((resolve) => {
          resolveMutate = resolve;
        }),
    );
    const { store } = await readyStore({ mutateDraft });
    const outcome = store.applyMutation({
      op: "set_value",
      key: "character_name",
      value: "Mara",
    });
    // The optimistic preview applies synchronously before the request resolves.
    expect(store.getState().draft?.values["character_name"]).toBe("Mara");
    expect(store.getState().saveStatus).toBe("saving");
    resolveMutate(makeDraftV2({ version: 4 }));
    await outcome;
  });

  it("F. no extra version bump beyond the domain result", async () => {
    const { store } = await readyStore();
    const outcome = await store.applyMutation({
      op: "set_value",
      key: "character_name",
      value: "Mara",
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.draft.version).toBe(4);
    expect(store.getState().draft?.version).toBe(4);
  });

  it("G. semantic no-op does not invent a version", async () => {
    const mutateDraft = vi.fn(async () => makeDraftV2({ version: 3 }));
    const { store } = await readyStore({ mutateDraft });
    // Setting the value it already holds is a domain no-op.
    const outcome = await store.applyMutation({
      op: "set_value",
      key: "character_name",
      value: "Aria Stone",
    });
    expect(outcome.kind).toBe("ok");
    expect(store.getState().draft?.version).toBe(3);
  });

  it("H. the server response replaces optimistic state", async () => {
    const server = makeDraftV2({ version: 4, characterName: "Server Mara" });
    const { store } = await readyStore({
      mutateDraft: vi.fn(async () => server),
    });
    await store.applyMutation({
      op: "set_value",
      key: "character_name",
      value: "Mara",
    });
    expect(store.getState().draft?.characterName).toBe("Server Mara");
    expect(store.getState().savedVersion).toBe(4);
  });

  it("I. version conflict triggers a reconcile GET", async () => {
    const reconciled = makeDraftV2({ version: 5 });
    const getDraft = vi.fn(async () => reconciled);
    const mutateDraft = vi.fn(async () => {
      throw new SheetApiError("SHEET_DRAFT_VERSION_CONFLICT", "Stale.", 409);
    });
    const { store } = await readyStore({ getDraft, mutateDraft });
    const outcome = await store.applyMutation({
      op: "set_value",
      key: "character_name",
      value: "Mara",
    });
    expect(outcome.kind).toBe("error");
    expect(getDraft).toHaveBeenCalled();
    expect(store.getState().draft?.version).toBe(5);
  });

  it("J. reroll sends the current expectedVersion", async () => {
    let seen: unknown;
    const rerollDraft = vi.fn(
      async (_s: string, _t: string, _d: string, request: unknown) => {
        seen = request;
        return {
          draft: makeDraftV2({ version: 4 }),
          rerolledKeys: ["strength"],
        };
      },
    );
    const { store } = await readyStore({ rerollDraft });
    await store.reroll("seed-1");
    expect(seen).toEqual({
      expectedVersion: 3,
      seed: "seed-1",
    });
  });

  it("K. zero-key reroll accepts the authoritative N+1", async () => {
    const { store } = await readyStore({
      rerollDraft: vi.fn(async () => ({
        draft: makeDraftV2({ version: 4 }),
        rerolledKeys: [],
      })),
    });
    const outcome = await store.reroll("seed-1");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.draft.version).toBe(4);
    expect(outcome.rerolledKeys).toEqual([]);
  });

  it("L. confirm sends the current expectedVersion", async () => {
    let seen: unknown;
    const confirmDraft = vi.fn(
      async (_s: string, _t: string, _d: string, request: unknown) => {
        seen = request;
        return makeDraftV2({ version: 4, confirmed: true });
      },
    );
    const { store } = await readyStore({ confirmDraft });
    await store.confirm();
    expect(seen).toEqual({ expectedVersion: 3 });
  });

  it("M. confirm uses the raw V2 response", async () => {
    const confirmed = makeDraftV2({ version: 4, confirmed: true });
    const { store } = await readyStore({
      confirmDraft: vi.fn(async () => confirmed),
    });
    const outcome = await store.confirm();
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.draft.confirmed).toBe(true);
  });

  it("N. the confirmed snapshot becomes read-only in state", async () => {
    const { store } = await readyStore({
      confirmDraft: vi.fn(async () =>
        makeDraftV2({ version: 4, confirmed: true }),
      ),
    });
    await store.confirm();
    expect(store.getState().draft?.confirmed).toBe(true);
  });

  it("O. the session token lives in memory-only store state", async () => {
    const api = makeApiClient();
    const store = createSheetStoreV2({ api });
    await store.startSession("turnstile-1");
    expect(store.getState().sessionId).toBe(SESSION_ID);
    expect(store.getState().accessToken).toBe("token.123");
  });

  it("P. reset clears V2 state", async () => {
    const { store } = await readyStore();
    store.reset();
    const state = store.getState();
    expect(state.phase).toBe("empty");
    expect(state.draft).toBeNull();
    expect(state.sessionId).toBeNull();
    expect(state.accessToken).toBeNull();
  });
});

describe("createSheetStoreV2 spatial layout mutations (14.8)", () => {
  function makeLayoutDraft(
    overrides: Partial<CharacterSheetDraftV2> = {},
  ): CharacterSheetDraftV2 {
    return makeDraftV2({
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: {},
        nodes: {
          character_name: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
          strength: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
          veteran: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
        },
      },
      ...overrides,
    });
  }

  it("Q. optimistic set_container_layout previews before commit", async () => {
    let resolveMutate!: (draft: CharacterSheetDraftV2) => void;
    const mutateDraft = vi.fn(
      () =>
        new Promise<CharacterSheetDraftV2>((resolve) => {
          resolveMutate = resolve;
        }),
    );
    const { store } = await readyStore({ mutateDraft }, makeLayoutDraft());
    const outcome = store.applyMutation({
      op: "set_container_layout",
      containerKey: null,
      columns: 3,
    });
    expect(store.getState().draft?.layout?.root.columns).toBe(3);
    expect(store.getState().saveStatus).toBe("saving");
    resolveMutate(makeLayoutDraft({ version: 4, layout: undefined }));
    await outcome;
    expect(store.getState().draft?.version).toBe(4);
  });

  it("R. optimistic set_node_layout previews geometry before commit", async () => {
    let resolveMutate!: (draft: CharacterSheetDraftV2) => void;
    const mutateDraft = vi.fn(
      () =>
        new Promise<CharacterSheetDraftV2>((resolve) => {
          resolveMutate = resolve;
        }),
    );
    const { store } = await readyStore({ mutateDraft }, makeLayoutDraft());
    const outcome = store.applyMutation({
      op: "set_node_layout",
      key: "strength",
      placement: {
        columnStart: 2,
        columnSpan: 1,
        rowSpan: 2,
        breakBefore: true,
      },
    });
    expect(store.getState().draft?.layout?.nodes["strength"]).toEqual({
      columnStart: 2,
      columnSpan: 1,
      rowSpan: 2,
      breakBefore: true,
    });
    resolveMutate(makeLayoutDraft({ version: 4 }));
    await outcome;
  });

  it("S. spatial semantic no-op keeps the local version", async () => {
    const mutateDraft = vi.fn(async () => makeLayoutDraft());
    const { store } = await readyStore({ mutateDraft }, makeLayoutDraft());
    const outcome = await store.applyMutation({
      op: "set_container_layout",
      containerKey: null,
      columns: 2,
    });
    expect(outcome.kind).toBe("ok");
    expect(store.getState().draft?.version).toBe(3);
  });

  it("T. server rejection surfaces as a rejected outcome", async () => {
    const { store } = await readyStore(undefined, makeLayoutDraft());
    const outcome = await store.applyMutation({
      op: "set_node_layout",
      key: "ghost",
      placement: {
        columnStart: 1,
        columnSpan: 1,
        rowSpan: 1,
        breakBefore: false,
      },
    });
    expect(outcome.kind).toBe("rejected");
  });

  it("U. confirmed draft rejects spatial mutations", async () => {
    const { store } = await readyStore(
      undefined,
      makeLayoutDraft({ confirmed: true }),
    );
    const outcome = await store.applyMutation({
      op: "set_container_layout",
      containerKey: null,
      columns: 3,
    });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.code).toBe("draft_confirmed");
  });

  it("V. layoutless draft materializes defaults through the normal path", async () => {
    let seen: unknown;
    const mutateDraft = vi.fn(
      async (_s: string, _t: string, _d: string, request: unknown) => {
        seen = request;
        return makeDraftV2({ version: 4 });
      },
    );
    const { store } = await readyStore({ mutateDraft });
    const outcome = await store.applyMutation({
      op: "set_node_layout",
      key: "strength",
      placement: {
        columnStart: 1,
        columnSpan: 1,
        rowSpan: 2,
        breakBefore: false,
      },
    });
    expect(outcome.kind).toBe("ok");
    expect(seen).toEqual({
      expectedVersion: 3,
      mutation: {
        op: "set_node_layout",
        key: "strength",
        placement: {
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 2,
          breakBefore: false,
        },
      },
    });
  });
});
