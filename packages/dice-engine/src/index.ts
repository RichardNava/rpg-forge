export const MAX_DICE_PER_ROLL = 20;
export const MIN_DIE_SIDES = 2;
export const MAX_DIE_SIDES = 1000;
export const MIN_MODIFIER = -10000;
export const MAX_MODIFIER = 10000;
export const MAX_NOTATION_LENGTH = 64;

export interface RandomSource {
  integer(min: number, max: number): number;
}

export interface DiceRollRequest {
  count: number;
  sides: number;
  modifier?: number;
  keepHighest?: number;
  keepLowest?: number;
}

export interface DiceRollResult {
  dice: number[];
  kept: number[];
  discarded: number[];
  modifier: number;
  subtotal: number;
  total: number;
}

export interface DiceNotation {
  count: number;
  sides: number;
  modifier: number;
}

export class DiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceValidationError";
  }
}

function assertIntegerInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new DiceValidationError(
      `${name} must be a safe integer between ${minimum} and ${maximum}.`,
    );
  }
}

export function validateDiceRollRequest(
  request: unknown,
): asserts request is DiceRollRequest {
  if (
    typeof request !== "object" ||
    request === null ||
    Array.isArray(request)
  ) {
    throw new DiceValidationError("A dice roll request must be an object.");
  }

  const candidate = request as Record<string, unknown>;
  assertIntegerInRange(candidate.count, "count", 1, MAX_DICE_PER_ROLL);
  assertIntegerInRange(candidate.sides, "sides", MIN_DIE_SIDES, MAX_DIE_SIDES);

  if (candidate.modifier !== undefined) {
    assertIntegerInRange(
      candidate.modifier,
      "modifier",
      MIN_MODIFIER,
      MAX_MODIFIER,
    );
  }

  if (
    candidate.keepHighest !== undefined &&
    candidate.keepLowest !== undefined
  ) {
    throw new DiceValidationError(
      "Choose keepHighest or keepLowest, not both.",
    );
  }

  if (candidate.keepHighest !== undefined) {
    assertIntegerInRange(
      candidate.keepHighest,
      "keepHighest",
      1,
      candidate.count,
    );
  }

  if (candidate.keepLowest !== undefined) {
    assertIntegerInRange(
      candidate.keepLowest,
      "keepLowest",
      1,
      candidate.count,
    );
  }
}

/** Uses Web Crypto with rejection sampling, so modulo is only applied to an unbiased range. */
export class CryptoRandomSource implements RandomSource {
  integer(min: number, max: number): number {
    assertIntegerInRange(min, "min", 0, 0xffffffff);
    assertIntegerInRange(max, "max", min, 0xffffffff);
    const range = max - min + 1;
    const sampleSpace = 0x1_0000_0000;
    const acceptedCeiling = Math.floor(sampleSpace / range) * range;
    const values = new Uint32Array(1);

    do {
      globalThis.crypto.getRandomValues(values);
    } while (values[0]! >= acceptedCeiling);

    return min + (values[0]! % range);
  }
}

export const cryptoRandomSource = new CryptoRandomSource();

function assertRandomValue(
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DiceValidationError(
      "RandomSource returned a value outside its requested range.",
    );
  }
}

export function rollDie(
  sides: number,
  randomSource: RandomSource = cryptoRandomSource,
): number {
  assertIntegerInRange(sides, "sides", MIN_DIE_SIDES, MAX_DIE_SIDES);
  const value = randomSource.integer(1, sides);
  assertRandomValue(value, 1, sides);
  return value;
}

export function rollDice(
  request: DiceRollRequest,
  randomSource: RandomSource = cryptoRandomSource,
): DiceRollResult {
  validateDiceRollRequest(request);
  const modifier = request.modifier ?? 0;
  const dice = Array.from({ length: request.count }, () =>
    rollDie(request.sides, randomSource),
  );
  const keepCount = request.keepHighest ?? request.keepLowest ?? request.count;
  const orderedIndexes = dice
    .map((value, index) => ({ value, index }))
    .sort((left, right) => {
      const byValue =
        request.keepLowest === undefined
          ? right.value - left.value
          : left.value - right.value;
      return byValue || left.index - right.index;
    });
  const keptIndexes = new Set(
    orderedIndexes.slice(0, keepCount).map(({ index }) => index),
  );
  const kept = dice.filter((_, index) => keptIndexes.has(index));
  const discarded = dice.filter((_, index) => !keptIndexes.has(index));
  const subtotal = kept.reduce((sum, value) => sum + value, 0);

  return {
    dice,
    kept,
    discarded,
    modifier,
    subtotal,
    total: subtotal + modifier,
  };
}

export function rollWithAdvantage(randomSource?: RandomSource): DiceRollResult {
  return rollDice({ count: 2, sides: 20, keepHighest: 1 }, randomSource);
}

export function rollWithDisadvantage(
  randomSource?: RandomSource,
): DiceRollResult {
  return rollDice({ count: 2, sides: 20, keepLowest: 1 }, randomSource);
}

export function parseDiceNotation(notation: unknown): DiceNotation {
  if (
    typeof notation !== "string" ||
    notation.length === 0 ||
    notation.length > MAX_NOTATION_LENGTH
  ) {
    throw new DiceValidationError(
      "Dice notation must be a non-empty, bounded string.",
    );
  }

  const match = /^\s*(\d*)\s*[dD]\s*(\d+)\s*([+-]\s*\d+)?\s*$/.exec(notation);
  if (!match) {
    throw new DiceValidationError(
      "Dice notation must use the form NdX, optionally with + or - a modifier.",
    );
  }

  const count = match[1] === "" ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  const modifier =
    match[3] === undefined ? 0 : Number(match[3].replaceAll(/\s/g, ""));
  const parsed = { count, sides, modifier };
  validateDiceRollRequest(parsed);
  return parsed;
}

export function rollNotation(
  notation: string,
  randomSource?: RandomSource,
): DiceRollResult {
  return rollDice(parseDiceNotation(notation), randomSource);
}
