import { z } from "zod";
import {
  createDeterministicRandom,
  stableNameSeed,
} from "./deterministic.js";
import {
  ThreatLevelSchema,
  type ThreatLevel,
} from "./final-generation-contract.js";
import {
  THREAT_BIAS,
  NEUTRAL_THREAT_BIAS,
  THREAT_BIAS_WINDOW,
} from "./final-construction.js";

/**
 * Final resolved values result.
 * Contains the resolved values and which keys were generated.
 */
export const FinalResolvedValuesV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  values: z.record(z.string(), z.unknown()),
  generatedKeys: z.array(z.string()),
});
export type FinalResolvedValuesV1 = z.infer<typeof FinalResolvedValuesV1Schema>;

/**
 * Resolves final values for a confirmed draft.
 *
 * Priority (14.14): explicit user values > validated AI assignments driven by
 * npcInstructions > threat/default deterministic fallback. Remaining
 * unsupported blanks stay blank.
 *
 * PC: preserves explicit values, blanks remain absent.
 * NPC: preserves explicit values, applies validated AI assignments to blank
 * fields, then generates bounded numeric values for still-blank fields with
 * complete min/max ranges.
 *
 * Does not mutate the input draft. AI assignments never overwrite an explicit
 * value: a conflicting assignment is skipped defensively (the validation
 * layer rejects such plans before resolution).
 */
export function resolveFinalValues(
  draft: {
    mode: "pc" | "npc";
    fields: readonly {
      key: string;
      label: string;
      type: string;
      min?: number | undefined;
      max?: number | undefined;
    }[];
    values: Record<string, unknown>;
  },
  options: {
    threat?: ThreatLevel | null;
    seed: string;
    authoredAssignments?: readonly { key: string; value: unknown }[] | null;
  },
): FinalResolvedValuesV1 {
  const { mode, fields, values } = draft;
  const { threat, seed } = options;

  const resolvedValues: Record<string, unknown> = { ...values };
  const generatedKeys: string[] = [];

  if (mode === "pc") {
    // PC: no generation, all blanks remain absent
    // Just validate explicit values are in range
    for (const field of fields) {
      const value = values[field.key];
      if (value !== undefined && value !== null) {
        if (field.type === "number" && field.min !== undefined && field.max !== undefined) {
          const numValue = Number(value);
          if (Number.isNaN(numValue) || numValue < field.min || numValue > field.max) {
            throw new Error(
              `Explicit value ${value} of field "${field.label}" falls outside its permitted range ${field.min}..${field.max}`,
            );
          }
        }
      }
    }
    return {
      schemaVersion: "1",
      values: resolvedValues,
      generatedKeys: [],
    };
  }

  // NPC mode
  if (!threat) {
    throw new Error("NPC draft requires threat for final value resolution");
  }

  const bias = THREAT_BIAS[threat] ?? NEUTRAL_THREAT_BIAS;
  const fieldKeys = new Set(fields.map((field) => field.key));

  // AI assignments (npcInstructions) apply only to still-blank known fields.
  // Content generation is style-independent: no style reaches this resolver.
  for (const assignment of options.authoredAssignments ?? []) {
    if (!fieldKeys.has(assignment.key)) continue;
    const current = resolvedValues[assignment.key];
    if (current !== undefined && current !== null) continue;
    resolvedValues[assignment.key] = assignment.value;
    generatedKeys.push(assignment.key);
  }

  for (const field of fields) {
    const value = resolvedValues[field.key];

    // Explicit value provided - preserve it
    if (value !== undefined && value !== null) {
      if (field.type === "number" && field.min !== undefined && field.max !== undefined) {
        const numValue = Number(value);
        if (Number.isNaN(numValue) || numValue < field.min || numValue > field.max) {
          throw new Error(
            `Explicit value ${value} of field "${field.label}" falls outside its permitted range ${field.min}..${field.max}`,
          );
        }
      }
      continue;
    }

    // Blank field - only generate for bounded numeric fields
    if (
      field.type === "number" &&
      field.min !== undefined &&
      field.max !== undefined
    ) {
      // Fixed value (min === max) - use the fixed value
      if (field.min === field.max) {
        resolvedValues[field.key] = field.min;
        // Fixed constraints are not "generated" in the same sense as sampled values
        continue;
      }

      // Range to sample from
      const random = createDeterministicRandom(
        stableNameSeed(`${seed}|${threat}|${field.key}`),
      );
      const low = Math.max(0, bias - THREAT_BIAS_WINDOW);
      const high = Math.min(1, bias + THREAT_BIAS_WINDOW);
      const t = low + random() * (high - low);
      const raw = field.min + t * (field.max - field.min);
      const generatedValue = Math.round(raw);
      const clampedValue = Math.min(field.max, Math.max(field.min, generatedValue));

      resolvedValues[field.key] = clampedValue;
      generatedKeys.push(field.key);
    }
    // Non-numeric or unbounded fields remain blank (absent from resolved values)
  }

  return {
    schemaVersion: "1",
    values: resolvedValues,
    generatedKeys,
  };
}

/**
 * Validates that a draft is eligible for final value resolution.
 */
export function assertFinalValueResolutionEligible(
  draft: { mode: "pc" | "npc"; confirmed: boolean },
  threat?: ThreatLevel | null,
): void {
  if (!draft.confirmed) {
    throw new Error("Draft must be confirmed for final value resolution");
  }
  if (draft.mode === "npc" && !threat) {
    throw new Error("NPC draft requires threat for final value resolution");
  }
}