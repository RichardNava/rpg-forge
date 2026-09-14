import { readRulesWorkerConfiguration } from "@/config/env.server";
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

  const bodyText = method === "GET" ? null : await request.text();

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
