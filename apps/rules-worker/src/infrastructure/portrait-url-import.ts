import {
  PORTRAIT_MAX_BYTES,
  validatePortraitImageBytes,
} from "@repo/character-sheet-portraits";

/** Maximum portrait source URL length. */
export const PORTRAIT_URL_MAX_CHARS = 2048;

/** Maximum followed redirects when importing a portrait URL. */
export const PORTRAIT_URL_MAX_REDIRECTS = 3;

export type PortraitUrlRejectionCode =
  | "invalid_url"
  | "insecure_scheme"
  | "forbidden_host"
  | "too_many_redirects"
  | "fetch_failed"
  | "too_large"
  | "invalid_content";

export interface PortraitUrlImportSuccess {
  readonly kind: "ok";
  readonly finalUrl: string;
  readonly bytes: Uint8Array;
}

export interface PortraitUrlImportFailure {
  readonly kind: "rejected";
  readonly code: PortraitUrlImportRejectionCode;
  readonly message: string;
}

export type PortraitUrlImportResult = PortraitUrlImportSuccess | PortraitUrlImportFailure;

/**
 * Validates a portrait source URL without fetching it: HTTPS only, bounded
 * length, no credentials, no localhost/.local/private/reserved literal hosts.
 */
export function validatePortraitSourceUrl(raw: string): { ok: true; url: URL } | { ok: false; code: "invalid_url" | "insecure_scheme" | "forbidden_host"; message: string } {
  if (raw.length === 0 || raw.length > PORTRAIT_URL_MAX_CHARS) {
    return { ok: false, code: "invalid_url", message: "The portrait URL is invalid." };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid_url", message: "The portrait URL is invalid." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, code: "insecure_scheme", message: "Portrait URLs must use HTTPS." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, code: "invalid_url", message: "Portrait URLs must not contain credentials." };
  }
  if (isForbiddenPortraitHost(url.hostname)) {
    return { ok: false, code: "forbidden_host", message: "Portrait URLs must not target local or private hosts." };
  }
  return { ok: true, url };
}

function isForbiddenPortraitHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost") return true;
  if (host === "local" || host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (host === "[::1]" || host === "[::]") return true;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIpv4Literal(bare)) return isPrivateIpv4(bare);
  if (bare.includes(":")) return isPrivateIpv6(bare);
  return false;
}

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255) || parts.length !== 4) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && (b === 0 || b === 2)) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51 || b === 100)) return true;
  if (a === 203 && b === 0) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fe90:") || h.startsWith("fea0:") || h.startsWith("feb0:")) {
    // Covers fe80::/10 approximately via nibble check below.
  }
  const first = h.split(":")[0] ?? "";
  if (first.startsWith("fe") && ["8", "9", "a", "b"].includes(first[2] ?? "")) return true;
  if (first.startsWith("fc") || first.startsWith("fd")) return true;
  if (first === "ff") return true;
  if (h.startsWith("ff")) return true;
  if (h.startsWith("2001:db8")) return true;
  return false;
}

export interface PortraitFetch {
  (url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Imports a portrait image over HTTPS with manual redirect handling.
 *
 * - redirects: manual, at most PORTRAIT_URL_MAX_REDIRECTS, every target
 *   re-validated with the same policy;
 * - no Authorization/Cookie headers are ever forwarded;
 * - response bytes are bounded; magic + pixel bounds validated before return.
 */
export async function importPortraitFromUrl(
  rawUrl: string,
  fetchImpl: PortraitFetch = fetch,
): Promise<PortraitUrlImportResult> {
  const first = validatePortraitSourceUrl(rawUrl);
  if (!first.ok) {
    return { kind: "rejected", code: first.code === "forbidden_host" ? "forbidden_host" : first.code, message: first.message };
  }
  let current = first.url.toString();
  for (let hop = 0; hop <= PORTRAIT_URL_MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, { method: "GET", redirect: "manual" });
    } catch {
      return { kind: "rejected", code: "fetch_failed", message: "The portrait URL could not be fetched." };
    }
    if (response.status >= 300 && response.status < 400) {
      if (hop >= PORTRAIT_URL_MAX_REDIRECTS) {
        return { kind: "rejected", code: "too_many_redirects", message: "The portrait URL redirected too many times." };
      }
      const location = response.headers.get("location");
      if (location === null) {
        return { kind: "rejected", code: "fetch_failed", message: "The portrait URL redirect was invalid." };
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { kind: "rejected", code: "fetch_failed", message: "The portrait URL redirect was invalid." };
      }
      const revalidated = validatePortraitSourceUrl(next.toString());
      if (!revalidated.ok) {
        return { kind: "rejected", code: revalidated.code === "forbidden_host" ? "forbidden_host" : "invalid_url", message: revalidated.message };
      }
      current = next.toString();
      continue;
    }
    if (!response.ok) {
      return { kind: "rejected", code: "fetch_failed", message: "The portrait URL could not be fetched." };
    }
    const bytes = await readBoundedBytes(response, PORTRAIT_MAX_BYTES + 1);
    if (bytes === null) {
      return { kind: "rejected", code: "too_large", message: "The portrait image exceeds the size limit." };
    }
    const validated = validatePortraitImageBytes(bytes);
    if (!validated.valid) {
      const code = validated.code === "too_large" || validated.code === "too_many_pixels" ? "too_large" : "invalid_content";
      return {
        kind: "rejected",
        code,
        message:
          code === "too_large"
            ? "The portrait image exceeds the size limit."
            : "The portrait URL did not return a valid PNG or JPEG image.",
      };
    }
    return { kind: "ok", finalUrl: current, bytes };
  }
  return { kind: "rejected", code: "too_many_redirects", message: "The portrait URL redirected too many times." };
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (response.body === null) {
    const buffer = await response.arrayBuffer().catch(() => null);
    if (buffer === null) return null;
    const bytes = new Uint8Array(buffer);
    return bytes.length > maxBytes ? null : bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
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
