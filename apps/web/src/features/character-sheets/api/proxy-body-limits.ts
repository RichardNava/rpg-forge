/**
 * Proxy-tier request body caps (14.15 hardening).
 *
 * The proxy mirrors the Worker caps so oversized bodies are rejected at the
 * edge instead of exhausting proxy memory before the Worker can refuse them:
 * extraction accepts documents, portrait upload accepts images, everything
 * else on this namespace is small JSON.
 */
export const PROXY_EXTRACTION_MAX_REQUEST_BYTES = 16 * 1024 * 1024 + 64 * 1024;
export const PROXY_PORTRAIT_UPLOAD_MAX_REQUEST_BYTES = 8 * 1024 * 1024 + 64 * 1024;
export const PROXY_JSON_MAX_REQUEST_BYTES = 16 * 1024;

/**
 * Selects the body cap for a proxied route. Unknown shapes fall back to the
 * JSON cap; the whitelist rejects them afterwards, so at most 16 KiB is ever
 * buffered for an unknown route.
 */
export function proxyBodyCapForRoute(method: string, path: string[]): number {
  const isExtraction =
    method === "POST" && path.length === 3 && path[0] === "sessions" && path[2] === "extraction";
  if (isExtraction) return PROXY_EXTRACTION_MAX_REQUEST_BYTES;
  const isPortraitUpload =
    method === "POST" &&
    path.length === 4 &&
    path[0] === "sessions" &&
    path[2] === "portraits" &&
    path[3] === "upload";
  if (isPortraitUpload) return PROXY_PORTRAIT_UPLOAD_MAX_REQUEST_BYTES;
  return PROXY_JSON_MAX_REQUEST_BYTES;
}

/**
 * Stream-capped body reader. Returns the buffered bytes, or null when the
 * stream exceeds maxBytes (the reader is cancelled early). A missing body is
 * the caller's concern, not an over-cap stream.
 */
export async function readBoundedProxyBody(
  request: Request,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    return null;
  }
  if (request.body === null) {
    throw new Error("readBoundedProxyBody requires a request body.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
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
