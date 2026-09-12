import { AUTHORIZED_MODEL } from "./config.js";
import {
  EXTRACTION_VALIDATION_FIXTURES,
  type ExtractionValidationFixture,
} from "./fixtures.js";

export interface ExtractionMatrix {
  readonly model: string;
  readonly fixtures: readonly ExtractionValidationFixture[];
}

const EXPECTED_FIXTURE_IDS = [
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
] as const;

export const CRITICAL_FIXTURE_IDS = [
  "F1",
  "F2",
  "F6",
  "F8",
  "F10",
  "F11",
  "F12",
] as const satisfies readonly ExtractionValidationFixture["id"][];

/**
 * The experiment matrix is exactly one authorized model and the full F1-F13
 * fixture set. Resolution is a constant by design: 2C2B is a scoped, pinned
 * observation, not a general benchmark CLI.
 */
export function resolveExtractionMatrix(): ExtractionMatrix {
  return {
    model: AUTHORIZED_MODEL,
    fixtures: EXTRACTION_VALIDATION_FIXTURES,
  };
}

/**
 * Fails locally before any remote call if the matrix ever drifts from exactly
 * 1 model x the F1-F13 fixtures. Extra models or fixtures STOP the run.
 */
export function assertAuthorizedMatrix(matrix: ExtractionMatrix): void {
  if (matrix.model !== AUTHORIZED_MODEL) {
    throw new Error(
      `Matrix would run unauthorized model "${matrix.model}"; expected exactly "${AUTHORIZED_MODEL}".`,
    );
  }
  const ids = matrix.fixtures.map((fixture) => fixture.id);
  if (ids.length !== EXPECTED_FIXTURE_IDS.length) {
    throw new Error(
      `Matrix has ${ids.length} fixtures; expected exactly ${EXPECTED_FIXTURE_IDS.length} (F1-F13).`,
    );
  }
  for (const [index, expectedId] of EXPECTED_FIXTURE_IDS.entries()) {
    if (ids[index] !== expectedId) {
      throw new Error(
        `Matrix fixture order is wrong at index ${index}: expected ${expectedId}, got ${ids[index]}.`,
      );
    }
  }
  const injectionCount = matrix.fixtures.filter(
    (fixture) => fixture.injection,
  ).length;
  if (injectionCount !== 1) {
    throw new Error(
      `Matrix must contain exactly one injection probe (F13); got ${injectionCount}.`,
    );
  }
  const criticalIds = matrix.fixtures
    .filter((fixture) => fixture.critical)
    .map((fixture) => fixture.id);
  if (
    criticalIds.length !== CRITICAL_FIXTURE_IDS.length ||
    CRITICAL_FIXTURE_IDS.some((id) => !criticalIds.includes(id))
  ) {
    throw new Error(
      `Critical fixture set must be exactly ${CRITICAL_FIXTURE_IDS.join(", ")}; got ${criticalIds.join(", ")}.`,
    );
  }
}

export function describeMatrix(matrix: ExtractionMatrix): string {
  const fixtureLine = matrix.fixtures
    .map(
      (fixture) =>
        `${fixture.id}${fixture.injection ? "*" : ""}${fixture.critical ? "!" : ""}`,
    )
    .join(", ");
  return [
    `Resolved experiment matrix (${matrix.fixtures.length} fixtures x 1 model):`,
    `  model:    ${matrix.model}`,
    `  fixtures: ${fixtureLine}`,
    `  (* = injection probe, ! = critical)`,
  ].join("\n");
}
