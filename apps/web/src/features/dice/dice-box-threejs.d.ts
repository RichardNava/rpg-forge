declare module "@3d-dice/dice-box-threejs" {
  export type DiceBoxThemeOptions = {
    colorset?: string;
    texture?: string | string[];
    material?: string;
  };

  export type DiceBoxOptions = {
    assetPath?: string;
    baseScale?: number;
    gravity_multiplier?: number;
    light_intensity?: number;
    shadows?: boolean;
    sounds?: boolean;
    strength?: number;
    theme_colorset?: string;
    theme_texture?: string;
    theme_material?: string;
    theme_surface?: string;
    onRollComplete?: (result: unknown) => void;
  };

  export default class DiceBox {
    DiceColors: { colorsets: Record<string, unknown> };
    constructor(selector: string, options?: DiceBoxOptions);
    sounds: boolean;
    theme_customColorset: unknown;
    initialize(): Promise<void>;
    loadTheme(options: DiceBoxThemeOptions): Promise<void>;
    loadSounds(): Promise<void>;
    roll(notation: string): Promise<unknown>;
    setDimensions(dimensions: { x: number; y: number }): void;
    clearDice(): void;
  }
}
