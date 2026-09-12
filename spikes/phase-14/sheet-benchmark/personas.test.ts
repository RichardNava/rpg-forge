import { describe, expect, it } from "vitest";
import {
  getPersona,
  isValidPersonaSlug,
  PERSONA_SLUGS,
  type PersonaSlug,
} from "./personas.js";
import {
  applySystemPromptDelta,
  applyUserPromptDelta,
  applyReplayFeedbackDelta,
  buildAnchorInstruction,
  buildReproMetadata,
  PersonaAwarePort,
  shouldAbort,
} from "./persona-deltas.js";
import type { PersonaDeltaContext } from "./personas.js";
import { ScriptedMeleePort } from "./test-helpers.js";

const BASE_SYSTEM = [
  "You design the semantic structure of a blank character sheet.",
  "",
  "Goals:",
  "- Output a non-empty list of sections (maximum 12).",
  "- Section keys are lowercase snake_case.",
  "- Keep section titles short and player-facing.",
  "- Write all player-facing text (section titles and purposes) in the same " +
    "language as the character intent and the rules context.",
  "",
  "Return ONLY the JSON object described by the schema.",
].join("\n");

const BASE_USER = [
  "## Character intent",
  "A reliable frontline fighter who wants a compact blank sheet.",
  "",
  "## Rules context",
  "- id: rule-dexterity | category: attributes | key: dexterity | Dexterity ranges from 1 to 6.",
].join("\n");

const BASE_FEEDBACK =
  "sections.0.title: Too small: expected string to have >=2 characters";

const CTX_EN: PersonaDeltaContext = {
  fixtureId: "en-core-melee-fighter",
  language: "en",
  role: "player",
  injection: false,
  previousPlan: null,
  attemptNumber: 1,
};

const CTX_ES: PersonaDeltaContext = {
  fixtureId: "es-aventurera-combate",
  language: "es",
  role: "player",
  injection: false,
  previousPlan: null,
  attemptNumber: 1,
};

describe("persona registry", () => {
  it("contains exactly the six approved slugs", () => {
    expect(PERSONA_SLUGS).toEqual([
      "human-locale",
      "minimal-token",
      "weights-oracle",
      "neutral",
      "strict-schema",
      "baseline",
    ]);
  });

  it("each slug resolves to a non-null persona", () => {
    for (const slug of PERSONA_SLUGS) {
      const persona = getPersona(slug);
      expect(persona.slug).toBe(slug);
      expect(persona.label.length).toBeGreaterThan(0);
      expect(persona.description.length).toBeGreaterThan(0);
    }
  });

  it("isValidPersonaSlug identifies known and unknown slugs", () => {
    expect(isValidPersonaSlug("baseline")).toBe(true);
    expect(isValidPersonaSlug("human-locale")).toBe(true);
    expect(isValidPersonaSlug("no-such-persona")).toBe(false);
    expect(isValidPersonaSlug("")).toBe(false);
  });
});

describe("persona A — human-locale", () => {
  const persona = getPersona("human-locale");

  it("appends explicit locale instruction to system prompt for en", () => {
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, CTX_EN);
    expect(result).toContain("English only");
    expect(result).toContain("human-readable headings");
    expect(result).toContain(
      "never abbreviations, initials, or single characters",
    );
  });

  it("appends explicit locale instruction to system prompt for es", () => {
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, CTX_ES);
    expect(result).toContain("Spanish only");
  });

  it("does not modify the user prompt", () => {
    const result = applyUserPromptDelta(BASE_USER, persona, CTX_EN);
    expect(result).toBe(BASE_USER);
  });

  it("appends counterexample feedback for en", () => {
    const result = applyReplayFeedbackDelta(BASE_FEEDBACK, persona, CTX_EN);
    expect(result).toContain('"Attribute Scores", not "A"');
    expect(result).toContain("in English");
  });

  it("appends counterexample feedback for es", () => {
    const result = applyReplayFeedbackDelta(BASE_FEEDBACK, persona, CTX_ES);
    expect(result).toContain('"Puntuales de Combate", no "A"');
    expect(result).toContain("in Spanish");
  });

  it("enables anchored replay", () => {
    expect(persona.anchorReplay).toBe(true);
  });

  it("does not abort on repeated violations", () => {
    expect(persona.maxRepeatedViolations).toBeNull();
  });

  it("does not track repro metadata", () => {
    expect(persona.trackReproMetadata).toBe(false);
  });
});

describe("persona B — minimal-token", () => {
  const persona = getPersona("minimal-token");

  it("appends token budget instruction to system prompt", () => {
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, CTX_EN);
    expect(result).toContain("1-3 words");
    expect(result).toContain("5-15 words");
  });

  it("appends token budget reminder to replay feedback", () => {
    const result = applyReplayFeedbackDelta(BASE_FEEDBACK, persona, CTX_EN);
    expect(result).toContain("1-3 words");
    expect(result).toContain("5-15 words");
  });

  it("does not anchor replay", () => {
    expect(persona.anchorReplay).toBe(false);
  });

  it("aborts after 3 repeated violations", () => {
    expect(persona.maxRepeatedViolations).toBe(3);
  });

  it("tracks repro metadata", () => {
    expect(persona.trackReproMetadata).toBe(true);
  });
});

describe("persona C — weights-oracle", () => {
  const persona = getPersona("weights-oracle");

  it("appends compact emphasis for a compact fixture", () => {
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, CTX_EN);
    expect(result).toContain("Keep the sheet compact");
  });

  it("appends breadth emphasis for a breadth fixture", () => {
    const breadthCtx: PersonaDeltaContext = {
      ...CTX_EN,
      fixtureId: "en-arcane-caster",
    };
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, breadthCtx);
    expect(result).toContain("Preserve breadth");
  });

  it("does not modify the user prompt", () => {
    const result = applyUserPromptDelta(BASE_USER, persona, CTX_EN);
    expect(result).toBe(BASE_USER);
  });

  it("does not modify replay feedback", () => {
    const result = applyReplayFeedbackDelta(BASE_FEEDBACK, persona, CTX_EN);
    expect(result).toBe(BASE_FEEDBACK);
  });

  it("does not anchor replay", () => {
    expect(persona.anchorReplay).toBe(false);
  });

  it("does not abort on repeated violations", () => {
    expect(persona.maxRepeatedViolations).toBeNull();
  });
});

describe("persona D — neutral", () => {
  const persona = getPersona("neutral");

  it("removes the compactness instruction from the system prompt", () => {
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, CTX_EN);
    expect(result).not.toContain("Keep section titles short");
    expect(result).toContain("non-empty list of sections");
  });

  it("does not modify the user prompt", () => {
    const result = applyUserPromptDelta(BASE_USER, persona, CTX_EN);
    expect(result).toBe(BASE_USER);
  });

  it("does not modify replay feedback", () => {
    const result = applyReplayFeedbackDelta(BASE_FEEDBACK, persona, CTX_EN);
    expect(result).toBe(BASE_FEEDBACK);
  });

  it("does not anchor replay", () => {
    expect(persona.anchorReplay).toBe(false);
  });

  it("does not abort on repeated violations", () => {
    expect(persona.maxRepeatedViolations).toBeNull();
  });
});

describe("persona E — strict-schema", () => {
  const persona = getPersona("strict-schema");

  it("removes both compactness and locale instructions from the system prompt", () => {
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, CTX_EN);
    expect(result).not.toContain("Keep section titles short");
    expect(result).not.toContain(
      "Write all player-facing text (section titles and purposes) in the same language",
    );
    expect(result).toContain("non-empty list of sections");
  });

  it("does not modify the user prompt", () => {
    const result = applyUserPromptDelta(BASE_USER, persona, CTX_EN);
    expect(result).toBe(BASE_USER);
  });

  it("does not modify replay feedback", () => {
    const result = applyReplayFeedbackDelta(BASE_FEEDBACK, persona, CTX_EN);
    expect(result).toBe(BASE_FEEDBACK);
  });

  it("does not anchor replay", () => {
    expect(persona.anchorReplay).toBe(false);
  });

  it("does not abort on repeated violations", () => {
    expect(persona.maxRepeatedViolations).toBeNull();
  });
});

describe("persona F — baseline", () => {
  const persona = getPersona("baseline");

  it("does not modify the system prompt", () => {
    const result = applySystemPromptDelta(BASE_SYSTEM, persona, CTX_EN);
    expect(result).toBe(BASE_SYSTEM);
  });

  it("does not modify the user prompt", () => {
    const result = applyUserPromptDelta(BASE_USER, persona, CTX_EN);
    expect(result).toBe(BASE_USER);
  });

  it("does not modify replay feedback", () => {
    const result = applyReplayFeedbackDelta(BASE_FEEDBACK, persona, CTX_EN);
    expect(result).toBe(BASE_FEEDBACK);
  });

  it("does not anchor replay", () => {
    expect(persona.anchorReplay).toBe(false);
  });

  it("does not abort on repeated violations", () => {
    expect(persona.maxRepeatedViolations).toBeNull();
  });

  it("does not track repro metadata", () => {
    expect(persona.trackReproMetadata).toBe(false);
  });
});

describe("anchored replay", () => {
  const persona = getPersona("human-locale");

  it("returns null when no previous plan exists", () => {
    const result = buildAnchorInstruction(null, persona);
    expect(result).toBeNull();
  });

  it("returns null for a non-anchoring persona", () => {
    const neutral = getPersona("neutral");
    const plan = {
      mode: "player" as const,
      sections: [
        {
          key: "attributes",
          title: "Attributes",
          purpose: "Core",
          ruleIds: [],
        },
        { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
      ],
    };
    const result = buildAnchorInstruction(plan, neutral);
    expect(result).toBeNull();
  });

  it("builds an anchor instruction with section keys in order", () => {
    const plan = {
      mode: "player" as const,
      sections: [
        {
          key: "attributes",
          title: "Attributes",
          purpose: "Core",
          ruleIds: [],
        },
        { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
        { key: "derived", title: "Derived", purpose: "Calc", ruleIds: [] },
      ],
    };
    const result = buildAnchorInstruction(plan, persona);
    expect(result).not.toBeNull();
    expect(result).toContain("[attributes, combat, derived]");
    expect(result).toContain("Keep ALL of these section keys");
    expect(result).toContain("Repair only");
  });
});

describe("repro metadata", () => {
  it("returns null for a non-tracking persona", () => {
    const baseline = getPersona("baseline");
    const result = buildReproMetadata(baseline, CTX_EN);
    expect(result).toBeNull();
  });

  it("returns a metadata string for minimal-token persona", () => {
    const minimal = getPersona("minimal-token");
    const ctx: PersonaDeltaContext = { ...CTX_EN, attemptNumber: 2 };
    const result = buildReproMetadata(minimal, ctx);
    expect(result).not.toBeNull();
    expect(result).toContain("fixture=en-core-melee-fighter");
    expect(result).toContain("attempt=2");
    expect(result).toContain("stage=section-plan");
  });
});

describe("PersonaAwarePort", () => {
  it("forwards system and user to the inner port", async () => {
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, getPersona("baseline"));

    const result = await port.generate({
      stage: "section-plan",
      system: BASE_SYSTEM,
      user: BASE_USER,
    });

    expect(result).toBeTruthy();
    expect(JSON.parse(result)).toHaveProperty("sections");
  });

  it("applies system prompt delta from the persona", async () => {
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, getPersona("neutral"));

    let capturedSystem = "";
    const capturing = {
      async generate(input: { stage: string; system: string; user: string }) {
        capturedSystem = input.system;
        return inner.generate(input as { stage: any; system: any; user: any });
      },
    };
    const capturingPort = new PersonaAwarePort(
      capturing as any,
      getPersona("neutral"),
    );

    await capturingPort.generate({
      stage: "section-plan",
      system: BASE_SYSTEM,
      user: BASE_USER,
    });

    expect(capturedSystem).not.toContain("Keep section titles short");
  });

  it("tracks violation counts per slot", () => {
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, getPersona("minimal-token"));

    expect(port.getViolationCount("section-plan")).toBe(0);
    port.recordViolation("section-plan");
    expect(port.getViolationCount("section-plan")).toBe(1);
    port.recordViolation("section-plan");
    expect(port.getViolationCount("section-plan")).toBe(2);
    port.resetViolations("section-plan");
    expect(port.getViolationCount("section-plan")).toBe(0);
  });

  it("sets and retrieves previous plan", () => {
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, getPersona("human-locale"));

    expect(port["previousPlan"]).toBeNull();
    const plan = {
      mode: "player" as const,
      sections: [
        { key: "attr", title: "Attributes", purpose: "Core", ruleIds: [] },
      ],
    };
    port.setPreviousPlan(plan);
    expect(port["previousPlan"]).toEqual(plan);
  });
});

describe("shouldAbort", () => {
  it("returns false when persona has no abort threshold", () => {
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, getPersona("baseline"));
    expect(shouldAbort(getPersona("baseline"), port, "section-plan")).toBe(
      false,
    );
  });

  it("returns false when violation count is below threshold", () => {
    const inner = new ScriptedMeleePort("ok");
    const persona = getPersona("minimal-token");
    const port = new PersonaAwarePort(inner, persona);
    port.recordViolation("section-plan");
    expect(shouldAbort(persona, port, "section-plan")).toBe(false);
  });

  it("returns true when violation count reaches threshold", () => {
    const inner = new ScriptedMeleePort("ok");
    const persona = getPersona("minimal-token");
    const port = new PersonaAwarePort(inner, persona);
    port.recordViolation("section-plan");
    port.recordViolation("section-plan");
    port.recordViolation("section-plan");
    expect(shouldAbort(persona, port, "section-plan")).toBe(true);
  });
});
