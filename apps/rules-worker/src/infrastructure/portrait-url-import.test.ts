import { describe, expect, it } from "vitest";
import {
  importPortraitFromUrl,
  validatePortraitSourceUrl,
} from "./portrait-url-import.js";

function tinyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
    0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08,
    0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xfb, 0x03,
    0x0c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function imageResponse(bytes: Uint8Array, status = 200): Response {
  const copy = bytes.slice();
  return new Response(copy.buffer as ArrayBuffer, {
    status,
    headers: { "content-type": "image/png" },
  });
}

describe("validatePortraitSourceUrl", () => {
  it("accepts a plain HTTPS image URL", () => {
    const result = validatePortraitSourceUrl("https://example.com/art/portrait.png");
    expect(result.ok).toBe(true);
  });

  it("rejects HTTP", () => {
    expect(validatePortraitSourceUrl("http://example.com/a.png")).toMatchObject({
      ok: false,
      code: "insecure_scheme",
    });
  });

  it("rejects credentials in the URL", () => {
    expect(validatePortraitSourceUrl("https://user:pass@example.com/a.png")).toMatchObject({
      ok: false,
    });
  });

  it("rejects localhost and .local hosts", () => {
    for (const raw of [
      "https://localhost/a.png",
      "https://printer.local/a.png",
      "https://example.local/a.png",
    ]) {
      expect(validatePortraitSourceUrl(raw)).toMatchObject({ ok: false, code: "forbidden_host" });
    }
  });

  it("rejects private and reserved IPv4 literals", () => {
    for (const raw of [
      "https://10.0.0.1/a.png",
      "https://172.16.4.2/a.png",
      "https://192.168.1.1/a.png",
      "https://127.0.0.1/a.png",
      "https://169.254.169.254/a.png",
      "https://0.0.0.0/a.png",
    ]) {
      expect(validatePortraitSourceUrl(raw)).toMatchObject({ ok: false, code: "forbidden_host" });
    }
  });

  it("rejects IPv6 loopback and private literals", () => {
    for (const raw of ["https://[::1]/a.png", "https://[fc00::1]/a.png"]) {
      expect(validatePortraitSourceUrl(raw)).toMatchObject({ ok: false, code: "forbidden_host" });
    }
  });
});

describe("importPortraitFromUrl", () => {
  it("imports a valid HTTPS image once", async () => {
    const seen: string[] = [];
    const result = await importPortraitFromUrl("https://example.com/art/portrait.png", (async (
      url: string,
    ) => {
      seen.push(url);
      return imageResponse(tinyPng());
    }) as never);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect([...result.bytes]).toEqual([...tinyPng()]);
    expect(seen).toHaveLength(1);
  });

  it("never forwards Authorization or Cookie headers", async () => {
    let captured: Record<string, string> | null = null;
    await importPortraitFromUrl("https://example.com/a.png", (async (
      _url: string,
      init?: RequestInit,
    ) => {
      captured = Object.fromEntries(new Headers(init?.headers).entries());
      return imageResponse(tinyPng());
    }) as never);
    expect(captured).toEqual({});
  });

  it("rejects an HTTP URL without fetching", async () => {
    let fetched = false;
    const result = await importPortraitFromUrl("http://example.com/a.png", (async () => {
      fetched = true;
      return imageResponse(tinyPng());
    }) as never);
    expect(result).toMatchObject({ kind: "rejected", code: "insecure_scheme" });
    expect(fetched).toBe(false);
  });

  it("rejects a redirect to a forbidden host", async () => {
    const result = await importPortraitFromUrl("https://example.com/a.png", (async (url: string) => {
      if (url === "https://example.com/a.png") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest" },
        });
      }
      return imageResponse(tinyPng());
    }) as never);
    expect(result).toMatchObject({ kind: "rejected", code: "forbidden_host" });
  });

  it("enforces the redirect limit", async () => {
    const result = await importPortraitFromUrl("https://example.com/a.png", (async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.com/b.png" },
      });
    }) as never);
    expect(result).toMatchObject({ kind: "rejected", code: "too_many_redirects" });
  });

  it("rejects oversized responses", async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 2);
    big[0] = 0x89;
    const result = await importPortraitFromUrl("https://example.com/a.png", (async () =>
      imageResponse(big)) as never);
    expect(result).toMatchObject({ kind: "rejected", code: "too_large" });
  });

  it("rejects non-image responses", async () => {
    const result = await importPortraitFromUrl("https://example.com/a.png", (async () => {
      const bytes = new TextEncoder().encode("<html>nope</html>");
      return imageResponse(bytes);
    }) as never);
    expect(result).toMatchObject({ kind: "rejected", code: "invalid_content" });
  });
});
