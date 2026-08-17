import {
  MAX_DICE_PER_ROLL,
  MAX_MODIFIER,
  MIN_MODIFIER,
  parseDiceNotation,
  rollDice,
  rollNotation,
  type DiceRollResult,
} from "@repo/dice-engine";

import { DEFAULT_DICE_THEME, type DiceTheme } from "./dice-theme-options";

export const STANDARD_DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

export type DiceRollMode = "normal" | "advantage" | "disadvantage";

export type DiceRollConfiguration = {
  sides: (typeof STANDARD_DICE_SIDES)[number];
  count: number;
  modifier: number;
  rollMode: DiceRollMode;
  notation: string;
  notationOpen: boolean;
  visualOptionsOpen: boolean;
  successThreshold: number | null;
  theme: DiceTheme;
};

export type PreparedDiceRoll = {
  expression: string;
  result: DiceRollResult;
  sides: number;
  successCount: number | null;
  usesSupported3dDie: boolean;
};

export const INITIAL_DICE_CONFIGURATION: DiceRollConfiguration = {
  sides: 20,
  count: 1,
  modifier: 0,
  rollMode: "normal",
  notation: "2d6+3",
  notationOpen: false,
  visualOptionsOpen: false,
  successThreshold: null,
  theme: DEFAULT_DICE_THEME,
};

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function formatExpression(
  count: number,
  sides: number,
  modifier: number,
): string {
  return `${count}d${sides}${modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : modifier}`;
}

export function isValidSuccessThreshold(
  threshold: number | null,
  sides: number,
): threshold is number {
  return (
    threshold !== null &&
    Number.isSafeInteger(threshold) &&
    threshold > 0 &&
    threshold < sides
  );
}

/** Applies a roll modifier to each kept die when evaluating threshold successes. */
export function countSuccesses(
  result: DiceRollResult,
  threshold: number | null,
  sides: number,
): number | null {
  if (!isValidSuccessThreshold(threshold, sides)) return null;
  return result.kept.filter((value) => value + result.modifier >= threshold)
    .length;
}

export function prepareDiceRoll(
  configuration: DiceRollConfiguration,
): PreparedDiceRoll {
  if (configuration.notationOpen) {
    const parsed = parseDiceNotation(configuration.notation);
    const result = rollNotation(configuration.notation);
    return {
      expression: formatExpression(parsed.count, parsed.sides, parsed.modifier),
      result,
      sides: parsed.sides,
      successCount: countSuccesses(
        result,
        configuration.successThreshold,
        parsed.sides,
      ),
      usesSupported3dDie: STANDARD_DICE_SIDES.includes(
        parsed.sides as (typeof STANDARD_DICE_SIDES)[number],
      ),
    };
  }

  const count = configuration.rollMode === "normal" ? configuration.count : 2;
  const result =
    configuration.rollMode === "advantage"
      ? rollDice({
          count,
          sides: 20,
          modifier: configuration.modifier,
          keepHighest: 1,
        })
      : configuration.rollMode === "disadvantage"
        ? rollDice({
            count,
            sides: 20,
            modifier: configuration.modifier,
            keepLowest: 1,
          })
        : rollDice({
            count,
            sides: configuration.sides,
            modifier: configuration.modifier,
          });
  const sides = configuration.rollMode === "normal" ? configuration.sides : 20;

  return {
    expression: formatExpression(count, sides, configuration.modifier),
    result,
    sides,
    successCount: countSuccesses(result, configuration.successThreshold, sides),
    usesSupported3dDie: true,
  };
}

export { MAX_DICE_PER_ROLL, MAX_MODIFIER, MIN_MODIFIER };
