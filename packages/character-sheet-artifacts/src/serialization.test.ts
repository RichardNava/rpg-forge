import { describe, expect, it } from "vitest";
import {
  CharacterSheetArtifactError,
  parseStoredSpec,
  serializeSpec,
  type CharacterSheetArtifactErrorCode,
} from "./index.js";
import { buildBaseSpec } from "./spec-fixture.js";

function expectErrorCode(
  fn: () => unknown,
  code: CharacterSheetArtifactErrorCode,
): void {
  try {
    fn();
    throw new Error(`expected a ${code} error`);
  } catch (error) {
    expect(error).toBeInstanceOf(CharacterSheetArtifactError);
    expect((error as CharacterSheetArtifactError).code).toBe(code);
  }
}

describe("spec serialization", () => {
  it("round-trips a valid spec", () => {
    const spec = buildBaseSpec();
    const parsed = parseStoredSpec(serializeSpec(spec));
    expect(parsed).toEqual(spec);
  });

  it("rejects an invalid spec with invalid_spec", () => {
    const invalid = {
      ...buildBaseSpec(),
      pages: [],
    };
    expectErrorCode(() => serializeSpec(invalid as never), "invalid_spec");
  });

  it("rejects non-JSON storage payloads with corrupt_spec", () => {
    expectErrorCode(() => parseStoredSpec("{nope"), "corrupt_spec");
  });

  it("rejects structurally invalid storage payloads with corrupt_spec", () => {
    expectErrorCode(
      () => parseStoredSpec(JSON.stringify({ schemaVersion: "9" })),
      "corrupt_spec",
    );
  });

  it("never returns partial data from a corrupt payload", () => {
    const spec = buildBaseSpec();
    const payload = serializeSpec(spec);
    const broken = payload.replace('"mode":"player"', '"mode":"dm"');
    expectErrorCode(() => parseStoredSpec(broken), "corrupt_spec");
  });
});
