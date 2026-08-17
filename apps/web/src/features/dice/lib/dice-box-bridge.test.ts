import { describe, expect, it, vi } from "vitest";

import { DEFAULT_DICE_THEME } from "./dice-theme-options";
import { applyDiceBoxTheme } from "./dice-box-bridge";

function createDiceBoxBridge() {
  return {
    DiceColors: { colorsets: { fire: "other", white: "stale" } },
    sounds: true,
    theme_customColorset: "stale",
    loadTheme: vi.fn().mockResolvedValue(undefined),
    loadSounds: vi.fn().mockResolvedValue(undefined),
  };
}

describe("applyDiceBoxTheme", () => {
  it("refreshes texture and material changes within the same colorset", async () => {
    const diceBox = createDiceBoxBridge();

    await applyDiceBoxTheme(diceBox, {
      ...DEFAULT_DICE_THEME,
      texture: "marble",
      material: "metal",
    });
    diceBox.DiceColors.colorsets.white = "stale again";
    await applyDiceBoxTheme(diceBox, {
      ...DEFAULT_DICE_THEME,
      texture: "paper",
      material: "glass",
    });

    expect(diceBox.DiceColors.colorsets).toEqual({ fire: "other" });
    expect(diceBox.theme_customColorset).toBeNull();
    expect(diceBox.loadTheme).toHaveBeenNthCalledWith(1, {
      colorset: "white",
      texture: "marble",
      material: "metal",
    });
    expect(diceBox.loadTheme).toHaveBeenNthCalledWith(2, {
      colorset: "white",
      texture: "paper",
      material: "glass",
    });
  });

  it("updates sound state and only loads sounds when enabled", async () => {
    const diceBox = createDiceBoxBridge();

    await applyDiceBoxTheme(diceBox, {
      ...DEFAULT_DICE_THEME,
      soundEnabled: false,
    });

    expect(diceBox.sounds).toBe(false);
    expect(diceBox.loadSounds).not.toHaveBeenCalled();
  });
});
