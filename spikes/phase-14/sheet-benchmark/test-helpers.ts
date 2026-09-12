import type {
  SheetGenerationPort,
  SheetGenerationStage,
} from "@repo/character-sheet-generation";
import {
  getBenchmarkFixtureById,
  type SheetBenchmarkFixture,
} from "./fixtures.js";
import {
  extractSectionKey,
  runFixtureThroughPipeline,
  type FixtureRunResult,
} from "./harness.js";

export const MELEE_PLAN = JSON.stringify({
  mode: "player",
  sections: [
    {
      key: "attributes",
      title: "Attributes",
      purpose: "Core attributes: dexterity and body.",
      ruleIds: ["rule-dexterity", "rule-body"],
    },
    {
      key: "combat",
      title: "Combat",
      purpose: "Attack, defense, armor and hit points.",
      ruleIds: ["rule-attack", "rule-defense", "rule-hit-points", "rule-armor"],
    },
    {
      key: "derived",
      title: "Derived",
      purpose: "Calculated values such as initiative.",
      ruleIds: ["rule-initiative"],
    },
  ],
});

const FIELDS_BY_SECTION: Record<string, unknown[]> = {
  attributes: [
    {
      key: "dexterity",
      label: "Dexterity",
      type: "number",
      min: 1,
      max: 6,
      ruleIds: ["rule-dexterity"],
    },
    {
      key: "body",
      label: "Body",
      type: "number",
      min: 1,
      max: 6,
      ruleIds: ["rule-body"],
    },
  ],
  combat: [
    {
      key: "attack",
      label: "Attack",
      type: "number",
      ruleIds: ["rule-attack"],
    },
    {
      key: "defense",
      label: "Defense",
      type: "number",
      min: 10,
      max: 30,
      ruleIds: ["rule-defense", "rule-armor"],
    },
    {
      key: "hit_points",
      label: "Hit Points",
      type: "number",
      ruleIds: ["rule-hit-points"],
    },
    {
      key: "armor_rating",
      label: "Armor Rating",
      type: "number",
      min: 1,
      max: 6,
      ruleIds: ["rule-armor"],
    },
  ],
  derived: [
    {
      key: "initiative",
      label: "Initiative",
      type: "calculated",
      ruleIds: ["rule-initiative"],
    },
  ],
};

const CALCULATIONS = JSON.stringify({
  calculations: [
    {
      key: "initiative",
      label: "Initiative",
      ruleIds: ["rule-initiative"],
      expression: {
        op: "add",
        left: { op: "field", fieldKey: "dexterity" },
        right: { op: "literal", value: 10 },
      },
    },
  ],
});

export type ScriptedBehavior = "ok" | "throw-all" | "retry-plan";

/**
 * A deterministic provider that produces valid model-shaped JSON for the melee
 * fixture, matching the production section keys the prompts carry.
 */
export class ScriptedMeleePort implements SheetGenerationPort {
  private failedOnce: boolean | undefined;

  constructor(private readonly behavior: ScriptedBehavior) {}

  async generate(input: {
    stage: SheetGenerationStage;
    system: string;
    user: string;
  }): Promise<string> {
    if (this.behavior === "throw-all") {
      throw new Error("provider unavailable");
    }

    if (input.stage === "section-plan") {
      if (this.behavior === "retry-plan") {
        this.failedOnce ??= true;
        if (this.failedOnce) {
          this.failedOnce = false;
          return "this is not json";
        }
      }
      return MELEE_PLAN;
    }

    if (input.stage === "calculations") {
      return CALCULATIONS;
    }

    const sectionKey = extractSectionKey(input.user);
    const fields = FIELDS_BY_SECTION[sectionKey ?? ""];
    if (fields === undefined) {
      throw new Error(`unexpected section key "${sectionKey}"`);
    }
    return JSON.stringify({ fields });
  }
}

export type ScriptedOutcome =
  "ok" | "invalid-json" | "schema-invalid" | "validate-fail" | "throw";

export interface ScriptedSheetScript {
  readonly sectionPlan?: readonly ScriptedOutcome[];
  readonly fields?: Readonly<Record<string, readonly ScriptedOutcome[]>>;
  readonly calculations?: readonly ScriptedOutcome[];
  readonly customFields?: Readonly<Record<string, readonly unknown[]>>;
  readonly customCalculations?: readonly unknown[];
}

const PLAN_SCHEMA_INVALID = JSON.stringify({
  mode: "player",
  sections: [{ title: "Attributes only" }],
});

const FIELDS_RESOURCE_NO_REFS = JSON.stringify({
  fields: [
    {
      key: "resist",
      label: "Resist",
      type: "resource",
      references: {},
      ruleIds: [],
    },
  ],
});

const FIELDS_DUP_KEY_COMBAT = JSON.stringify({
  fields: [
    { key: "dexterity", label: "Dexterity", type: "number", ruleIds: [] },
  ],
});

const CALC_UNKNOWN_REF = JSON.stringify({
  calculations: [
    {
      key: "initiative",
      label: "Initiative",
      ruleIds: ["rule-initiative"],
      expression: { op: "field", fieldKey: "missing_field" },
    },
  ],
});

/**
 * A fully scripted, deterministic provider. Each stage/section can be given an
 * ordered outcome list; a missing entry defaults to a valid response. The
 * payload can be swapped wholesale via `customFields`/`customCalculations` so
 * compile-stage defects can be exercised deterministically.
 */
export class ScriptedSheetPort implements SheetGenerationPort {
  private readonly counters = new Map<string, number>();

  constructor(private readonly script: ScriptedSheetScript) {}

  private next(slot: string): ScriptedOutcome {
    const outcomes = outcomesForScript(this.script, slot);
    const at = this.counters.get(slot) ?? 0;
    this.counters.set(slot, at + 1);
    return outcomes[at] ?? "ok";
  }

  async generate(input: {
    stage: SheetGenerationStage;
    system: string;
    user: string;
  }): Promise<string> {
    const slot = scriptSlot(input.stage, input.user);
    const outcome = this.next(slot);

    if (outcome === "throw") {
      throw new Error("provider unavailable");
    }
    if (outcome === "invalid-json") {
      return "this is not json";
    }

    if (input.stage === "section-plan") {
      return outcome === "schema-invalid" ? PLAN_SCHEMA_INVALID : MELEE_PLAN;
    }

    if (input.stage === "calculations") {
      if (outcome === "validate-fail" || outcome === "schema-invalid") {
        return CALC_UNKNOWN_REF;
      }
      return this.script.customCalculations === undefined
        ? CALCULATIONS
        : JSON.stringify({ calculations: this.script.customCalculations });
    }

    const sectionKey = extractSectionKey(input.user) ?? "";
    if (outcome === "schema-invalid") {
      return FIELDS_RESOURCE_NO_REFS;
    }
    if (outcome === "validate-fail") {
      return FIELDS_DUP_KEY_COMBAT;
    }
    const custom = this.script.customFields?.[sectionKey];
    if (custom !== undefined) {
      return JSON.stringify({ fields: custom });
    }
    const fields = FIELDS_BY_SECTION[sectionKey];
    if (fields === undefined) {
      throw new Error(`unexpected section key "${sectionKey}"`);
    }
    return JSON.stringify({ fields });
  }
}

function outcomesForScript(
  script: ScriptedSheetScript,
  slot: string,
): readonly ScriptedOutcome[] {
  if (slot === "section-plan") {
    return script.sectionPlan ?? [];
  }
  if (slot === "calculations") {
    return script.calculations ?? [];
  }
  if (slot.startsWith("field-candidates:")) {
    const key = slot.slice("field-candidates:".length);
    return script.fields?.[key] ?? [];
  }
  return [];
}

function scriptSlot(stage: SheetGenerationStage, user: string): string {
  return stage === "field-candidates"
    ? `field-candidates:${extractSectionKey(user) ?? "unknown"}`
    : stage;
}

export function meleeFixture(): SheetBenchmarkFixture {
  const fixture = getBenchmarkFixtureById("en-core-melee-fighter");
  if (fixture === undefined) {
    throw new Error("fixture en-core-melee-fighter not found");
  }
  return fixture;
}

export async function runOkMeleeWithBehavior(
  behavior: ScriptedBehavior,
): Promise<FixtureRunResult> {
  return runFixtureThroughPipeline({
    fixture: meleeFixture(),
    port: new ScriptedMeleePort(behavior),
  });
}
