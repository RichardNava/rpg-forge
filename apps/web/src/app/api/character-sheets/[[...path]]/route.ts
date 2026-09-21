import { readRulesWorkerConfiguration } from "@/config/env.server";
import {
  proxyCharacterSheetRequest,
  proxyErrorResponse,
  type CharacterSheetProxyMethod,
} from "@/features/character-sheets/api/sheet-proxy";

export const dynamic = "force-dynamic";

const EXTRACTION_MAX_REQUEST_BYTES = 16 * 1024 * 1024 + 64 * 1024;

async function readBoundedExtractionBody(
  request: Request,
): Promise<ArrayBuffer | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > EXTRACTION_MAX_REQUEST_BYTES) {
    return null;
  }
  if (request.body === null) {
    return null;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > EXTRACTION_MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

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
  const bodyText =
    method === "GET"
      ? null
      : isExtraction
        ? await readBoundedExtractionBody(request)
        : await request.arrayBuffer();
  if (isExtraction && bodyText === null) {
    return proxyErrorResponse(
      "SHEET_DOCUMENT_TOO_LARGE",
      "The uploaded document is too large.",
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
