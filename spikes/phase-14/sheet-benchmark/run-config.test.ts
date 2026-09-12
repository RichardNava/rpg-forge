import { describe, expect, it } from "vitest";
import {
  MODELS,
  readFixtureFilter,
  readModelFilter,
  readPersonaFilter,
  resolveSelection,
} from "../scripts/run-sheet-benchmark.js";
import { SHEET_BENCHMARK_FIXTURES } from "./fixtures.js";
import { PERSONA_SLUGS, isValidPersonaSlug } from "./personas.js";

const AUTHORIZED_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const TARGET_FIXTURE = "en-gm-npc-guard";

describe("run-sheet-benchmark selection filters", () => {
  it("accepts a valid model filter", () => {
    const filter = readModelFilter(["--model", AUTHORIZED_MODEL]);
    expect(filter.kind).toBe("present");
    if (filter.kind === "present") {
      expect(filter.model.id).toBe(AUTHORIZED_MODEL);
    }
  });

  it("rejects an unknown model before any benchmark startup", () => {
    const filter = readModelFilter(["--model", "model-does-not-exist"]);
    expect(filter.kind).toBe("invalid");
    if (filter.kind === "invalid") {
      expect(filter.error).toContain("unknown model");
      expect(filter.error).toContain("@cf/");
    }
    expect(() => resolveSelection(["--model", "model-does-not-exist"])).toThrow(
      /unknown model/,
    );
  });

  it("rejects a --model flag without a value", () => {
    expect(readModelFilter(["--model"]).kind).toBe("invalid");
  });

  it("accepts a valid fixture filter", () => {
    const filter = readFixtureFilter(
      ["--fixture", TARGET_FIXTURE],
      SHEET_BENCHMARK_FIXTURES,
    );
    expect(filter.kind).toBe("present");
    if (filter.kind === "present") {
      expect(filter.fixture.id).toBe(TARGET_FIXTURE);
    }
  });

  it("rejects an unknown fixture before any benchmark startup", () => {
    const filter = readFixtureFilter(
      ["--fixture", "no-such-fixture"],
      SHEET_BENCHMARK_FIXTURES,
    );
    expect(filter.kind).toBe("invalid");
    if (filter.kind === "invalid") {
      expect(filter.error).toContain("unknown fixture");
    }
    expect(() => resolveSelection(["--fixture", "no-such-fixture"])).toThrow(
      /unknown fixture/,
    );
  });

  it("rejects a --fixture flag without a value", () => {
    expect(
      readFixtureFilter(["--fixture"], SHEET_BENCHMARK_FIXTURES).kind,
    ).toBe("invalid");
  });

  it("narrows to exactly one model and one fixture when both filters are provided", () => {
    const selection = resolveSelection([
      "--model",
      AUTHORIZED_MODEL,
      "--fixture",
      TARGET_FIXTURE,
    ]);
    expect(selection.models).toHaveLength(1);
    expect(selection.models[0]!.id).toBe(AUTHORIZED_MODEL);
    expect(selection.fixtures).toHaveLength(1);
    expect(selection.fixtures[0]!.id).toBe(TARGET_FIXTURE);
  });

  it("preserves all configured models and fixtures when no filters are provided", () => {
    const selection = resolveSelection([]);
    expect(selection.models).toEqual(MODELS);
    expect(selection.models.length).toBeGreaterThan(1);
    expect(selection.fixtures).toEqual(SHEET_BENCHMARK_FIXTURES);
    expect(selection.fixtures.length).toBeGreaterThan(1);
  });

  it("rejects an invalid model even when a valid fixture is supplied, and vice versa", () => {
    expect(() =>
      resolveSelection(["--model", "bad-model", "--fixture", TARGET_FIXTURE]),
    ).toThrow(/unknown model/);
    expect(() =>
      resolveSelection([
        "--model",
        AUTHORIZED_MODEL,
        "--fixture",
        "bad-fixture",
      ]),
    ).toThrow(/unknown fixture/);
  });
});

describe("persona filter", () => {
  it("accepts a valid persona slug", () => {
    const filter = readPersonaFilter(["--persona", "human-locale"]);
    expect(filter.kind).toBe("present");
    if (filter.kind === "present") {
      expect(filter.personas).toEqual(["human-locale"]);
    }
  });

  it("accepts multiple persona flags", () => {
    const filter = readPersonaFilter([
      "--persona",
      "human-locale",
      "--persona",
      "baseline",
    ]);
    expect(filter.kind).toBe("present");
    if (filter.kind === "present") {
      expect(filter.personas).toEqual(["human-locale", "baseline"]);
    }
  });

  it("accepts all six approved persona slugs", () => {
    for (const slug of PERSONA_SLUGS) {
      const filter = readPersonaFilter(["--persona", slug]);
      expect(filter.kind).toBe("present");
      if (filter.kind === "present") {
        expect(filter.personas).toEqual([slug]);
      }
    }
  });

  it("rejects an unknown persona before any benchmark startup", () => {
    const filter = readPersonaFilter(["--persona", "no-such-persona"]);
    expect(filter.kind).toBe("invalid");
    if (filter.kind === "invalid") {
      expect(filter.error).toContain("unknown persona");
    }
    expect(() =>
      resolveSelection([
        "--model",
        AUTHORIZED_MODEL,
        "--fixture",
        TARGET_FIXTURE,
        "--persona",
        "no-such-persona",
      ]),
    ).toThrow(/unknown persona/);
  });

  it("rejects a --persona flag without a value", () => {
    expect(readPersonaFilter(["--persona"]).kind).toBe("invalid");
  });

  it("returns absent when no --persona flag is provided", () => {
    const filter = readPersonaFilter([]);
    expect(filter.kind).toBe("absent");
  });

  it("omitted persona yields empty personas array (baseline behavior)", () => {
    const selection = resolveSelection([
      "--model",
      AUTHORIZED_MODEL,
      "--fixture",
      TARGET_FIXTURE,
    ]);
    expect(selection.personas).toEqual([]);
  });

  it("--model + --fixture + --persona yields exactly one of each", () => {
    const selection = resolveSelection([
      "--model",
      AUTHORIZED_MODEL,
      "--fixture",
      TARGET_FIXTURE,
      "--persona",
      "human-locale",
    ]);
    expect(selection.models).toHaveLength(1);
    expect(selection.fixtures).toHaveLength(1);
    expect(selection.personas).toHaveLength(1);
    expect(selection.personas[0]).toBe("human-locale");
  });

  it("persona registry remains the source of truth for validation", () => {
    for (const slug of PERSONA_SLUGS) {
      expect(isValidPersonaSlug(slug)).toBe(true);
    }
    expect(isValidPersonaSlug("not-a-persona")).toBe(false);
  });

  it("rejects invalid persona even when valid model and fixture are supplied", () => {
    expect(() =>
      resolveSelection([
        "--model",
        AUTHORIZED_MODEL,
        "--fixture",
        TARGET_FIXTURE,
        "--persona",
        "bogus",
      ]),
    ).toThrow(/unknown persona/);
  });
});
