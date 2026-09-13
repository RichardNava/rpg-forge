import type { CharacterSheetAuthoringMode, OutputLocale } from "./authoring.js";
import {
  createDeterministicRandom,
  stableNameSeed,
  type DeterministicRandom,
} from "./deterministic.js";
import type { Level3NamePort } from "./ports.js";

export {
  createDeterministicRandom,
  stableNameSeed,
  type DeterministicRandom,
} from "./deterministic.js";

export const MAX_DETERMINISTIC_NAME_CHARS = 64;
const MIN_NAME_CHARS = 3;

/**
 * A provider-free local name source for the standalone template-backed flow.
 * It is intentionally NOT an AI provider: a public standalone generator must
 * produce a usable character name without consuming inference quota and
 * without depending on model availability.
 *
 * Determinism contract:
 * - the same `(mode, seed, locale)` triple yields the exact same name;
 * - names are built from curated syllable pools, never copied from any
 *   licensed RPG product (the pools below are original phonetic material);
 * - output is non-blank and bounded (`MAX_DETERMINISTIC_NAME_CHARS`).
 */
export interface DeterministicLocalNamePort {
  generateName(input: {
    mode: CharacterSheetAuthoringMode;
    seed: string;
    locale?: OutputLocale | null;
  }): Promise<string>;
}

/** Original, system-agnostic syllable onset pool (English flavor). */
const EN_ONSETS = [
  "b",
  "br",
  "c",
  "d",
  "dr",
  "f",
  "g",
  "h",
  "j",
  "k",
  "l",
  "m",
  "n",
  "p",
  "r",
  "s",
  "t",
  "v",
  "w",
];

/** Original nucleus pool (English flavor). */
const EN_NUCLEI = ["a", "e", "i", "o", "u", "ae", "ai", "au", "ei", "oa", "ou"];

/** Original coda pool (English flavor). */
const EN_CODAS = ["n", "r", "s", "t", "m", "l", "k", "nd", "rt", "st", "sh"];

const ES_ONSETS = [
  "b",
  "c",
  "d",
  "f",
  "g",
  "j",
  "l",
  "m",
  "n",
  "p",
  "r",
  "s",
  "t",
  "v",
];

const ES_NUCLEI = ["a", "e", "i", "o", "u", "ia", "ie", "io"];

const ES_CODAS = ["n", "r", "s", "l", "z", "m"];

/** Original, generic epithet stems; common language, never product-licensed. */
const EN_EPITHETS = [
  "the Keen",
  "the Steadfast",
  "the Fair",
  "the Quiet",
  "the Bold",
  "the Elusive",
  "the Grave",
  "the Swift",
  "the Stern",
  "the Watchful",
];

const ES_EPITHETS = [
  "el Sereno",
  "la Audaz",
  "el Firme",
  "la Leal",
  "el Astuto",
  "la Notable",
  "el Sobrio",
  "la Veloz",
  "el Grave",
  "la Despierta",
];

interface SyllablePool {
  onsets: readonly string[];
  nuclei: readonly string[];
  codas: readonly string[];
}

function poolFor(locale: OutputLocale | null | undefined): SyllablePool {
  const code = (locale ?? "en").toLowerCase().slice(0, 2);
  if (code === "es") {
    return { onsets: ES_ONSETS, nuclei: ES_NUCLEI, codas: ES_CODAS };
  }
  return { onsets: EN_ONSETS, nuclei: EN_NUCLEI, codas: EN_CODAS };
}

function pick<T>(random: DeterministicRandom, pool: readonly T[]): T {
  return pool[Math.floor(random() * pool.length)] as T;
}

/**
 * Builds a name from 2–3 syllables (ES always 2–3, EN 2–3), capitalized with
 * an uppercase first letter. Empty onset syllables are not used: every name
 * starts with a consonant so the output is always pronounceable and never
 * blank.
 */
function buildName(
  random: DeterministicRandom,
  pool: SyllablePool,
  withEpithet: boolean,
  es: boolean,
): string {
  const syllables = 2 + Math.floor(random() * 2);
  let name = "";
  for (let index = 0; index < syllables; index += 1) {
    name += pick(random, pool.onsets) + pick(random, pool.nuclei);
    if (index === syllables - 1) {
      name += pick(random, pool.codas);
    }
  }
  name = name.charAt(0).toUpperCase() + name.slice(1);

  if (withEpithet) {
    const epithet = pick(random, es ? ES_EPITHETS : EN_EPITHETS);
    const candidate = `${name}, ${epithet}`;
    if (candidate.length <= MAX_DETERMINISTIC_NAME_CHARS) {
      name = candidate;
    }
  }
  return name;
}

export interface DeterministicLocalNameDeps {
  stableSeed?: (value: string) => number;
  createRandom?: (seed: number) => DeterministicRandom;
}

/**
 * Adapts the deterministic local name source to the Level-3 contract used by
 * final construction, so the standalone template-backed flow never needs an AI
 * name provider. The `system`/`user` fields of the Level-3 contract are
 * deliberately ignored: the deterministic source needs only mode, seed and
 * locale.
 */
export function createDeterministicLevel3NamePort(input: {
  seed: string;
  locale?: OutputLocale | null;
  port?: DeterministicLocalNamePort;
}): Level3NamePort {
  const port = input.port ?? createDeterministicLocalNamePort();
  return {
    async generateName(args) {
      return port.generateName({
        mode: args.mode,
        seed: input.seed,
        ...(input.locale === undefined || input.locale === null
          ? {}
          : { locale: input.locale }),
      });
    },
  };
}

/**
 * Creates the deterministic local name port. The seed is mixed with mode and
 * locale so the same seed yields distinct names per sheet kind and language,
 * while remaining fully reproducible.
 */
export function createDeterministicLocalNamePort(
  deps: DeterministicLocalNameDeps = {},
): DeterministicLocalNamePort {
  const stableSeed = deps.stableSeed ?? stableNameSeed;
  const createRandom = deps.createRandom ?? createDeterministicRandom;

  return {
    async generateName(input) {
      const pool = poolFor(input.locale);
      const es = (input.locale ?? "en").toLowerCase().startsWith("es");
      const stream = createRandom(
        stableSeed(`${input.mode}|${input.seed}|${es ? "es" : "en"}`),
      );
      let name = buildName(stream, pool, input.mode === "npc", es);
      if (
        name.length < MIN_NAME_CHARS ||
        name.length > MAX_DETERMINISTIC_NAME_CHARS
      ) {
        throw new Error(
          "The deterministic local name source produced an out-of-range name.",
        );
      }
      return name;
    },
  };
}

export interface DeterministicLocalNameValidation {
  value: string;
  valid: boolean;
  issues: readonly string[];
}

/** Validates a generated name against the standalone-name contract. */
export function validateDeterministicLocalName(
  value: string,
): DeterministicLocalNameValidation {
  const issues: string[] = [];
  if (value.trim().length === 0) {
    issues.push("A deterministic character name must not be blank.");
  }
  if (value.length > MAX_DETERMINISTIC_NAME_CHARS) {
    issues.push(
      `A deterministic character name may contain at most ${MAX_DETERMINISTIC_NAME_CHARS} characters.`,
    );
  }
  return { value, valid: issues.length === 0, issues };
}
