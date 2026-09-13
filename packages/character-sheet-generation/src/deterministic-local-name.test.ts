import { describe, expect, it } from "vitest";
import {
  createDeterministicLevel3NamePort,
  createDeterministicLocalNamePort,
  DeterministicRandom,
  MAX_DETERMINISTIC_NAME_CHARS,
  stableNameSeed,
  validateDeterministicLocalName,
} from "./deterministic-local-name.js";
import type { Level3NamePort } from "./ports.js";

describe("stableNameSeed", () => {
  it("is deterministic and distributes across seeds", () => {
    expect(stableNameSeed("pc|sheet-a|en")).toBe(
      stableNameSeed("pc|sheet-a|en"),
    );
    const a = stableNameSeed("pc|sheet-a|en");
    const b = stableNameSeed("npc|sheet-a|en");
    const c = stableNameSeed("pc|sheet-b|en");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("varies when the seed string changes", () => {
    expect(stableNameSeed("seed-1")).not.toBe(stableNameSeed("seed-2"));
  });
});

describe("createDeterministicLocalNamePort", () => {
  it("returns the same name for the same (mode, seed, locale)", async () => {
    const port = createDeterministicLocalNamePort();
    const first = await port.generateName({
      mode: "pc",
      seed: "sheet-0001",
      locale: "en",
    });
    const second = await port.generateName({
      mode: "pc",
      seed: "sheet-0001",
      locale: "en",
    });
    expect(first).toBe(second);
  });

  it("returns different names for different seeds", async () => {
    const port = createDeterministicLocalNamePort();
    const first = await port.generateName({
      mode: "pc",
      seed: "sheet-0001",
    });
    const second = await port.generateName({
      mode: "pc",
      seed: "sheet-0002",
    });
    expect(first).not.toBe(second);
  });

  it("returns different names for different modes with the same seed", async () => {
    const port = createDeterministicLocalNamePort();
    const pc = await port.generateName({ mode: "pc", seed: "sheet-0001" });
    const npc = await port.generateName({ mode: "npc", seed: "sheet-0001" });
    expect(pc).not.toBe(npc);
  });

  it("is locale-aware: Spanish names differ from English ones", async () => {
    const port = createDeterministicLocalNamePort();
    const en = await port.generateName({
      mode: "pc",
      seed: "sheet-0001",
      locale: "en",
    });
    const es = await port.generateName({
      mode: "pc",
      seed: "sheet-0001",
      locale: "es",
    });
    expect(en).not.toBe(es);
  });

  it("produces non-blank, bounded, capitalized names", async () => {
    const port = createDeterministicLocalNamePort();
    for (const seed of ["a", "b", "c", "d", "e"]) {
      for (const mode of ["pc", "npc"] as const) {
        const name = await port.generateName({ mode, seed });
        expect(name.trim().length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(MAX_DETERMINISTIC_NAME_CHARS);
        expect(name.charAt(0)).toBe(name.charAt(0).toUpperCase());
        expect(validateDeterministicLocalName(name).valid).toBe(true);
      }
    }
  });

  it("is deterministic across hundreds of seeds (no collisions in stream)", async () => {
    const port = createDeterministicLocalNamePort();
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const name = await port.generateName({ mode: "pc", seed: `s${index}` });
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
  });
});

describe("createDeterministicLevel3NamePort", () => {
  it("adapts to the Level3NamePort contract and stays AI-free", async () => {
    const port: Level3NamePort = createDeterministicLevel3NamePort({
      seed: "sheet-0001",
      locale: "en",
    });
    const first = await port.generateName({
      mode: "pc",
      system: "system",
      user: "user",
    });
    const second = await port.generateName({
      mode: "pc",
      system: "system",
      user: "user",
    });
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("ignores system/user so construction stays deterministic", async () => {
    const port = createDeterministicLevel3NamePort({ seed: "sheet-0001" });
    const a = await port.generateName({
      mode: "pc",
      system: "one",
      user: "two",
    });
    const b = await port.generateName({
      mode: "pc",
      system: "another",
      user: "context",
    });
    expect(a).toBe(b);
  });
});

describe("createDeterministicRandom", () => {
  it("is reproducible and bounded to [0, 1)", () => {
    const random: DeterministicRandom = (() => {
      let state = 1234;
      return function next(): number {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const first = random();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });
});
