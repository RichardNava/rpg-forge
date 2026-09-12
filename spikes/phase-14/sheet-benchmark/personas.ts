import type { SectionPlanOutput } from "@repo/character-sheet-generation";

export type PersonaSlug =
  | "human-locale"
  | "minimal-token"
  | "weights-oracle"
  | "neutral"
  | "strict-schema"
  | "baseline";

export interface PersonaDeltaContext {
  readonly fixtureId: string;
  readonly language: "en" | "es";
  readonly role: "player" | "npc";
  readonly injection: boolean;
  readonly previousPlan: SectionPlanOutput | null;
  readonly attemptNumber: number;
}

export interface BenchmarkPersona {
  readonly slug: PersonaSlug;
  readonly label: string;
  readonly description: string;
  readonly systemPromptDelta:
    ((system: string, ctx: PersonaDeltaContext) => string) | null;
  readonly userPromptDelta:
    ((user: string, ctx: PersonaDeltaContext) => string) | null;
  readonly replayFeedbackDelta:
    ((feedback: string, ctx: PersonaDeltaContext) => string) | null;
  readonly anchorReplay: boolean;
  readonly maxRepeatedViolations: number | null;
  readonly trackReproMetadata: boolean;
}

const HUMAN_LOCALE_COUNTEREXAMPLES: Record<string, string> = {
  en: '"Attribute Scores", not "A"',
  es: '"Puntuales de Combate", no "A"',
};

const HUMAN_LOCALE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

const WEIGHTS_ORACLE_EMPHASIS: Record<string, string | undefined> = {
  "en-core-melee-fighter": "Keep the sheet compact: short stat-block sections.",
  "en-gm-npc-guard": "Keep the sheet compact: short stat-block sections.",
  "es-aventurera-combate": "Keep the sheet compact: short stat-block sections.",
  "en-arcane-caster":
    "Preserve breadth: mana pool, spell list, concentration tracking.",
  "en-tinker-crafter":
    "Preserve breadth: craft checks, tools, inventory, material stock.",
  "es-hechicera-sanadora":
    "Preserve breadth: mana pool, spell list, concentration tracking.",
  "en-telepath-operator":
    "Preserve breadth: psi pool, talents, composure, stress tracking.",
  "en-caravan-merchant":
    "Preserve breadth: ledger, cargo crate list, wares table, barter checks.",
  "inject-prompt-hijack":
    "Preserve breadth: identity, resolve, loyalty tracking.",
};

const PERSONA_DEFINITIONS: Record<PersonaSlug, BenchmarkPersona> = {
  "human-locale": {
    slug: "human-locale",
    label: "Localization-first, human titles",
    description:
      "Explicit locale, schema descriptions, counterexample feedback, anchored replay",
    systemPromptDelta: (system, ctx) => {
      const locale = HUMAN_LOCALE_NAMES[ctx.language] ?? "English";
      return (
        system +
        `\n- Write all section titles and purposes in ${locale} only. ` +
        "Titles must be human-readable headings (never abbreviations, initials, " +
        "or single characters)."
      );
    },
    userPromptDelta: null,
    replayFeedbackDelta: (feedback, ctx) => {
      const locale = HUMAN_LOCALE_NAMES[ctx.language] ?? "English";
      const example =
        HUMAN_LOCALE_COUNTEREXAMPLES[ctx.language] ??
        HUMAN_LOCALE_COUNTEREXAMPLES.en;
      return (
        feedback +
        `\n\nGenerate human-readable titles in ${locale}. ` +
        `Example: ${example}. ` +
        "Never use single characters or abbreviations as section titles."
      );
    },
    anchorReplay: true,
    maxRepeatedViolations: null,
    trackReproMetadata: false,
  },

  "minimal-token": {
    slug: "minimal-token",
    label: "Minimal worktabler",
    description:
      "Token budget on titles/purpose, repro metadata, bounded abort",
    systemPromptDelta: (system) => {
      return (
        system +
        "\n- Section titles must be 1-3 words. " +
        "Purposes must be 5-15 words. " +
        "Keep every player-facing string as short as possible."
      );
    },
    userPromptDelta: null,
    replayFeedbackDelta: (feedback) => {
      return (
        feedback +
        "\n\nReminder: titles must be 1-3 words, purposes 5-15 words."
      );
    },
    anchorReplay: false,
    maxRepeatedViolations: 3,
    trackReproMetadata: true,
  },

  "weights-oracle": {
    slug: "weights-oracle",
    label: "Weights oracle",
    description:
      "Converts implicit fixture emphasis into an explicit prompt sentence",
    systemPromptDelta: (system, ctx) => {
      const emphasis =
        WEIGHTS_ORACLE_EMPHASIS[ctx.fixtureId] ??
        "Preserve breadth: cover all major areas from the rules context.";
      return system + `\n- ${emphasis}`;
    },
    userPromptDelta: null,
    replayFeedbackDelta: null,
    anchorReplay: false,
    maxRepeatedViolations: null,
    trackReproMetadata: false,
  },

  neutral: {
    slug: "neutral",
    label: "Neutral",
    description: 'Removes the "Keep section titles short" instruction',
    systemPromptDelta: (system) => {
      return system.replace(
        "- Keep section titles short and player-facing.",
        "",
      );
    },
    userPromptDelta: null,
    replayFeedbackDelta: null,
    anchorReplay: false,
    maxRepeatedViolations: null,
    trackReproMetadata: false,
  },

  "strict-schema": {
    slug: "strict-schema",
    label: "Zero-shot strict-schema",
    description: "Permissive prompt + strict benchmark-side schema override",
    systemPromptDelta: (system) => {
      return system
        .replace("- Keep section titles short and player-facing.\n", "")
        .replace(
          /- Write all player-facing text \(section titles and purposes\) in the same language as the character intent and the rules context\.\n?/,
          "",
        );
    },
    userPromptDelta: null,
    replayFeedbackDelta: null,
    anchorReplay: false,
    maxRepeatedViolations: null,
    trackReproMetadata: false,
  },

  baseline: {
    slug: "baseline",
    label: "Baseline",
    description: "Current production contract, unchanged",
    systemPromptDelta: null,
    userPromptDelta: null,
    replayFeedbackDelta: null,
    anchorReplay: false,
    maxRepeatedViolations: null,
    trackReproMetadata: false,
  },
};

export const PERSONA_SLUGS: readonly PersonaSlug[] = Object.keys(
  PERSONA_DEFINITIONS,
) as PersonaSlug[];

export function getPersona(slug: PersonaSlug): BenchmarkPersona {
  const persona = PERSONA_DEFINITIONS[slug];
  if (persona === undefined) {
    throw new Error(`Unknown persona slug: ${slug}`);
  }
  return persona;
}

export function isValidPersonaSlug(value: string): value is PersonaSlug {
  return value in PERSONA_DEFINITIONS;
}
