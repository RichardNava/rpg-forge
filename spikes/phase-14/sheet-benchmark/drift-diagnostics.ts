import type { SectionPlanOutput } from "@repo/character-sheet-generation";

/**
 * Benchmark-only raw structural parser. Extracts section entries from a raw
 * provider response WITHOUT running production Zod validation. This lets the
 * diagnostics inspect titles and section counts even when the response is
 * invalid (e.g., single-character titles that fail `labelSchema.min(2)`).
 */
export interface RawSectionEntry {
  readonly key: string;
  readonly title: string;
  readonly purpose: string;
  readonly ruleIds: readonly string[];
}

export interface RawPlanStructure {
  readonly mode: string | null;
  readonly sections: readonly RawSectionEntry[];
}

export function parseRawPlanStructure(raw: string): RawPlanStructure | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const mode = typeof record.mode === "string" ? record.mode : null;
  const rawSections = record.sections;
  if (!Array.isArray(rawSections)) {
    return null;
  }
  const sections: RawSectionEntry[] = [];
  for (const item of rawSections) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.key !== "string" || typeof entry.title !== "string") {
      continue;
    }
    sections.push({
      key: entry.key,
      title: entry.title,
      purpose: typeof entry.purpose === "string" ? entry.purpose : "",
      ruleIds: Array.isArray(entry.ruleIds)
        ? entry.ruleIds.filter((id): id is string => typeof id === "string")
        : [],
    });
  }
  return { mode, sections };
}

/**
 * Section-identity drift: detects when a correction replay changes the section
 * list compared to the previous attempt. Operates on the benchmark-only raw
 * structural view, not validated SectionPlanOutput.
 */
export interface SectionDriftReport {
  readonly previousKeys: readonly string[];
  readonly currentKeys: readonly string[];
  readonly addedKeys: readonly string[];
  readonly removedKeys: readonly string[];
  readonly reordered: boolean;
  readonly drifted: boolean;
  readonly sectionCountDelta: number;
}

export function detectSectionDrift(
  previousStructure: RawPlanStructure | null,
  currentStructure: RawPlanStructure | null,
): SectionDriftReport {
  const previousKeys = previousStructure?.sections.map((s) => s.key) ?? [];
  const currentKeys = currentStructure?.sections.map((s) => s.key) ?? [];

  const previousSet = new Set(previousKeys);
  const currentSet = new Set(currentKeys);

  const addedKeys = currentKeys.filter((k) => !previousSet.has(k));
  const removedKeys = previousKeys.filter((k) => !currentSet.has(k));

  const reordered =
    previousKeys.length === currentKeys.length &&
    previousKeys.length > 0 &&
    previousKeys.some((k, i) => k !== currentKeys[i]);

  const drifted = addedKeys.length > 0 || removedKeys.length > 0 || reordered;

  return {
    previousKeys,
    currentKeys,
    addedKeys,
    removedKeys,
    reordered,
    drifted,
    sectionCountDelta: currentKeys.length - previousKeys.length,
  };
}

/**
 * Title degeneracy: detects single-character titles and duplicated titles.
 *
 * Abbreviation/initial detection is intentionally omitted: "HP" may be a
 * legitimate RPG abbreviation. Non-ASCII detection is intentionally omitted:
 * CJK output for an English fixture is a locale issue, handled separately.
 */
export interface TitleDegeneracyReport {
  readonly titles: readonly string[];
  readonly singleCharTitles: readonly string[];
  readonly duplicateTitles: readonly string[];
  readonly hasDegeneracy: boolean;
}

export function detectTitleDegeneracy(
  structure: RawPlanStructure | null,
): TitleDegeneracyReport {
  const titles = structure?.sections.map((s) => s.title) ?? [];
  const singleCharTitles = titles.filter((t) => t.length <= 1);

  const titleCounts = new Map<string, number>();
  for (const title of titles) {
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const duplicateTitles = [
    ...new Set(titles.filter((t) => (titleCounts.get(t) ?? 0) > 1)),
  ];

  const hasDegeneracy =
    singleCharTitles.length > 0 || duplicateTitles.length > 0;

  return { titles, singleCharTitles, duplicateTitles, hasDegeneracy };
}

/**
 * Locale evaluation. Re-exports the benchmark's authoritative locale-verdict
 * semantics (satisfied / wrong_locale / mixed / insufficient) from a raw
 * display-text string, so diagnostics on failed (non-Zod-validated) responses
 * use the same logic as the metrics evaluator.
 *
 * Word lists are defined once here; metrics.ts reuses them.
 */
export type LocaleVerdictValue =
  "satisfied" | "wrong_locale" | "mixed" | "insufficient";

export interface LocaleVerdict {
  readonly expected: "en" | "es";
  readonly detected: "en" | "es" | null;
  readonly verdict: LocaleVerdictValue;
  readonly matches: { readonly en: number; readonly es: number };
}

export const EN_LABEL_WORDS: readonly string[] = [
  "attributes",
  "combat",
  "derived",
  "dexterity",
  "body",
  "attack",
  "defense",
  "armor",
  "rating",
  "hit",
  "points",
  "initiative",
  "mana",
  "focus",
  "spell",
  "concentration",
  "arcane",
  "proficiency",
  "health",
  "pool",
  "inventory",
  "crafting",
  "craft",
  "tool",
  "slots",
  "stock",
  "materials",
  "psi",
  "composure",
  "talent",
  "stress",
  "ledger",
  "cargo",
  "wares",
  "barter",
  "coin",
  "debt",
  "identity",
  "resolve",
  "loyalty",
  "notes",
  "equipment",
  "vitality",
  "skills",
];

export const ES_LABEL_WORDS: readonly string[] = [
  "atributos",
  "combate",
  "derivados",
  "destreza",
  "cuerpo",
  "ataque",
  "defensa",
  "armadura",
  "proteccion",
  "protección",
  "vida",
  "puntos",
  "iniciativa",
  "mana",
  "maná",
  "enfoque",
  "foco",
  "conjuro",
  "conjuros",
  "concentración",
  "concentracion",
  "arcano",
  "arcana",
  "competencia",
  "salud",
  "reserva",
  "inventario",
  "artesania",
  "artesanía",
  "herramienta",
  "herramientas",
  "existencias",
  "materiales",
  "psi",
  "compostura",
  "talento",
  "estres",
  "estrés",
  "libro",
  "cargamento",
  "mercancia",
  "mercancía",
  "trueque",
  "moneda",
  "deuda",
  "identidad",
  "temple",
  "lealtad",
  "notas",
  "equipo",
  "salud",
];

function countLabelWords(
  text: string,
  vocabulary: ReadonlySet<string>,
): number {
  const tokens = text.match(/[a-zà-ÿ0-9]+/g) ?? [];
  return tokens.reduce(
    (count, token) => count + (vocabulary.has(token) ? 1 : 0),
    0,
  );
}

/**
 * Evaluates locale from a lowercased display-text string. Returns a verdict
 * aligned with the benchmark's canonical LocaleVerdict semantics:
 * - satisfied: dominant language matches expected
 * - wrong_locale: dominant language does not match expected
 * - mixed: both languages present in equal measure
 * - insufficient: no recognizable locale words at all
 */
export function evaluateLocaleFromText(
  displayText: string,
  expected: "en" | "es",
): LocaleVerdict {
  const en = countLabelWords(displayText, new Set(EN_LABEL_WORDS));
  const es = countLabelWords(displayText, new Set(ES_LABEL_WORDS));

  let detected: "en" | "es" | null = null;
  if (en > 0 && es === 0) {
    detected = "en";
  } else if (es > 0 && en === 0) {
    detected = "es";
  }

  let verdict: LocaleVerdictValue;
  if (en === 0 && es === 0) {
    verdict = "insufficient";
  } else if (en > 0 && es > 0 && en === es) {
    verdict = "mixed";
  } else {
    const dominantIsExpected = expected === "en" ? en > es : es > en;
    verdict = dominantIsExpected ? "satisfied" : "wrong_locale";
  }

  return { expected, detected, verdict, matches: { en, es } };
}

/**
 * Extracts display text from a raw plan structure (titles only; rule text is
 * fixture-supplied and never used as locale evidence).
 */
export function collectRawPlanDisplayText(
  structure: RawPlanStructure | null,
): string {
  const parts: string[] = [];
  for (const section of structure?.sections ?? []) {
    parts.push(section.title);
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Inject probe: checks that output does not contain any of the forbidden
 * injection markers.
 */
export function containsInjectionMarkers(
  text: string,
  markers: readonly string[],
): { readonly found: readonly string[] } {
  const lower = text.toLowerCase();
  const found = markers.filter((m) => lower.includes(m.toLowerCase()));
  return { found };
}
