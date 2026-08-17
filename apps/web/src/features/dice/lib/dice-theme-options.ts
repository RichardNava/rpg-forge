export type DiceColorset = (typeof DICE_COLORSETS)[number]["value"];
export type DiceTexture = (typeof DICE_TEXTURES)[number]["value"];
export type DiceMaterial = (typeof DICE_MATERIALS)[number]["value"];

export const DICE_COLORSETS = [
  { value: "white", label: "Ivory", swatch: "#f0eee6" },
  { value: "black", label: "Obsidian", swatch: "#22201f" },
  { value: "radiant", label: "Radiant", swatch: "#d5a84a" },
  { value: "fire", label: "Fire", swatch: "#b9432f" },
  { value: "ice", label: "Ice", swatch: "#8ec7d4" },
  { value: "poison", label: "Poison", swatch: "#62824c" },
  { value: "acid", label: "Acid", swatch: "#a8b53d" },
  { value: "thunder", label: "Thunder", swatch: "#755c98" },
  { value: "lightning", label: "Lightning", swatch: "#d3b33d" },
  { value: "air", label: "Air", swatch: "#b7d2d4" },
  { value: "water", label: "Water", swatch: "#356e9b" },
  { value: "earth", label: "Earth", swatch: "#72533a" },
  { value: "force", label: "Force", swatch: "#7a8bb4" },
  { value: "psychic", label: "Psychic", swatch: "#9a638c" },
  { value: "necrotic", label: "Necrotic", swatch: "#596b63" },
  { value: "inspired", label: "Inspired", swatch: "#bd6f4d" },
  { value: "bloodmoon", label: "Blood Moon", swatch: "#822f39" },
  { value: "starynight", label: "Starry Night", swatch: "#29395d" },
  { value: "astralsea", label: "Astral Sea", swatch: "#625198" },
  { value: "bronze", label: "Bronze", swatch: "#977044" },
  { value: "dragons", label: "Dragons", swatch: "#6f563e" },
  { value: "rainbow", label: "Rainbow", swatch: "#c06a82" },
] as const;

// Empty is the upstream "no explicit override" value: the colorset keeps its own texture.
export const DICE_TEXTURES = [
  { value: "", label: "None (colorset default)" },
  { value: "cloudy", label: "Cloudy" },
  { value: "cloudy_2", label: "Cloudy II" },
  { value: "fire", label: "Fire" },
  { value: "marble", label: "Marble" },
  { value: "water", label: "Water" },
  { value: "ice", label: "Ice" },
  { value: "paper", label: "Paper" },
  { value: "speckles", label: "Speckles" },
  { value: "glitter", label: "Glitter" },
  { value: "glitter_2", label: "Glitter II" },
  { value: "stars", label: "Stars" },
  { value: "stainedglass", label: "Stained Glass" },
  { value: "wood", label: "Wood" },
  { value: "metal", label: "Metal" },
  { value: "skulls", label: "Skulls" },
  { value: "dragon", label: "Dragon" },
  { value: "astral", label: "Astral" },
  { value: "bronze01", label: "Bronze I" },
  { value: "bronze02", label: "Bronze II" },
  { value: "bronze03", label: "Bronze III" },
  { value: "bronze03a", label: "Bronze III A" },
  { value: "bronze03b", label: "Bronze III B" },
  { value: "bronze04", label: "Bronze IV" },
] as const;

export const DICE_MATERIALS = [
  { value: "plastic", label: "Plastic" },
  { value: "none", label: "Default / None" },
  { value: "metal", label: "Metal" },
  { value: "wood", label: "Wood" },
  { value: "glass", label: "Glass" },
] as const;

export type DiceTheme = {
  colorset: DiceColorset;
  texture: DiceTexture;
  material: DiceMaterial;
  soundEnabled: boolean;
};

export const DEFAULT_DICE_THEME: DiceTheme = {
  colorset: "white",
  texture: "",
  material: "plastic",
  soundEnabled: true,
};

const COLORSET_DEFAULT_TEXTURES: Record<
  DiceColorset,
  string | readonly string[]
> = {
  white: "none",
  black: "none",
  radiant: "paper",
  fire: "fire",
  ice: "ice",
  poison: "cloudy",
  acid: "marble",
  thunder: "cloudy",
  lightning: "ice",
  air: "cloudy",
  water: "water",
  earth: "speckles",
  force: "stars",
  psychic: "speckles",
  necrotic: "skulls",
  inspired: "none",
  bloodmoon: "marble",
  starynight: "speckles",
  astralsea: "astral",
  bronze: [
    "bronze01",
    "bronze02",
    "bronze03",
    "bronze03a",
    "bronze03b",
    "bronze04",
  ],
  dragons: ["dragon", "lizard"],
  rainbow: "none",
};

/** Resolves the UI's no-override choice before DiceBox's per-colorset cache resets. */
export function resolveDiceBoxTexture(theme: DiceTheme): string | string[] {
  if (theme.texture) return theme.texture;
  const texture = COLORSET_DEFAULT_TEXTURES[theme.colorset];
  return typeof texture === "string" ? texture : [...texture];
}

export function colorForColorset(colorset: DiceColorset) {
  return DICE_COLORSETS.find((option) => option.value === colorset)?.swatch;
}
