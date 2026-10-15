import type {
  ThreatLevelPreference,
  VisualStyleKey,
  PortraitSource,
} from "../state/sheet-workshop-types";

export const THREAT_LEVEL_OPTIONS: readonly ThreatLevelPreference[] = [
  "very-low",
  "low",
  "medium",
  "elite",
  "legendary",
];

export const VISUAL_STYLE_OPTIONS: readonly VisualStyleKey[] = [
  "medieval",
  "fantasy",
  "gothic",
  "steampunk",
  "sci-fi",
  "contemporary",
];

export const THREAT_LEVEL_LABEL: Record<ThreatLevelPreference, string> = {
  "very-low": "Very Low",
  low: "Low",
  medium: "Medium",
  elite: "Elite",
  legendary: "Legendary",
};

export const THREAT_LEVEL_EXPLANATION: Record<ThreatLevelPreference, string> = {
  "very-low": "Barely a handful.",
  low: "Weaker than average.",
  medium: "A fair challenge.",
  elite: "A serious threat.",
  legendary: "Deadly even alone.",
};

export const VISUAL_STYLE_LABEL: Record<VisualStyleKey, string> = {
  medieval: "Medieval",
  fantasy: "Fantasy",
  gothic: "Gothic",
  steampunk: "Steampunk",
  "sci-fi": "Sci-fi",
  contemporary: "Contemporary",
};

export const VISUAL_STYLE_EXPLANATION: Record<VisualStyleKey, string> = {
  medieval: "Classic swords and sorcery.",
  fantasy: "High magic and wonder.",
  gothic: "Grim, dark, and perilous.",
  steampunk: "Brass, gears, and steam power.",
  "sci-fi": "Starships and cybernetics.",
  contemporary: "Modern day, hidden worlds.",
};

export function isPortraitSourceNone(
  source: PortraitSource,
): source is { kind: "none" } {
  return source.kind === "none";
}

export const PORTRAIT_SOURCE_OPTIONS = ["none", "upload", "url", "ai"] as const;
export type PortraitSourceKind = (typeof PORTRAIT_SOURCE_OPTIONS)[number];

export const PORTRAIT_SOURCE_LABEL: Record<PortraitSourceKind, string> = {
  none: "None",
  upload: "Upload",
  url: "URL",
  ai: "AI",
};
