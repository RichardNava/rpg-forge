import type { ProposedGenerationInstruction } from "@repo/character-sheet-generation";

/**
 * Comparable, ordered snapshot of one proposed instruction. Labels stay at the
 * authored level (the model emits labels, never canonical keys), which is
 * exactly the surface the fixtures must agree with. A null `category` on an ADD
 * signature means "any category is accepted" so the injection probe (which has
 * no grounded fields) does not over-constrain an otherwise valid add.
 */
export type ExtractionSignature =
  | {
      kind: "field";
      op: "add";
      label: string;
      category: "mechanical" | "identity" | null;
    }
  | { kind: "field"; op: "remove"; targetLabel: string }
  | { kind: "field"; op: "rename"; sourceLabel: string; newLabel: string }
  | {
      kind: "field";
      op: "replace";
      sourceLabel: string;
      replacementLabel: string;
    }
  | {
      kind: "field";
      op: "constrain";
      targetLabel: string;
      min: number | null;
      max: number | null;
    }
  | {
      kind: "field";
      op: "set_value";
      targetLabel: string;
      value: number | string | null;
    }
  | { kind: "name"; value: string }
  | { kind: "portrait" };

export function instructionToSignature(
  instruction: ProposedGenerationInstruction,
): ExtractionSignature {
  if (instruction.op === "field") {
    const override = instruction.override;
    switch (override.op) {
      case "add":
        return {
          kind: "field",
          op: "add",
          label: override.label,
          category: override.category ?? null,
        };
      case "remove":
        return {
          kind: "field",
          op: "remove",
          targetLabel: override.targetLabel,
        };
      case "rename":
        return {
          kind: "field",
          op: "rename",
          sourceLabel: override.sourceLabel,
          newLabel: override.newLabel,
        };
      case "replace":
        return {
          kind: "field",
          op: "replace",
          sourceLabel: override.sourceLabel,
          replacementLabel: override.replacementLabel,
        };
      case "constrain":
        return {
          kind: "field",
          op: "constrain",
          targetLabel: override.targetLabel,
          min: override.min ?? null,
          max: override.max ?? null,
        };
      case "set_value":
        return {
          kind: "field",
          op: "set_value",
          targetLabel: override.targetLabel,
          value: override.value,
        };
    }
  }
  if (instruction.op === "set_character_name") {
    return { kind: "name", value: instruction.value };
  }
  return { kind: "portrait" };
}

/**
 * Re-builds a valid emission-side instruction from a fixture-expected
 * signature. Fixtures self-validate by round-tripping their expectations
 * through the canonical instruction schema, so a malformed expectation fails
 * locally before any remote call.
 */
export function signatureToInstruction(
  signature: ExtractionSignature,
  portraitDescription = "a requested NPC portrait",
): ProposedGenerationInstruction {
  if (signature.kind === "field") {
    switch (signature.op) {
      case "add":
        return {
          op: "field",
          override: {
            op: "add",
            label: signature.label,
            ...(signature.category === null
              ? {}
              : { category: signature.category }),
          },
        };
      case "remove":
        return {
          op: "field",
          override: { op: "remove", targetLabel: signature.targetLabel },
        };
      case "rename":
        return {
          op: "field",
          override: {
            op: "rename",
            sourceLabel: signature.sourceLabel,
            newLabel: signature.newLabel,
          },
        };
      case "replace":
        return {
          op: "field",
          override: {
            op: "replace",
            sourceLabel: signature.sourceLabel,
            replacementLabel: signature.replacementLabel,
          },
        };
      case "constrain":
        return {
          op: "field",
          override: {
            op: "constrain",
            targetLabel: signature.targetLabel,
            ...(signature.min !== null ? { min: signature.min } : {}),
            ...(signature.max !== null ? { max: signature.max } : {}),
          },
        };
      case "set_value":
        return {
          op: "field",
          override: {
            op: "set_value",
            targetLabel: signature.targetLabel,
            value: signature.value,
          },
        };
    }
  }
  if (signature.kind === "name") {
    return { op: "set_character_name", value: signature.value };
  }
  return {
    op: "request_npc_portrait",
    intent: {
      requestedVia: "contextInstructions",
      description: portraitDescription,
    },
  };
}

function comparableForm(
  signature: ExtractionSignature,
  dropCategory: boolean,
): unknown {
  if (signature.kind === "portrait") {
    return { kind: "portrait" };
  }
  if (signature.kind === "name") {
    return { kind: "name", value: signature.value };
  }
  const base = { kind: "field", op: signature.op } as const;
  switch (signature.op) {
    case "add":
      return {
        ...base,
        label: signature.label,
        ...(dropCategory ? {} : { category: signature.category }),
      };
    case "remove":
      return { ...base, targetLabel: signature.targetLabel };
    case "rename":
      return {
        ...base,
        sourceLabel: signature.sourceLabel,
        newLabel: signature.newLabel,
      };
    case "replace":
      return {
        ...base,
        sourceLabel: signature.sourceLabel,
        replacementLabel: signature.replacementLabel,
      };
    case "constrain":
      return {
        ...base,
        targetLabel: signature.targetLabel,
        min: signature.min,
        max: signature.max,
      };
    case "set_value":
      return {
        ...base,
        targetLabel: signature.targetLabel,
        value: signature.value,
      };
  }
}

/**
 * Structural equality of a produced signature against an expected one.
 * Portrait expectations match any portrait (details are scored separately by
 * token coverage), and an ADD with a null expected category accepts any
 * category.
 */
export function signatureMatches(
  actual: ExtractionSignature,
  expected: ExtractionSignature,
): boolean {
  if (actual.kind === "portrait" && expected.kind === "portrait") {
    return true;
  }
  if (actual.kind !== expected.kind) {
    return false;
  }
  if (actual.kind === "name") {
    return actual.value === (expected as { value: string }).value;
  }
  if (actual.kind === "field" && expected.kind === "field") {
    if (actual.op !== expected.op) {
      return false;
    }
    const dropCategory = expected.op === "add" && expected.category === null;
    return (
      JSON.stringify(comparableForm(actual, dropCategory)) ===
      JSON.stringify(comparableForm(expected, dropCategory))
    );
  }
  return false;
}

/** Canonical op token used by fixture-level op prohibitions and kind checks. */
export function signatureOpToken(signature: ExtractionSignature): string {
  return signature.kind === "field" ? `field.${signature.op}` : signature.kind;
}
