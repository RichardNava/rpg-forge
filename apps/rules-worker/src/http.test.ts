import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_BODY_BYTES,
  readBoundedBytes,
  readBoundedJson,
} from "./http.js";

function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("https://rules-worker.test/v1/character-sheets/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: stream,
    // @ts-expect-error Node Request duplex marker for streams.
    duplex: "half",
  });
}

describe("readBoundedJson", () => {
  it("parses a small JSON body", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ a: 1 }));
    expect(await readBoundedJson(streamRequest([body]))).toEqual({ a: 1 });
  });

  it("rejects an oversized stream even without content-length", async () => {
    const big = new Uint8Array(MAX_REQUEST_BODY_BYTES + 1).fill(0x7b);
    // No content-length header: the stream cap (not the advisory header) rejects.
    expect(await readBoundedJson(streamRequest([big]))).toBeNull();
  });

  it("rejects a forged small content-length followed by a large stream", async () => {
    const big = new Uint8Array(MAX_REQUEST_BODY_BYTES + 1).fill(0x7b);
    const request = streamRequest([big], { "content-length": "10" });
    expect(await readBoundedJson(request)).toBeNull();
  });

  it("rejects malformed JSON", async () => {
    const body = new TextEncoder().encode("{nope");
    expect(await readBoundedJson(streamRequest([body]))).toBeNull();
  });
});

describe("readBoundedBytes", () => {
  it("caps streams at maxBytes", async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
    expect(await readBoundedBytes(streamRequest(chunks), 4)).toBeNull();
    const kept = await readBoundedBytes(streamRequest(chunks), 5);
    expect(kept).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
});
