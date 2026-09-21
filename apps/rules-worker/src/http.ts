export type BearerToken = { ok: true; token: string } | { ok: false };

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]+)$/;

export function parseBearerToken(request: Request): BearerToken {
  const header = request.headers.get("authorization");
  if (header === null) {
    return { ok: false };
  }
  const match = BEARER_PATTERN.exec(header);
  if (match === null) {
    return { ok: false };
  }
  const token = match[1];
  if (token === undefined || token === "") {
    return { ok: false };
  }
  return { ok: true, token };
}

export function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (contentType === null) {
    return false;
  }
  return contentType.split(";")[0]?.trim() === "application/json";
}

export function hasPdfContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (contentType === null) {
    return false;
  }
  return contentType.split(";")[0]?.trim().toLowerCase() === "application/pdf";
}

export function readDeclaredContentLength(request: Request): number | null {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null || !/^\d+$/.test(contentLength.trim())) {
    return null;
  }
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function requestBodyBytes(
  request: Request,
): AsyncIterable<Uint8Array> | null {
  if (request.body === null) {
    return null;
  }
  return readBytes(request.body);
}

async function* readBytes(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return;
      }
      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

/** Reads at most `maxBytes`, cancelling an oversized stream before parsing it. */
export async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declaredLength = readDeclaredContentLength(request);
  if (declaredLength !== null && declaredLength > maxBytes) {
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
      if (next.done) {
        break;
      }
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<unknown | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      return null;
    }
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > maxBytes) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
