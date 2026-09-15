import type {
  CharacterTypePreference,
  ThreatLevelPreference,
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