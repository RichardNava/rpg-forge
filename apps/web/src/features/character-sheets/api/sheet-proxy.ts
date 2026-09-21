import { isSheetIdentitySegment } from "./sheet-identity-segments";
import type { SheetFetch } from "./sheet-api-client";

const UPSTREAM_CHARACTER_SHEET_PATH = "/v1/character-sheets";

export type CharacterSheetProxyMethod = "GET" | "POST" | "PATCH";

export type CharacterSheetProxyDecision =
  | { kind: "ok"; upstreamPath: string }
  | { kind: "unsafe_segment" }
  | { kind: "route_not_found" };

/**
 * Maps a same-origin request (`/api/character-sheets/<segments>`) to the
 * rules-worker path (`/v1/character-sheets/...`). The whitelist mirrors the
 * rules-worker character-sheet handler exactly; anything else is rejected so
 * the proxy never becomes an open forwarder.
 */
export function resolveCharacterSheetProxyPath(
  method: string,
  segments: string[],
): CharacterSheetProxyDecision {
  if (segments.length === 0) {
    return { kind: "route_not_found" };
  }
  for (const segment of segments) {
    if (!isSheetIdentitySegment(segment)) {
      return { kind: "unsafe_segment" };
    }
  }

  const [first, second, third, fourth, fifth] = segments;

  if (method === "POST" && first === "sessions" && second === undefined) {
    return {
      kind: "ok",
      upstreamPath: `${UPSTREAM_CHARACTER_SHEET_PATH}/sessions`,
    };
  }

  if (
    method === "GET" &&
    first === "sessions" &&
    second !== undefined &&
    third === undefined
  ) {
    return {
      kind: "ok",
      upstreamPath: `${UPSTREAM_CHARACTER_SHEET_PATH}/sessions/${second}`,
    };
  }

  if (
    method === "POST" &&
    first === "sessions" &&
    second !== undefined &&
    third === "extraction" &&
    fourth === undefined
  ) {
    return {
      kind: "ok",
      upstreamPath: `${UPSTREAM_CHARACTER_SHEET_PATH}/sessions/${second}/extraction`,
    };
  }

  if (
    method === "POST" &&
    first === "sessions" &&
    second !== undefined &&
    third === "drafts" &&
    fourth === undefined
  ) {
    return {
      kind: "ok",
      upstreamPath: `${UPSTREAM_CHARACTER_SHEET_PATH}/sessions/${second}/drafts`,
    };
  }

  if (
    (method === "GET" || method === "PATCH") &&
    first === "sessions" &&
    second !== undefined &&
    third === "drafts" &&
    fourth !== undefined &&
    fifth === undefined
  ) {
    return {
      kind: "ok",
      upstreamPath: `${UPSTREAM_CHARACTER_SHEET_PATH}/sessions/${second}/drafts/${fourth}`,
    };
  }

  if (
    method === "POST" &&
    first === "sessions" &&
    second !== undefined &&
    third === "drafts" &&
    fourth !== undefined &&
    fifth === "reroll"
  ) {
    return {
      kind: "ok",
      upstreamPath: `${UPSTREAM_CHARACTER_SHEET_PATH}/sessions/${second}/drafts/${fourth}/reroll`,
    };
  }

  if (
    method === "POST" &&
    first === "sessions" &&
    second !== undefined &&
    third === "drafts" &&
    fourth !== undefined &&
    fifth === "confirm"
  ) {
    return {
      kind: "ok",
      upstreamPath: `${UPSTREAM_CHARACTER_SHEET_PATH}/sessions/${second}/drafts/${fourth}/confirm`,
    };
  }

  return { kind: "route_not_found" };
}

export interface CharacterSheetProxyRequest {
  method: CharacterSheetProxyMethod;
  segments: string[];
  search: string;
  forwardedHeaders: Record<string, string>;
  bodyText: BodyInit | null;
  upstreamBaseUrl: string;
}

const FORWARDED_HEADER_NAMES = new Set(["authorization", "content-type"]);

const PROXY_NOT_FOUND_MESSAGE = "Route not found.";

export function proxyErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  const body = JSON.stringify({ error: { code, message } });
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Forwards a validated same-origin character-sheet request to the
 * rules-worker. Only `authorization` and `content-type` are forwarded; the
 * upstream URL stays entirely server-side. Responses pass through with their
 * status and `content-type`; an unreachable upstream becomes a 502.
 */
export async function proxyCharacterSheetRequest(
  input: CharacterSheetProxyRequest,
  fetchImpl: SheetFetch = fetch,
): Promise<Response> {
  const decision = resolveCharacterSheetProxyPath(input.method, input.segments);
  if (decision.kind === "unsafe_segment") {
    return proxyErrorResponse(
      "INVALID_REQUEST",
      "The character-sheet path contains unsafe segments.",
      404,
    );
  }
  if (decision.kind === "route_not_found") {
    return proxyErrorResponse("INVALID_REQUEST", PROXY_NOT_FOUND_MESSAGE, 404);
  }

  const upstreamUrl = new URL(
    `${decision.upstreamPath}${input.search}`,
    input.upstreamBaseUrl,
  );

  const headers = new Headers();
  for (const [name, value] of Object.entries(input.forwardedHeaders)) {
    if (FORWARDED_HEADER_NAMES.has(name) && value !== "") {
      headers.set(name, value);
    }
  }

  const init: RequestInit = { method: input.method, headers };
  if (
    input.bodyText !== null &&
    (input.method === "POST" || input.method === "PATCH")
  ) {
    init.body = input.bodyText;
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, init);
  } catch {
    return proxyErrorResponse(
      "PROXY_UPSTREAM_UNAVAILABLE",
      "The character-sheet service is unavailable.",
      502,
    );
  }

  const responseHeaders = new Headers({ "cache-control": "no-store" });
  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType !== null) {
    responseHeaders.set("content-type", contentType);
  }
  const body = await upstreamResponse.text();
  return new Response(body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
