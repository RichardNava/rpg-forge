import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";

function streamBody(size: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(size).fill(0x7b));
      controller.close();
    },
  });
}

function postRequest(path: string, body: BodyInit | null): Request {
  return new Request(`https://web.test/api/character-sheets${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    // @ts-expect-error Node Request duplex marker for streams.
    duplex: "half",
  });
}

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

afterEach(() => {
  delete process.env.RULES_WORKER_URL;
  vi.unstubAllGlobals();
});

describe("character-sheet proxy route body caps", () => {
  it("rejects oversized JSON bodies without contacting the upstream", async () => {
    process.env.RULES_WORKER_URL = "https://rules-worker.test";
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const response = await POST(
      postRequest(`/sessions/${SESSION_ID}/drafts`, streamBody(17 * 1024)),
      context(["sessions", SESSION_ID, "drafts"]),
    );
    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards small JSON bodies to the whitelisted upstream route", async () => {
    process.env.RULES_WORKER_URL = "https://rules-worker.test";
    const seenUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      seenUrls.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const response = await POST(
      postRequest(
        `/sessions/${SESSION_ID}/drafts/generate-ai`,
        JSON.stringify({ schemaVersion: "1", mode: "npc", prompt: "An orc." }),
      ),
      context(["sessions", SESSION_ID, "drafts", "generate-ai"]),
    );
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seenUrls).toEqual([
      `https://rules-worker.test/v1/character-sheets/sessions/${SESSION_ID}/drafts/generate-ai`,
    ]);
  });

  it("fails closed without upstream configuration", async () => {
    const response = await POST(
      postRequest(`/sessions/${SESSION_ID}/drafts`, "{}"),
      context(["sessions", SESSION_ID, "drafts"]),
    );
    expect(response.status).toBe(503);
  });
});
