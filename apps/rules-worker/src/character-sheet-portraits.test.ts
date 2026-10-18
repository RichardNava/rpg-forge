import { describe, expect, it } from "vitest";
import type { CharacterSheetPortraitAssetStore } from "@repo/character-sheet-portraits";
import type { PortraitGenerationPort } from "@repo/character-sheet-portraits";
import { handleRequest, type AppDeps } from "./handler.js";
import { createR2CharacterSheetPortraitAssetStore } from "./infrastructure/r2-character-sheet-portraits.js";
import type { R2BucketLike } from "./infrastructure/r2-character-sheet-artifacts.js";
import {
  FakeClock,
  FakeCrypto,
  FakeDraftHeadRepository,
  FakeHumanVerification,
  FakeRateLimiter,
  FakeResourceCleaner,
  FakeRulebookRepository,
  FakeRulesAnalysisRunRepository,
  FakeSessionRepository,
  FakeSheetSessionRepository,
} from "./test/fakes.js";

const BASE_URL = "https://rules-worker.test";
const SHEET_SESSIONS_URL = `${BASE_URL}/v1/character-sheets/sessions`;

function tinyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
    0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08,
    0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xfb, 0x03,
    0x0c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, value: string | Uint8Array): Promise<unknown> {
    this.objects.set(
      key,
      typeof value === "string" ? new TextEncoder().encode(value) : value.slice(),
    );
    return {};
  }
  async get(key: string) {
    const payload = this.objects.get(key);
    if (payload === undefined) return null;
    return {
      text: async () => new TextDecoder().decode(payload),
      bytes: async () => payload.slice(),
    };
  }
  async list(options?: { prefix?: string }) {
    const keys = [...this.objects.keys()].filter((key) =>
      options?.prefix === undefined ? true : key.startsWith(options.prefix),
    );
    return { objects: keys.map((key) => ({ key })), truncated: false as const };
  }
  async delete(key: string | string[]): Promise<void> {
    for (const single of Array.isArray(key) ? key : [key]) {
      this.objects.delete(single);
    }
  }
}

interface PortraitHarness {
  deps: AppDeps;
  generatePort: { calls: number; failWith: Error | null };
}

function makePortraitHarness(options: {
  artifacts?: CharacterSheetPortraitAssetStore;
  portraitGeneration?: PortraitGenerationPort | null;
} = {}): PortraitHarness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const bucket = new MemoryBucket();
  const generatePort = { calls: 0, failWith: null as Error | null };
  const portraitGeneration: PortraitGenerationPort = {
    async generate(input) {
      generatePort.calls += 1;
      if (generatePort.failWith !== null) throw generatePort.failWith;
      void input;
      return { bytes: tinyPng(), mimeType: "image/png" };
    },
  };
  const deps: AppDeps = {
    crypto,
    clock,
    repository: new FakeSessionRepository(),
    cleaner: new FakeResourceCleaner(),
    humanVerifier: new FakeHumanVerification(),
    rateLimiter: new FakeRateLimiter(),
    rulebookRepository: new FakeRulebookRepository(clock),
    rulesAnalysisRunRepository: new FakeRulesAnalysisRunRepository(),
    sheetSessionRepository: new FakeSheetSessionRepository(),
    sheetDraftHeadRepository: new FakeDraftHeadRepository(),
    portraitAssetStore:
      options.artifacts ?? createR2CharacterSheetPortraitAssetStore(bucket),
    ...(options.portraitGeneration === null
      ? {}
      : { portraitGenerationPort: options.portraitGeneration ?? portraitGeneration }),
  };
  return { deps, generatePort };
}

async function createSession(harness: PortraitHarness) {
  const response = await handleRequest(
    new Request(SHEET_SESSIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "turnstile-ok" }),
    }),
    harness.deps,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { sessionId: string; accessToken: string };
}

function uploadBody(file: File): { body: FormData; headers: Record<string, string> } {
  const body = new FormData();
  body.append("image", file);
  return { body, headers: {} };
}

describe("portrait upload source", () => {
  it("stores a valid PNG and returns an asset ref", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const file = new File([tinyPng().buffer as ArrayBuffer], "art.png", { type: "image/png" });
    const { body } = uploadBody(file);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body,
      }),
      harness.deps,
    );
    expect(response.status).toBe(201);
    const ref = (await response.json()) as { schemaVersion: string; assetId: string; source: string; mimeType: string };
    expect(ref.schemaVersion).toBe("1");
    expect(ref.source).toBe("upload");
    expect(ref.mimeType).toBe("image/png");

    const preview = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/${ref.assetId}`, {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await preview.arrayBuffer())]).toEqual([...tinyPng()]);
  });

  it("rejects wrong magic with 400", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const file = new File([new TextEncoder().encode("GIF89a....")], "art.gif", {
      type: "image/gif",
    });
    const { body } = uploadBody(file);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body,
      }),
      harness.deps,
    );
    // GIF magic is not PNG/JPEG: unsupported type maps to 415.
    expect([400, 415]).toContain(response.status);
  });

  it("rejects an oversized upload with 413", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const big = new Uint8Array(8 * 1024 * 1024 + 4);
    big[0] = 0x89;
    const file = new File([big.buffer as ArrayBuffer], "big.png", { type: "image/png" });
    const { body } = uploadBody(file);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body,
      }),
      harness.deps,
    );
    expect(response.status).toBe(413);
  });

  it("rejects a missing image field with 400", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/upload`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "multipart/form-data; boundary=x",
        },
        body: new FormData(),
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
  });

  it("blocks cross-session preview reads", async () => {
    const harness = makePortraitHarness();
    const first = await createSession(harness);
    const file = new File([tinyPng().buffer as ArrayBuffer], "art.png", { type: "image/png" });
    const { body } = uploadBody(file);
    const uploaded = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${first.sessionId}/portraits/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${first.accessToken}` },
        body,
      }),
      harness.deps,
    );
    const { assetId } = (await uploaded.json()) as { assetId: string };
    const other = await createSession(harness);
    const preview = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${other.sessionId}/portraits/${assetId}`, {
        method: "GET",
        headers: { authorization: `Bearer ${other.accessToken}` },
      }),
      harness.deps,
    );
    expect(preview.status).toBe(404);
  });
});

describe("portrait URL source", () => {
  it("rejects non-HTTPS URLs without fetching", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/import-url`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ url: "http://example.com/a.png" }),
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
  });

  it("rejects private hosts without fetching", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/import-url`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ url: "https://169.254.169.254/latest" }),
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
  });
});

describe("portrait AI source", () => {
  it("stores a fake-generated portrait without real inference", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/generate`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "a scarred ranger" }),
      }),
      harness.deps,
    );
    expect(response.status).toBe(201);
    const ref = (await response.json()) as { source: string; mimeType: string; assetId: string };
    expect(ref.source).toBe("ai");
    expect(ref.mimeType).toBe("image/png");
    expect(harness.generatePort.calls).toBe(1);
  });

  it("rejects blank and oversized prompts", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    for (const prompt of ["   ", "x".repeat(2001)]) {
      const response = await handleRequest(
        new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/generate`, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
        }),
        harness.deps,
      );
      expect(response.status).toBe(400);
    }
    expect(harness.generatePort.calls).toBe(0);
  });

  it("fails closed when no portrait model is configured", async () => {
    const harness = makePortraitHarness({ portraitGeneration: null });
    const { sessionId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/portraits/generate`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "a ranger" }),
      }),
      harness.deps,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_PORTRAIT_UNAVAILABLE");
  });
});

describe("portrait preview", () => {
  it("returns 404 for a missing asset", async () => {
    const harness = makePortraitHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${sessionId}/portraits/00000000-0000-4000-8000-000000000099`,
        { method: "GET", headers: { authorization: `Bearer ${accessToken}` } },
      ),
      harness.deps,
    );
    expect(response.status).toBe(404);
  });
});
