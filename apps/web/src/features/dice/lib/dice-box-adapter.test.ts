import { describe, expect, it } from "vitest";

import { diceBoxFacesMatch, toDiceBoxRollPlan } from "./dice-box-adapter";

describe("toDiceBoxRollPlan", () => {
  it("serializes engine-owned standard dice as forced DiceBox faces", () => {
    const plan = toDiceBoxRollPlan(
      {
        dice: [4, 2, 6, 1],
        kept: [4, 2, 6, 1],
        discarded: [],
        modifier: 0,
        subtotal: 13,
        total: 13,
      },
      6,
    );

    expect(plan).toEqual({
      notation: "4d6@4,2,6,1",
      expectedValues: [4, 2, 6, 1],
      visualDice: 4,
    });
  });

  it.each([
    [1, [100, 1], [100, 1]],
    [10, [10, 0], [10, 10]],
    [37, [30, 7], [30, 7]],
    [99, [90, 9], [90, 9]],
    [100, [100, 0], [100, 10]],
  ])(
    "maps d100 result %i to percentile physical dice",
    (value, notationFaces, expectedValues) => {
      const plan = toDiceBoxRollPlan(
        {
          dice: [value],
          kept: [value],
          discarded: [],
          modifier: 0,
          subtotal: value,
          total: value,
        },
        100,
      );

      expect(plan.expectedValues).toEqual(expectedValues);
      expect(plan.notation).toBe(`1d100+1d10@${notationFaces.join(",")}`);
      expect(plan.visualDice).toBe(2);
    },
  );

  it("keeps multi-d100 faces in engine order", () => {
    const plan = toDiceBoxRollPlan(
      {
        dice: [37, 100],
        kept: [37, 100],
        discarded: [],
        modifier: 0,
        subtotal: 137,
        total: 137,
      },
      100,
    );

    expect(plan).toMatchObject({
      notation: "2d100+2d10@30,100,7,0",
      expectedValues: [30, 100, 7, 10],
      visualDice: 4,
    });
    expect(
      diceBoxFacesMatch(
        {
          sets: [
            { rolls: [{ value: 30 }, { value: 100 }] },
            { rolls: [{ value: 7 }, { value: 10 }] },
          ],
        },
        plan.expectedValues,
      ),
    ).toBe(true);
  });
});

describe("diceBoxFacesMatch", () => {
  it("accepts only exact completed faces in DiceBox's documented result shape", () => {
    expect(
      diceBoxFacesMatch(
        { sets: [{ rolls: [{ value: 4 }, { value: 2 }] }] },
        [4, 2],
      ),
    ).toBe(true);
    expect(
      diceBoxFacesMatch(
        { sets: [{ rolls: [{ value: 4 }, { value: 1 }] }] },
        [4, 2],
      ),
    ).toBe(false);
    expect(
      diceBoxFacesMatch({ sets: [{ rolls: [{ value: "4" }] }] }, [4]),
    ).toBe(false);
  });
});
