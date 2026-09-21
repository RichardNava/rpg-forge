import { describe, expect, it, vi } from "vitest";
import type { SheetFetch } from "./sheet-api-client";
import {
  proxyCharacterSheetRequest,
  resolveCharacterSheetProxyPath,
  type CharacterSheetProxyRequest,
} from "./sheet-proxy";

const UPSTREAM = "https://rules-worker.test";
const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";
const DRAFT_ID = "draft.abc123";

function makeRequest(
  overrides: Partial<CharacterSheetProxyRequest> = {},
): CharacterSheetProxyRequest {
  return {
    method: "GET",
    segments: ["sessions", SESSION_ID],
    search: "",
    forwardedHeaders: { authorization: "Bearer token.123" },
    bodyText: null,
    upstreamBaseUrl: UPSTREAM,
    ...overrides,
  };
}

describe("resolveCharacterSheetProxyPath", () => {
  it("accepts the session endpoints", () => {
    expect(resolveCharacterSheetProxyPath("POST", ["sessions"])).toMatchObject({
      kind: "ok",
      upstreamPath: "/v1/character-sheets/sessions",
    });
    expect(
      resolveCharacterSheetProxyPath("GET", ["sessions", SESSION_ID]),
    ).toMatchObject({
      kind: "ok",
      upstreamPath: `/v1/character-sheets/sessions/${SESSION_ID}`,
    });
  });

  it("accepts the draft endpoints", () => {
    expect(
      resolveCharacterSheetProxyPath("POST", [
        "sessions",
        SESSION_ID,
        "drafts",
      ]),
    ).toMatchObject({
      kind: "ok",
      upstreamPath: `/v1/character-sheets/sessions/${SESSION_ID}/drafts`,
    });
    expect(
      resolveCharacterSheetProxyPath("GET", [
        "sessions",
        SESSION_ID,
        "drafts",
        DRAFT_ID,
      ]),
    ).toMatchObject({
      kind: "ok",
      upstreamPath: `/v1/character-sheets/sessions/${SESSION_ID}/drafts/${DRAFT_ID}`,
    });
    expect(
      resolveCharacterSheetProxyPath("PATCH", [
        "sessions",
        SESSION_ID,
        "drafts",
        DRAFT_ID,
      ]),
    ).toMatchObject({ kind: "ok" });
    expect(
      resolveCharacterSheetProxyPath("POST", [
        "sessions",
        SESSION_ID,
        "drafts",
        DRAFT_ID,
        "reroll",
      ]),
    ).toMatchObject({
      kind: "ok",
      upstreamPath: `/v1/character-sheets/sessions/${SESSION_ID}/drafts/${DRAFT_ID}/reroll`,
    });
    expect(
      resolveCharacterSheetProxyPath("POST", [
        "sessions",
        SESSION_ID,
        "drafts",
        DRAFT_ID,
        "confirm",
      ]),
    ).toMatchObject({
      kind: "ok",
      upstreamPath: `/v1/character-sheets/sessions/${SESSION_ID}/drafts/${DRAFT_ID}/confirm`,
    });
  });

  it("accepts the authenticated document extraction endpoint", () => {
    expect(
      resolveCharacterSheetProxyPath("POST", [
        "sessions",
        SESSION_ID,
        "extraction",
      ]),
    ).toMatchObject({
      kind: "ok",
      upstreamPath: `/v1/character-sheets/sessions/${SESSION_ID}/extraction`,
    });
  });

  it("rejects unsafe identity segments", () => {
    expect(
      resolveCharacterSheetProxyPath("GET", ["sessions", "..", "etc"]),
    ).toEqual({ kind: "unsafe_segment" });
    expect(resolveCharacterSheetProxyPath("GET", ["sessions", "a/b"])).toEqual({
      kind: "unsafe_segment",
    });
    expect(
      resolveCharacterSheetProxyPath("GET", ["sessions", "a%20b"]),
    ).toEqual({ kind: "unsafe_segment" });
  });

  it("rejects unknown routes and empty paths", () => {
    expect(resolveCharacterSheetProxyPath("POST", [])).toEqual({
      kind: "route_not_found",
    });
    expect(resolveCharacterSheetProxyPath("GET", ["sessions"])).toEqual({
      kind: "route_not_found",
    });
    expect(
      resolveCharacterSheetProxyPath("DELETE", ["sessions", SESSION_ID]),
    ).toEqual({ kind: "route_not_found" });
  });
});

describe("proxyCharacterSheetRequest", () => {
  it("forwards method, headers, body and query to the upstream", async () => {
    const fetchImpl = vi.fn<SheetFetch>();
    fetchImpl.mockImplementation(async (input, init) => {
      expect(String(input)).toBe(
        `${UPSTREAM}/v1/character-sheets/sessions/${SESSION_ID}/drafts/${DRAFT_ID}/reroll?seed=skipped`,
      );
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token.123",
      );
      expect(new Headers(init?.headers).get("content-type")).toContain(
        "application/json",
      );
      expect(String(init?.body)).toBe('{"seed":"seed-1"}');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    });

    const response = await proxyCharacterSheetRequest(
      makeRequest({
        method: "POST",
        segments: ["sessions", SESSION_ID, "drafts", DRAFT_ID, "reroll"],
        search: "?seed=skipped",
        forwardedHeaders: {
          authorization: "Bearer token.123",
          "content-type": "application/json",
        },
        bodyText: '{"seed":"seed-1"}',
      }),
      fetchImpl,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe('{"ok":true}');
  });

  it("rejects an unsafe path without contacting the upstream", async () => {
    const fetchImpl = vi.fn<SheetFetch>();
    const response = await proxyCharacterSheetRequest(
      makeRequest({ segments: ["sessions", ".."] }),
      fetchImpl,
    );
    expect(response.status).toBe(404);
    expect(
      (await response.json()) as { error: { code: string } },
    ).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 502 when the upstream is unreachable", async () => {
    const fetchImpl = vi.fn<SheetFetch>();
    fetchImpl.mockRejectedValue(new TypeError("fetch failed"));
    const response = await proxyCharacterSheetRequest(makeRequest(), fetchImpl);
    expect(response.status).toBe(502);
    expect(
      (await response.json()) as { error: { code: string } },
    ).toMatchObject({
      error: { code: "PROXY_UPSTREAM_UNAVAILABLE" },
    });
  });

  it("never forwards the upstream base url to the caller", async () => {
    const fetchImpl = vi.fn<SheetFetch>();
    fetchImpl.mockImplementation(async () => jsonResponse());
    await proxyCharacterSheetRequest(makeRequest(), fetchImpl);
    const target = String(fetchImpl.mock.calls[0]?.[0]);
    expect(target.startsWith(UPSTREAM)).toBe(true);
    expect(target).not.toContain("/api/character-sheets");
  });
});

function jsonResponse(): Response {
  return new Response("{}", { status: 200 });
}
