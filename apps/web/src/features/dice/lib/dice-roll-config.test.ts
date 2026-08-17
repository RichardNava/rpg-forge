import {
  rollDice,
  type DiceRollResult,
  type RandomSource,
} from "@repo/dice-engine";
import { describe, expect, it } from "vitest";

import { countSuccesses } from "./dice-roll-config";

function roll(dice: number[], kept: number[], modifier = 0): DiceRollResult {
  const subtotal = kept.reduce((total, value) => total + value, 0);
  return {
    dice,
    kept,
    discarded: [],
    modifier,
    subtotal,
    total: subtotal + modifier,
  };
}

function fixedDice(...values: number[]): RandomSource {
  let index = 0;
  return {
    integer: () => values[index++] ?? 1,
  };
}

describe("countSuccesses", () => {
  it("returns null when no threshold is active", () => {
    expect(countSuccesses(roll([4, 5], [4, 5]), null, 6)).toBeNull();
  });

  it("returns zero when no kept die reaches the threshold", () => {
    expect(countSuccesses(roll([1, 2, 3], [1, 2, 3], 1), 5, 6)).toBe(0);
  });

  it("counts equality with the threshold after a positive modifier", () => {
    expect(countSuccesses(roll([3, 1], [3, 1], 2), 5, 6)).toBe(1);
  });

  it("counts several kept dice individually", () => {
    expect(countSuccesses(roll([3, 4, 5], [3, 4, 5], 1), 5, 6)).toBe(2);
  });

  it("applies negative modifiers to each kept die", () => {
    expect(countSuccesses(roll([6, 5, 4], [6, 5, 4], -2), 4, 6)).toBe(1);
  });

  it("handles numerical d100 thresholds", () => {
    expect(countSuccesses(roll([99], [99]), 99, 100)).toBe(1);
  });

  it("excludes discarded advantage dice from success counts", () => {
    const result = rollDice(
      { count: 2, sides: 20, keepHighest: 1 },
      fixedDice(20, 19),
    );

    expect(result.discarded).toEqual([19]);
    expect(countSuccesses(result, 19, 20)).toBe(1);
  });

  it("excludes discarded disadvantage dice from success counts", () => {
    const result = rollDice(
      { count: 2, sides: 20, keepLowest: 1 },
      fixedDice(20, 19),
    );

    expect(result.discarded).toEqual([20]);
    expect(countSuccesses(result, 19, 20)).toBe(1);
  });
});
