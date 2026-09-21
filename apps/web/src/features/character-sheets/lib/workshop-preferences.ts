import type {
  CharacterTypePreference,
  ThreatLevelPreference,
  VisualStyleKey,
  PortraitSource,
} from "../state/sheet-store-types";

export const CHARACTER_TYPE_OPTIONS: readonly CharacterTypePreference[] = [
  "pc",
  "npc",
];

export const THREAT_LEVEL_OPTIONS: readonly ThreatLevelPreference[] = [
  "common",
  "veteran",
  "elite",
  "boss",
];

export const VISUAL_STYLE_OPTIONS: readonly VisualStyleKey[] = [
  "medieval-fantasy",
  "dark-fantasy",
  "steampunk",
  "oriental-fantasy",
  "retrofuturistic",
  "classic-rpg",
];

export const CHARACTER_TYPE_LABEL: Record<CharacterTypePreference, string> = {
  pc: "Player character",
  npc: "Non-player character",
};

export const THREAT_LEVEL_LABEL: Record<ThreatLevelPreference, string> = {
  common: "Common",
  veteran: "Veteran",
  elite: "Elite",
  boss: "Boss",
};

export const THREAT_LEVEL_EXPLANATION: Record<ThreatLevelPreference, string> = {
  common: "Barely a handful.",
  veteran: "Seasoned and dangerous.",
  elite: "A serious threat.",
  boss: "Deadly even alone.",
};

export const VISUAL_STYLE_LABEL: Record<VisualStyleKey, string> = {
  "medieval-fantasy": "Medieval Fantasy",
  "dark-fantasy": "Dark Fantasy",
  steampunk: "Steampunk",
  "oriental-fantasy": "Oriental Fantasy",
  retrofuturistic: "Retrofuturistic",
  "classic-rpg": "Classic RPG",
};

export const VISUAL_STYLE_EXPLANATION: Record<VisualStyleKey, string> = {
  "medieval-fantasy": "Swords, sorcery, and heraldry.",
  "dark-fantasy": "Grim, gothic, and perilous.",
  steampunk: "Brass, gears, and steam power.",
  "oriental-fantasy": "Brush strokes, spirits, and honor.",
  retrofuturistic: "Chrome, neon, and atompunk dreams.",
  "classic-rpg": "Clean lines, dice, and imagination.",
};

export function isPortraitSourceUpload(
  source: PortraitSource,
): source is { kind: "upload"; dataUrl: string } {
  return source.kind === "upload";
}

export function isPortraitSourceUrl(
  source: PortraitSource,
): source is { kind: "url"; url: string } {
  return source.kind === "url";
}

export function isPortraitSourceAi(
  source: PortraitSource,
): source is { kind: "ai"; prompt: string } {
  return source.kind === "ai";
}

export function isPortraitSourceNone(
  source: PortraitSource,
): source is { kind: "none" } {
  return source.kind === "none";
}