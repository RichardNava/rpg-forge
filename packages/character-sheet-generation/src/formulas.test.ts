import { describe, expect, it } from "vitest";
import {
  collectExpressionFieldKeys,
  compileCalculationExpression,
  CompileCalculationError,
} from "./formulas.js";
import type { CalculationExpression } from "./intermediate.js";

const keyToId = new Map([
  ["level", "field-level"],
  ["hp_bonus", "field-hp-bonus"],
]);

describe("compileCalculationExpression", () => {
  it("compiles literals and field references", () => {
    expect(
      compileCalculationExpression({ op: "literal", value: 3 }, keyToId),
    ).toEqual({ op: "literal", value: 3 });
    expect(
      compileCalculationExpression({ op: "field", fieldKey: "level" }, keyToId),
    ).toEqual({ op: "field", fieldId: "field-level" });
  });

  it("compiles binary and unary operators", () => {
    const expression: CalculationExpression = {
      op: "add",
      left: { op: "field", fieldKey: "level" },
      right: { op: "floor", value: { op: "literal", value: 2.5 } },
    };
    expect(compileCalculationExpression(expression, keyToId)).toEqual({
      op: "add",
      left: { op: "field", fieldId: "field-level" },
      right: { op: "floor", value: { op: "literal", value: 2.5 } },
    });
  });

  it("compiles min/max value lists", () => {
    const expression: CalculationExpression = {
      op: "max",
      values: [
        { op: "field", fieldKey: "level" },
        { op: "literal", value: 10 },
      ],
    };
    expect(compileCalculationExpression(expression, keyToId)).toEqual({
      op: "max",
      values: [
        { op: "field", fieldId: "field-level" },
        { op: "literal", value: 10 },
      ],
    });
  });

  it("compiles conditionals with resolved operands", () => {
    const expression: CalculationExpression = {
      op: "conditional",
      condition: {
        op: "gt",
        left: { op: "field", fieldKey: "level" },
        right: { op: "literal", value: 10 },
      },
      whenTrue: { op: "literal", value: 2 },
      whenFalse: { op: "literal", value: 1 },
    };
    expect(compileCalculationExpression(expression, keyToId)).toEqual({
      op: "conditional",
      condition: {
        op: "gt",
        left: { op: "field", fieldId: "field-level" },
        right: { op: "literal", value: 10 },
      },
      whenTrue: { op: "literal", value: 2 },
      whenFalse: { op: "literal", value: 1 },
    });
  });

  it("throws a structured error for an unknown field key", () => {
    const expression: CalculationExpression = {
      op: "field",
      fieldKey: "ghost",
    };
    expect(() => compileCalculationExpression(expression, keyToId)).toThrow(
      CompileCalculationError,
    );
    try {
      compileCalculationExpression(expression, keyToId);
    } catch (error) {
      expect(error).toBeInstanceOf(CompileCalculationError);
      expect((error as CompileCalculationError).details).toContain("ghost");
    }
  });
});

describe("collectExpressionFieldKeys", () => {
  it("collects every referenced field key in traversal order", () => {
    const expression: CalculationExpression = {
      op: "add",
      left: { op: "field", fieldKey: "level" },
      right: {
        op: "conditional",
        condition: {
          op: "eq",
          left: { op: "field", fieldKey: "hp_bonus" },
          right: { op: "literal", value: 0 },
        },
        whenTrue: { op: "literal", value: 1 },
        whenFalse: { op: "field", fieldKey: "level" },
      },
    };
    const keys: string[] = [];
    collectExpressionFieldKeys(expression, keys);
    expect(keys).toEqual(["level", "hp_bonus", "level"]);
  });

  it("collects nothing for literal-only expressions", () => {
    const keys: string[] = [];
    collectExpressionFieldKeys({ op: "literal", value: 1 }, keys);
    expect(keys).toEqual([]);
  });
});
