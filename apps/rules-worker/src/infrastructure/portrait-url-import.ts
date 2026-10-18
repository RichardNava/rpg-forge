import {
  PORTRAIT_MAX_BYTES,
  validatePortraitImageBytes,
} from "@repo/character-sheet-portraits";

/** Maximum portrait source URL length. */
export const PORTRAIT_URL_MAX_CHARS = 2048;

/** Maximum followed redirects when importing a portrait URL. */
export const PORTRAIT_URL_MAX_REDIRECTS = 3;

/** Per-attempt fetch timeout for portrait URL imports. */
export const PORTRAIT_FETCH_TIMEOUT_MS = 15_000;

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
  readonly code: PortraitUrlRejectionCode;
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
  // Single-integer IPv4 form ("https://2130706433/"): WHATWG keeps the
  // hostname as-is, so normalize to dotted-decimal before the private check.
  // Octal/hex dotted forms are already normalized by the URL parser.
  const dotted = normalizeSingleIntegerIpv4(bare);
  if (dotted === null) return true;
  if (isIpv4Literal(dotted)) return isPrivateIpv4(dotted);
  // Embedded-IPv4 IPv6 forms ("::ffff:127.0.0.1"): judge the trailing IPv4
  // part; malformed embedded forms are forbidden outright.
  if (dotted.includes(":") && dotted.includes(".")) {
    const embedded = dotted.slice(dotted.lastIndexOf(":") + 1);
    if (!isIpv4Literal(embedded)) return true;
    if (isPrivateIpv4(embedded)) return true;
  }
  if (dotted.includes(":")) return isPrivateIpv6(dotted);
  return false;
}

/**
 * Extracts dotted-decimal IPv4 from an IPv4-mapped IPv6 suffix (the 32 bits
 * after "::ffff:"). Returns null for malformed suffixes (forbidden).
 */
function ipv4FromMappedSuffix(suffix: string): string | null {
  if (suffix.includes(".")) {
    return isIpv4Literal(suffix) ? suffix : null;
  }
  const groups = suffix.split(":");
  if (groups.length < 1 || groups.length > 2) return null;
  const padded = groups.length === 1 ? ["0", groups[0] as string] : groups;
  const high = Number.parseInt(padded[0] ?? "", 16);
  const low = Number.parseInt(padded[1] ?? "", 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }
  return `${(high >>> 8) & 255}.${high & 255}.${(low >>> 8) & 255}.${low & 255}`;
}

/**
 * Converts a single-integer IPv4 hostname to dotted-decimal. Returns null
 * when the host is not a single integer (caller continues) or is an
 * out-of-range integer (forbidden).
 */
function normalizeSingleIntegerIpv4(host: string): string | null {
  if (!/^\d+$/.test(host)) return host;
  const value = Number(host);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    return null;
  }
  return (
    `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`
  );
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
  // IPv4-mapped IPv6: the URL parser translates "::ffff:127.0.0.1" to
  // "::ffff:7f00:1", so judge the embedded last 32 bits as IPv4.
  if (h.startsWith("::ffff:")) {
    const mapped = ipv4FromMappedSuffix(h.slice("::ffff:".length));
    if (mapped === null) return true;
    return isPrivateIpv4(mapped);
  }
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
      // Bounded per-attempt timeout: a hanging origin must not hold a worker
      // request indefinitely. Injected test doubles ignore the signal.
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(PORTRAIT_FETCH_TIMEOUT_MS),
      });
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
