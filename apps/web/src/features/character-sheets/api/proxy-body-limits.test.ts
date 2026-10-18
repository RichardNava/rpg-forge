import { describe, expect, it } from "vitest";
import {
  PROXY_EXTRACTION_MAX_REQUEST_BYTES,
  PROXY_JSON_MAX_REQUEST_BYTES,
  PROXY_PORTRAIT_UPLOAD_MAX_REQUEST_BYTES,
  proxyBodyCapForRoute,
  readBoundedProxyBody,
} from "./proxy-body-limits";

function streamRequest(size: number, contentLength: string | null = null): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(size).fill(0x7b));
      controller.close();
    },
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (contentLength !== null) headers["content-length"] = contentLength;
  return new Request("https://web.test/api/character-sheets/sessions", {
    method: "POST",
    headers,
    body: stream,
    // @ts-expect-error Node Request duplex marker for streams.
    duplex: "half",
  });
}

describe("proxyBodyCapForRoute", () => {
  it("mirrors the Worker caps per route", () => {
    expect(proxyBodyCapForRoute("POST", ["sessions", "s", "extraction"])).toBe(
      PROXY_EXTRACTION_MAX_REQUEST_BYTES,
    );
    expect(
      proxyBodyCapForRoute("POST", ["sessions", "s", "portraits", "upload"]),
    ).toBe(PROXY_PORTRAIT_UPLOAD_MAX_REQUEST_BYTES);
    expect(proxyBodyCapForRoute("POST", ["sessions", "s", "drafts"])).toBe(
      PROXY_JSON_MAX_REQUEST_BYTES,
    );
    expect(proxyBodyCapForRoute("GET", ["sessions", "s"])).toBe(
      PROXY_JSON_MAX_REQUEST_BYTES,
    );
  });
});

describe("readBoundedProxyBody", () => {
  it("buffers bodies within cap", async () => {
    const buffer = await readBoundedProxyBody(streamRequest(100), 16 * 1024);
    expect(buffer?.byteLength).toBe(100);
  });

  it("cancels oversized streams even without content-length", async () => {
    const buffer = await readBoundedProxyBody(streamRequest(17 * 1024), 16 * 1024);
    expect(buffer).toBeNull();
  });

  it("rejects forged small content-length headers on the stream", async () => {
    const buffer = await readBoundedProxyBody(streamRequest(17 * 1024, "10"), 16 * 1024);
    expect(buffer).toBeNull();
  });
});
