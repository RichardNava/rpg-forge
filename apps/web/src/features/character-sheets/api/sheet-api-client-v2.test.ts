import { describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { SheetApiClientV2 } from "./sheet-api-client-v2";
import type { SheetFetch } from "./sheet-api-client";
import { SheetApiError } from "./sheet-api-errors";

const SESSION_URL = "/api/character-sheets";
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
    ],
    sections: [],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "field", key: "strength", parentKey: null },
    ],
    values: { character_name: "Aria Stone", strength: 12 },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function jsonErrorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(status, { error: { code, message } });
}

function makeClient(
  responder: (input: string | URL, init?: RequestInit) => Promise<Response>,
): { client: SheetApiClientV2; fetchImpl: MockedFunction<SheetFetch> } {
  const fetchImpl = vi.fn<SheetFetch>();
  fetchImpl.mockImplementation(responder);
  return { client: new SheetApiClientV2({ fetchImpl }), fetchImpl };
}

describe("SheetApiClientV2", () => {
  it("A. create sends the raw canonical V2 snapshot", async () => {
    const draft = makeDraftV2({ version: 1 });
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts`,
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(draft);
      return jsonResponse(201, draft);
    });

    await client.createDraft(SESSION_ID, "token.123", draft);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("B. create parses the raw V2 snapshot response", async () => {
    const draft = makeDraftV2({ version: 1 });
    const { client } = makeClient(async () => jsonResponse(201, draft));

    const created = await client.createDraft(SESSION_ID, "token.123", draft);
    expect(created.version).toBe(1);
    expect(created.schemaVersion).toBe("2");
  });

  it("C. get parses the raw canonical V2 snapshot", async () => {
    const draft = makeDraftV2();
    const { client } = makeClient(async (input) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts/${DRAFT_ID}`,
      );
      return jsonResponse(200, draft);
    });

    const read = await client.getDraft(SESSION_ID, "token.123", DRAFT_ID);
    expect(read.version).toBe(3);
  });

  it("D. historical GET keeps the version query parameter", async () => {
    const draft = makeDraftV2({ version: 2 });
    const { client } = makeClient(async (input) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts/${DRAFT_ID}?version=2`,
      );
      return jsonResponse(200, draft);
    });

    const read = await client.getDraft(SESSION_ID, "token.123", DRAFT_ID, 2);
    expect(read.version).toBe(2);
  });

  it("E. mutation sends exactly { expectedVersion, mutation }", async () => {
    const draft = makeDraftV2({ version: 4 });
    const { client } = makeClient(async (input, init) => {
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({
        expectedVersion: 3,
        mutation: { op: "set_value", key: "character_name", value: "Mara" },
      });
      return jsonResponse(200, draft);
    });

    await client.mutateDraft(SESSION_ID, "token.123", DRAFT_ID, {
      expectedVersion: 3,
      mutation: { op: "set_value", key: "character_name", value: "Mara" },
    });
  });

  it("F. reroll sends exactly { expectedVersion, seed }", async () => {
    const draft = makeDraftV2({ version: 4 });
    const { client } = makeClient(async (input, init) => {
      expect(String(input).endsWith("/reroll")).toBe(true);
      expect(JSON.parse(String(init?.body))).toEqual({
        expectedVersion: 3,
        seed: "seed-1",
      });
      return jsonResponse(200, { draft, rerolledKeys: ["strength"] });
    });

    const result = await client.rerollDraft(SESSION_ID, "token.123", DRAFT_ID, {
      expectedVersion: 3,
      seed: "seed-1",
    });
    expect(result.rerolledKeys).toEqual(["strength"]);
  });

  it("G. confirm sends exactly { expectedVersion }", async () => {
    const draft = makeDraftV2({ version: 4, confirmed: true });
    const { client } = makeClient(async (input, init) => {
      expect(String(input).endsWith("/confirm")).toBe(true);
      expect(JSON.parse(String(init?.body))).toEqual({ expectedVersion: 3 });
      return jsonResponse(200, draft);
    });

    await client.confirmDraft(SESSION_ID, "token.123", DRAFT_ID, {
      expectedVersion: 3,
    });
  });

  it("H. confirm parses the RAW V2 snapshot, not a { draft } wrapper", async () => {
    const draft = makeDraftV2({ version: 4, confirmed: true });
    const { client } = makeClient(async () => jsonResponse(200, draft));

    const confirmed = await client.confirmDraft(
      SESSION_ID,
      "token.123",
      DRAFT_ID,
      {
        expectedVersion: 3,
      },
    );
    expect(confirmed.version).toBe(4);
    expect(confirmed.confirmed).toBe(true);
  });

  it("I. a V1 response payload is rejected", async () => {
    const v1 = { ...makeDraftV2(), schemaVersion: "1" };
    const { client } = makeClient(async () => jsonResponse(200, v1));

    await expect(
      client.getDraft(SESSION_ID, "token.123", DRAFT_ID),
    ).rejects.toThrowError(SheetApiError);
  });

  it("J. a malformed V2 response is rejected", async () => {
    const { client } = makeClient(async () =>
      jsonResponse(200, { schemaVersion: "2", draftId: DRAFT_ID }),
    );

    await expect(
      client.getDraft(SESSION_ID, "token.123", DRAFT_ID),
    ).rejects.toThrowError(SheetApiError);
  });

  it("K. upstream error envelopes map to SheetApiError", async () => {
    const { client } = makeClient(async () =>
      jsonErrorResponse(409, "SHEET_DRAFT_VERSION_CONFLICT", "Stale."),
    );

    const error = await client
      .mutateDraft(SESSION_ID, "token.123", DRAFT_ID, {
        expectedVersion: 1,
        mutation: { op: "clear_value", key: "character_name" },
      })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SheetApiError);
    expect((error as SheetApiError).code).toBe("SHEET_DRAFT_VERSION_CONFLICT");
  });

  it("L. unsafe identity segments are rejected before any request", async () => {
    const draft = makeDraftV2({ version: 1 });
    const { client, fetchImpl } = makeClient(async () =>
      jsonResponse(201, draft),
    );

    await expect(
      client.createDraft("../escape", "token.123", draft),
    ).rejects.toThrowError(SheetApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
