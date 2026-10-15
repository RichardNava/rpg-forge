import { describe, expect, it } from "vitest";
import {
  createCloudflarePortraitGeneration,
  PORTRAIT_IMAGE_EDGE_PIXELS,
} from "./sheet-portrait-generation.js";

function tinyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
    0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08,
    0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xfb, 0x03,
    0x0c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("createCloudflarePortraitGeneration", () => {
  it("calls the explicitly configured model with prompt-only input", async () => {
    const calls: Array<{ model: string; input: unknown }> = [];
    const ai = {
      async run(model: string, input: unknown) {
        calls.push({ model, input });
        return streamOf(tinyPng());
      },
    } as unknown as Ai;
    const port = createCloudflarePortraitGeneration(ai, "custom-portrait-model");
    const result = await port.generate({ prompt: "a scarred ranger", styleContext: "medieval" });
    expect(result.mimeType).toBe("image/png");
    expect([...result.bytes]).toEqual([...tinyPng()]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("custom-portrait-model");
    const input = calls[0]?.input as { prompt: string; width: number; height: number };
    expect(input.prompt).toContain("a scarred ranger");
    expect(input.prompt).toContain("medieval");
    expect(input.width).toBe(PORTRAIT_IMAGE_EDGE_PIXELS);
    expect(input.height).toBe(PORTRAIT_IMAGE_EDGE_PIXELS);
  });

  it("rejects blank prompts without calling the provider", async () => {
    let called = false;
    const ai = {
      async run() {
        called = true;
        return streamOf(tinyPng());
      },
    } as unknown as Ai;
    const port = createCloudflarePortraitGeneration(ai, "m");
    await expect(port.generate({ prompt: "   ", styleContext: null })).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
    expect(called).toBe(false);
  });

  it("maps provider failure to PROVIDER_UNAVAILABLE", async () => {
    const ai = {
      async run() {
        throw new Error("down");
      },
    } as unknown as Ai;
    const port = createCloudflarePortraitGeneration(ai, "m");
    await expect(port.generate({ prompt: "a ranger", styleContext: null })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("rejects non-image provider bytes", async () => {
    const ai = {
      async run() {
        return streamOf(new TextEncoder().encode("not an image"));
      },
    } as unknown as Ai;
    const port = createCloudflarePortraitGeneration(ai, "m");
    await expect(port.generate({ prompt: "a ranger", styleContext: null })).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
  });
});
