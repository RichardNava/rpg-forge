import { describe, expect, it, vi } from "vitest";

import {
  CryptoRandomSource,
  DiceValidationError,
  MAX_DICE_PER_ROLL,
  MAX_MODIFIER,
  MAX_NOTATION_LENGTH,
  MIN_MODIFIER,
  parseDiceNotation,
  rollDie,
  rollDice,
  rollWithAdvantage,
  rollWithDisadvantage,
  type RandomSource,
  validateDiceRollRequest,
} from "./index";

function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { integer: () => values[index++]! };
}

describe("validation", () => {
  it.each([
    [{ count: 0, sides: 6 }],
    [{ count: 21, sides: 6 }],
    [{ count: 1, sides: 1 }],
    [{ count: 1, sides: 1001 }],
    [{ count: Number.NaN, sides: 6 }],
    [{ count: Infinity, sides: 6 }],
    [{ count: 1.5, sides: 6 }],
    [{ count: 1, sides: 6, modifier: MIN_MODIFIER - 1 }],
    [{ count: 1, sides: 6, modifier: MAX_MODIFIER + 1 }],
    [{ count: 2, sides: 6, keepHighest: 0 }],
    [{ count: 2, sides: 6, keepLowest: 3 }],
    [{ count: 2, sides: 6, keepHighest: 1, keepLowest: 1 }],
    [null],
  ])("rejects invalid requests: %o", (request) => {
    expect(() => validateDiceRollRequest(request)).toThrow(DiceValidationError);
  });

  it("accepts each inclusive domain boundary", () => {
    expect(() =>
      validateDiceRollRequest({
        count: MAX_DICE_PER_ROLL,
        sides: 1000,
        modifier: MAX_MODIFIER,
      }),
    ).not.toThrow();
    expect(() =>
      validateDiceRollRequest({ count: 1, sides: 2, modifier: MIN_MODIFIER }),
    ).not.toThrow();
  });
});

describe("rolls", () => {
  it("returns a structured single-die result", () => {
    expect(rollDice({ count: 1, sides: 20 }, sequence(17))).toEqual({
      dice: [17],
      kept: [17],
      discarded: [],
      modifier: 0,
      subtotal: 17,
      total: 17,
    });
  });

  it("supports multiple dice and positive or negative modifiers", () => {
    expect(
      rollDice({ count: 3, sides: 6, modifier: 4 }, sequence(1, 3, 6)),
    ).toMatchObject({
      dice: [1, 3, 6],
      kept: [1, 3, 6],
      subtotal: 10,
      total: 14,
    });
    expect(
      rollDice({ count: 2, sides: 8, modifier: -2 }, sequence(5, 4)),
    ).toMatchObject({ subtotal: 9, total: 7 });
  });

  it("keeps highest values, preserves input order, and breaks ties by first roll", () => {
    expect(
      rollDice({ count: 4, sides: 6, keepHighest: 2 }, sequence(3, 6, 6, 2)),
    ).toEqual({
      dice: [3, 6, 6, 2],
      kept: [6, 6],
      discarded: [3, 2],
      modifier: 0,
      subtotal: 12,
      total: 12,
    });
  });

  it("keeps lowest values and breaks ties by first roll", () => {
    expect(
      rollDice({ count: 4, sides: 6, keepLowest: 2 }, sequence(2, 2, 5, 1)),
    ).toEqual({
      dice: [2, 2, 5, 1],
      kept: [2, 1],
      discarded: [2, 5],
      modifier: 0,
      subtotal: 3,
      total: 3,
    });
  });

  it("expresses advantage and disadvantage through general keep operations", () => {
    expect(rollWithAdvantage(sequence(4, 19))).toEqual(
      rollDice({ count: 2, sides: 20, keepHighest: 1 }, sequence(4, 19)),
    );
    expect(rollWithDisadvantage(sequence(4, 19))).toEqual(
      rollDice({ count: 2, sides: 20, keepLowest: 1 }, sequence(4, 19)),
    );
  });

  it("rejects random values outside the requested inclusive range", () => {
    expect(() => rollDie(6, sequence(7))).toThrow(DiceValidationError);
  });
});

describe("notation", () => {
  it.each([
    ["d20", { count: 1, sides: 20, modifier: 0 }],
    ["1d20", { count: 1, sides: 20, modifier: 0 }],
    ["2d6+3", { count: 2, sides: 6, modifier: 3 }],
    ["2d6 + 3", { count: 2, sides: 6, modifier: 3 }],
    ["4D8-2", { count: 4, sides: 8, modifier: -2 }],
  ])("parses %s", (notation, expected) =>
    expect(parseDiceNotation(notation)).toEqual(expected),
  );

  it.each([
    "2d6+1d8",
    "4d6kh3",
    "2d",
    "d1",
    "21d6",
    "2d6++3",
    "",
    "x".repeat(MAX_NOTATION_LENGTH + 1),
  ])("rejects unsupported notation %s", (notation) => {
    expect(() => parseDiceNotation(notation)).toThrow(DiceValidationError);
  });
});

describe("CryptoRandomSource", () => {
  it("uses rejection sampling before mapping an accepted unsigned integer", () => {
    const getRandomValues = vi.fn((values: Uint32Array) => {
      values[0] = getRandomValues.mock.calls.length === 1 ? 0xffffffff : 7;
      return values;
    });
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues },
    });
    try {
      expect(new CryptoRandomSource().integer(1, 3)).toBe(2);
      expect(getRandomValues).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  it("always requests inclusive bounds from an injected source", () => {
    const integer = vi.fn(() => 6);
    expect(rollDie(6, { integer })).toBe(6);
    expect(integer).toHaveBeenCalledWith(1, 6);
  });
});
