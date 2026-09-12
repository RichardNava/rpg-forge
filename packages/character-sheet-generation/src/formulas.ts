import type { Formula } from "@repo/character-sheet-schema";
import type { CalculationExpression } from "./intermediate.js";

/**
 * Maps a safe symbolic calculation expression onto the canonical Formula AST.
 * `fieldKeyToId` resolves every symbolic reference; the caller guarantees every
 * referenced key exists before this is invoked, so an unknown key here is an
 * internal invariant violation (the compiler fails the generation, never the
 * provider request).
 *
 * Depth is already bounded by the intermediate schema (MAX_CALC_AST_DEPTH), so
 * recursion cannot exhaust the stack.
 */
export function compileCalculationExpression(
  expression: CalculationExpression,
  fieldKeyToId: ReadonlyMap<string, string>,
): Formula {
  switch (expression.op) {
    case "literal":
      return { op: "literal", value: expression.value };
    case "field": {
      const fieldId = fieldKeyToId.get(expression.fieldKey);
      if (fieldId === undefined) {
        throw new CompileCalculationError(
          `Calculated expression references unknown field "${expression.fieldKey}".`,
        );
      }
      return { op: "field", fieldId };
    }
    case "add":
      return {
        op: "add",
        left: compileCalculationExpression(expression.left, fieldKeyToId),
        right: compileCalculationExpression(expression.right, fieldKeyToId),
      };
    case "subtract":
      return {
        op: "subtract",
        left: compileCalculationExpression(expression.left, fieldKeyToId),
        right: compileCalculationExpression(expression.right, fieldKeyToId),
      };
    case "multiply":
      return {
        op: "multiply",
        left: compileCalculationExpression(expression.left, fieldKeyToId),
        right: compileCalculationExpression(expression.right, fieldKeyToId),
      };
    case "divide":
      return {
        op: "divide",
        left: compileCalculationExpression(expression.left, fieldKeyToId),
        right: compileCalculationExpression(expression.right, fieldKeyToId),
      };
    case "min":
      return {
        op: "min",
        values: expression.values.map((value) =>
          compileCalculationExpression(value, fieldKeyToId),
        ),
      };
    case "max":
      return {
        op: "max",
        values: expression.values.map((value) =>
          compileCalculationExpression(value, fieldKeyToId),
        ),
      };
    case "floor":
      return {
        op: "floor",
        value: compileCalculationExpression(expression.value, fieldKeyToId),
      };
    case "ceil":
      return {
        op: "ceil",
        value: compileCalculationExpression(expression.value, fieldKeyToId),
      };
    case "round":
      return {
        op: "round",
        value: compileCalculationExpression(expression.value, fieldKeyToId),
      };
    case "conditional":
      return {
        op: "conditional",
        condition: {
          op: expression.condition.op,
          left: compileCalculationExpression(
            expression.condition.left,
            fieldKeyToId,
          ),
          right: compileCalculationExpression(
            expression.condition.right,
            fieldKeyToId,
          ),
        },
        whenTrue: compileCalculationExpression(
          expression.whenTrue,
          fieldKeyToId,
        ),
        whenFalse: compileCalculationExpression(
          expression.whenFalse,
          fieldKeyToId,
        ),
      };
  }
}

/**
 * Collects every symbolic field key referenced by an expression. Used to detect
 * cycles before compilation and to validate references against the field index.
 */
export function collectExpressionFieldKeys(
  expression: CalculationExpression,
  keys: string[],
): void {
  switch (expression.op) {
    case "literal":
      return;
    case "field":
      keys.push(expression.fieldKey);
      return;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      collectExpressionFieldKeys(expression.left, keys);
      collectExpressionFieldKeys(expression.right, keys);
      return;
    case "min":
    case "max":
      for (const value of expression.values) {
        collectExpressionFieldKeys(value, keys);
      }
      return;
    case "floor":
    case "ceil":
    case "round":
      collectExpressionFieldKeys(expression.value, keys);
      return;
    case "conditional":
      collectExpressionFieldKeys(expression.condition.left, keys);
      collectExpressionFieldKeys(expression.condition.right, keys);
      collectExpressionFieldKeys(expression.whenTrue, keys);
      collectExpressionFieldKeys(expression.whenFalse, keys);
      return;
  }
}

export class CompileCalculationError extends Error {
  readonly details: string;

  constructor(details: string) {
    super(details);
    this.name = "CompileCalculationError";
    this.details = details;
  }
}
