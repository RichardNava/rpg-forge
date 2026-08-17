import type { DiceRollResult } from "@repo/dice-engine";

export type DiceBoxRollPlan = {
  /** DiceBox values expected after its d10/d100 zero normalization. */
  expectedValues: number[];
  notation: string;
  visualDice: number;
};

type DiceBoxResult = {
  sets?: unknown;
};

function requireCompatibleResult(result: DiceRollResult, sides: number): void {
  if (result.dice.length === 0) {
    throw new Error("A 3D roll needs at least one die.");
  }
  if (result.dice.some((value) => value < 1 || value > sides)) {
    throw new Error("The dice result does not match the selected die.");
  }
}

/** Maps engine-owned values to DiceBox's documented `NdX@value,value` syntax. */
export function toDiceBoxRollPlan(
  result: DiceRollResult,
  sides: number,
): DiceBoxRollPlan {
  requireCompatibleResult(result, sides);

  if (sides === 100) {
    const tens = result.dice.map((value) => {
      const tens = Math.floor(value / 10) * 10;
      return tens === 0 ? 100 : tens;
    });
    const ones = result.dice.map((value) => value % 10);
    const notationValues = [...tens, ...ones];

    return {
      // DiceBox creates all d100 tens dice before its d10 ones dice.
      notation: `${result.dice.length}d100+${result.dice.length}d10@${notationValues.join(",")}`,
      // DiceBox reports a d10's zero face as 10, while notation uses 0.
      expectedValues: [
        ...tens,
        ...ones.map((value) => (value === 0 ? 10 : value)),
      ],
      visualDice: result.dice.length * 2,
    };
  }

  return {
    notation: `${result.dice.length}d${sides}@${result.dice.join(",")}`,
    expectedValues: [...result.dice],
    visualDice: result.dice.length,
  };
}

/** Reads only the completed face data returned by DiceBox. */
export function extractDiceBoxFaces(response: unknown): number[] | null {
  if (typeof response !== "object" || response === null) return null;
  const sets = (response as DiceBoxResult).sets;
  if (!Array.isArray(sets)) return null;

  const faces: number[] = [];
  for (const set of sets) {
    if (typeof set !== "object" || set === null) return null;
    const rolls = (set as { rolls?: unknown }).rolls;
    if (!Array.isArray(rolls)) return null;

    for (const roll of rolls) {
      if (typeof roll !== "object" || roll === null) return null;
      const value = (roll as { value?: unknown }).value;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        return null;
      }
      faces.push(value);
    }
  }

  return faces;
}

/** Validates only the completed face data returned by DiceBox. */
export function diceBoxFacesMatch(
  response: unknown,
  forcedFaces: readonly number[],
): boolean {
  const faces = extractDiceBoxFaces(response);
  return (
    faces !== null &&
    faces.length === forcedFaces.length &&
    faces.every((face, index) => face === forcedFaces[index])
  );
}
