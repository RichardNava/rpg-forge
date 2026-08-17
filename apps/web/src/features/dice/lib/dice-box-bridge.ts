import { resolveDiceBoxTexture, type DiceTheme } from "./dice-theme-options";

export type DiceBoxThemeBridge = {
  DiceColors: { colorsets: Record<string, unknown> };
  sounds: boolean;
  theme_customColorset: unknown;
  loadTheme: (options: {
    colorset?: string;
    texture?: string | string[];
    material?: string;
  }) => Promise<void>;
  loadSounds: () => Promise<void>;
};

/**
 * DiceBox 0.0.12 has no public runtime-theme update API. Keep its required
 * internal cache refresh in this version-specific boundary.
 */
export async function applyDiceBoxTheme(
  diceBox: DiceBoxThemeBridge,
  theme: DiceTheme,
): Promise<void> {
  delete diceBox.DiceColors.colorsets[theme.colorset];
  diceBox.theme_customColorset = null;
  await diceBox.loadTheme({
    colorset: theme.colorset,
    texture: resolveDiceBoxTexture(theme),
    material: theme.material,
  });
  diceBox.sounds = theme.soundEnabled;
  if (theme.soundEnabled) await diceBox.loadSounds();
}
