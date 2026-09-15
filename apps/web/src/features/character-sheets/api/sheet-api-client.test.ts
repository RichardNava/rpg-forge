import { describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";
import type {
  CharacterSheetDraft,
  DraftMutation,
} from "@repo/character-sheet-draft";
import { SheetApiClient, type SheetFetch } from "./sheet-api-client";
import { SheetApiError } from "./sheet-api-errors";

const SESSION_URL = "/api/character-sheets";
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
): { client: SheetApiClient; fetchImpl: MockedFunction<SheetFetch> } {
  const fetchImpl = vi.fn<SheetFetch>();
  fetchImpl.mockImplementation(responder);
  return { client: new SheetApiClient({ fetchImpl }), fetchImpl };
}

describe("SheetApiClient", () => {
  it("creates a session without an authorization header", async () => {
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(`${SESSION_URL}/sessions`);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toContain(
        "application/json",
      );
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(JSON.parse(String(init?.body))).toEqual({
        turnstileToken: "tok-1",
      });
      return jsonResponse(201, {
        sessionId: SESSION_ID,
        accessToken: "token.123",
        expiresAt: "2026-09-07T12:00:00.000Z",
      });
    });

    const session = await client.createSession("tok-1");
    expect(session).toEqual({
      sessionId: SESSION_ID,
      accessToken: "token.123",
      expiresAt: "2026-09-07T12:00:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads a session view with a bearer token", async () => {
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(`${SESSION_URL}/sessions/${SESSION_ID}`);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token.123",
      );
      return jsonResponse(200, {
        sessionId: SESSION_ID,
        status: "ACTIVE",
        expiresAt: "2026-09-07T12:00:00.000Z",
      });
    });

    const view = await client.getSession(SESSION_ID, "token.123");
    expect(view.status).toBe("ACTIVE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("creates a draft and returns the validated snapshot", async () => {
    const draft = makeDraft();
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts`,
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(draft);
      return jsonResponse(201, draft);
    });

    const created = await client.createDraft(SESSION_ID, "token.123", draft);
    expect(created.draftId).toBe(DRAFT_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid draft before touching the network", async () => {
    const { client, fetchImpl } = makeClient(async () => jsonResponse(500, {}));
    const draft = makeDraft({ characterName: "Mismatched" });
    await expect(
      client.createDraft(SESSION_ID, "token.123", draft),
    ).rejects.toThrow(SheetApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hydrates a specific draft version", async () => {
    const draft = makeDraft({ version: 7 });
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts/${DRAFT_ID}?version=7`,
      );
      expect(init?.method).toBe("GET");
      return jsonResponse(200, draft);
    });

    const loaded = await client.getDraft(SESSION_ID, "token.123", DRAFT_ID, 7);
    expect(loaded.version).toBe(7);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies a mutation via PATCH with the raw mutation body", async () => {
    const mutation: DraftMutation = {
      op: "set_value",
      key: "strength",
      value: 15,
    };
    const committed = makeDraft({
      version: 4,
      values: { character_name: "Aria Stone", strength: 15 },
    });
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts/${DRAFT_ID}`,
      );
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual(mutation);
      return jsonResponse(200, committed);
    });

    const result = await client.mutateDraft(
      SESSION_ID,
      "token.123",
      DRAFT_ID,
      mutation,
    );
    expect(result.values.strength).toBe(15);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rerolls a draft and returns the drawn keys", async () => {
    const rerolled = makeDraft({
      version: 4,
      values: { character_name: "Aria Stone", strength: 19 },
    });
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts/${DRAFT_ID}/reroll`,
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ seed: "seed-1" });
      return jsonResponse(200, { draft: rerolled, rerolledKeys: ["strength"] });
    });

    const result = await client.rerollDraft(
      SESSION_ID,
      "token.123",
      DRAFT_ID,
      "seed-1",
    );
    expect(result.draft.version).toBe(4);
    expect(result.rerolledKeys).toEqual(["strength"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("confirms a draft and returns the read-only snapshot", async () => {
    const confirmed = makeDraft({ version: 5, confirmed: true });
    const { client, fetchImpl } = makeClient(async (input, init) => {
      expect(String(input)).toBe(
        `${SESSION_URL}/sessions/${SESSION_ID}/drafts/${DRAFT_ID}/confirm`,
      );
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token.123",
      );
      return jsonResponse(200, confirmed);
    });

    const result = await client.confirmDraft(SESSION_ID, "token.123", DRAFT_ID);
    expect(result.confirmed).toBe(true);
    expect(result.version).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps an upstream error envelope to SheetApiError", async () => {
    const { client, fetchImpl } = makeClient(async () =>
      jsonErrorResponse(409, "SHEET_DRAFT_INFLIGHT", "The draft is mid-save."),
    );

    const attempt = client.mutateDraft(SESSION_ID, "token.123", DRAFT_ID, {
      op: "set_value",
      key: "strength",
      value: 15,
    });
    await expect(attempt).rejects.toThrow(SheetApiError);
    await expect(attempt).rejects.toMatchObject({
      code: "SHEET_DRAFT_INFLIGHT",
      status: 409,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("guards identity segments before issuing a request", async () => {
    const { client, fetchImpl } = makeClient(async () => jsonResponse(500, {}));
    await expect(
      client.getDraft("session/../secret", "token.123", DRAFT_ID),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON error response", async () => {
    const { client } = makeClient(
      async () => new Response("oops", { status: 502 }),
    );
    await expect(
      client.getSession(SESSION_ID, "token.123"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
