import { readRulesWorkerConfiguration } from "@/config/env.server";
import {
  proxyBodyCapForRoute,
  readBoundedProxyBody,
} from "@/features/character-sheets/api/proxy-body-limits";
import {
  proxyCharacterSheetRequest,
  proxyErrorResponse,
  type CharacterSheetProxyMethod,
} from "@/features/character-sheets/api/sheet-proxy";

export const dynamic = "force-dynamic";

async function handleCharacterSheetProxy(
  method: CharacterSheetProxyMethod,
  request: Request,
  path: string[],
): Promise<Response> {
  let rulesWorkerUrl: string;
  try {
    rulesWorkerUrl = readRulesWorkerConfiguration().rulesWorkerUrl;
  } catch {
    return proxyErrorResponse(
      "PROXY_UPSTREAM_UNAVAILABLE",
      "The character-sheet service is not configured.",
      503,
    );
  }

  const url = new URL(request.url);
  const forwardedHeaders: Record<string, string> = {};
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");
  if (authorization !== null) {
    forwardedHeaders.authorization = authorization;
  }
  if (contentType !== null) {
    forwardedHeaders["content-type"] = contentType;
  }

  const isExtraction =
    method === "POST" && path.length === 3 && path[0] === "sessions" && path[2] === "extraction";
  const isPortraitUpload =
    method === "POST" &&
    path.length === 4 &&
    path[0] === "sessions" &&
    path[2] === "portraits" &&
    path[3] === "upload";
  // A missing body is forwarded as-is for the Worker to validate; only an
  // over-cap stream is rejected here.
  const hasBody = method !== "GET" && request.body !== null;
  const bodyText = !hasBody
    ? null
    : await readBoundedProxyBody(request, proxyBodyCapForRoute(method, path));
  if (hasBody && bodyText === null) {
    if (isExtraction) {
      return proxyErrorResponse(
        "SHEET_DOCUMENT_TOO_LARGE",
        "The uploaded document is too large.",
        413,
      );
    }
    if (isPortraitUpload) {
      return proxyErrorResponse(
        "SHEET_PORTRAIT_TOO_LARGE",
        "The portrait image is too large.",
        413,
      );
    }
    return proxyErrorResponse(
      "INVALID_REQUEST",
      "The request body is too large.",
      413,
    );
  }

  return proxyCharacterSheetRequest({
    method,
    segments: path,
    search: url.search,
    forwardedHeaders,
    bodyText,
    upstreamBaseUrl: rulesWorkerUrl,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  return handleCharacterSheetProxy("GET", request, path);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  return handleCharacterSheetProxy("POST", request, path);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  return handleCharacterSheetProxy("PATCH", request, path);
}
