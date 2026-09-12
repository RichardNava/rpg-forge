import { describe, expect, it } from "vitest";
import {
  assertAuthorizedMatrix,
  CRITICAL_FIXTURE_IDS,
  describeMatrix,
  resolveExtractionMatrix,
} from "./matrix.js";

/**
 * Local preflight for the remote experiment: the resolved matrix must be
 * exactly ONE authorized model x the F1-F13 fixtures. Any drift aborts before
 * a single remote inference call.
 */
describe("extraction-validation matrix preflight", () => {
  it("resolves to exactly one authorized model", () => {
    const matrix = resolveExtractionMatrix();
    expect(matrix.model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
  });

  it("resolves to exactly the F1-F13 fixture set", () => {
    const matrix = resolveExtractionMatrix();
    expect(matrix.fixtures.map((fixture) => fixture.id)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
      "F9",
      "F10",
      "F11",
      "F12",
      "F13",
    ]);
  });

  it("asserts the pinned model and fixture set without throwing", () => {
    const matrix = resolveExtractionMatrix();
    expect(() => assertAuthorizedMatrix(matrix)).not.toThrow();
  });

  it("rejects an unauthorized model in the matrix", () => {
    expect(() =>
      assertAuthorizedMatrix({
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        fixtures: resolveExtractionMatrix().fixtures,
      }),
    ).toThrow(/unauthorized model/);
  });

  it("rejects a matrix missing or reordering fixtures", () => {
    const matrix = resolveExtractionMatrix();
    expect(() =>
      assertAuthorizedMatrix({
        ...matrix,
        fixtures: matrix.fixtures.slice(0, 5),
      }),
    ).toThrow(/expected exactly 13/);
    const shuffled = [
      matrix.fixtures[1]!,
      matrix.fixtures[0]!,
      ...matrix.fixtures.slice(2),
    ];
    expect(() =>
      assertAuthorizedMatrix({ ...matrix, fixtures: shuffled }),
    ).toThrow(/fixture order/);
  });

  it("rejects a matrix without exactly one injection probe", () => {
    const matrix = resolveExtractionMatrix();
    const noInjection = matrix.fixtures.map((fixture) =>
      fixture.id === "F13" ? { ...fixture, injection: false } : fixture,
    );
    expect(() =>
      assertAuthorizedMatrix({ ...matrix, fixtures: noInjection }),
    ).toThrow(/exactly one injection probe/);
  });

  it("keeps the critical set exactly F1 F2 F6 F8 F10 F11 F12", () => {
    expect(CRITICAL_FIXTURE_IDS).toEqual([
      "F1",
      "F2",
      "F6",
      "F8",
      "F10",
      "F11",
      "F12",
    ]);
    const matrix = resolveExtractionMatrix();
    expect(() => assertAuthorizedMatrix(matrix)).not.toThrow();
  });

  it("renders a human-readable matrix description", () => {
    const text = describeMatrix(resolveExtractionMatrix());
    expect(text).toContain("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(text).toContain("F13*");
  });
});
