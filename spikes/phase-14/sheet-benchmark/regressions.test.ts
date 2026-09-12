import { describe, expect, it } from "vitest";
import {
  parseRawPlanStructure,
  detectSectionDrift,
  detectTitleDegeneracy,
  evaluateLocaleFromText,
  collectRawPlanDisplayText,
  containsInjectionMarkers,
} from "./drift-diagnostics.js";
import { getPersona } from "./personas.js";
import { PersonaAwarePort, shouldAbort } from "./persona-deltas.js";
import { ScriptedMeleePort } from "./test-helpers.js";
import { runFixtureThroughPipeline } from "./harness.js";
import { meleeFixture, ScriptedSheetPort } from "./test-helpers.js";

describe("regression: TRINARY pair conflation", () => {
  it("detects single-character titles from raw provider output", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [
        { key: "a", title: "A", purpose: "Stats", ruleIds: [] },
        { key: "b", title: "B", purpose: "Fighting", ruleIds: [] },
        { key: "c", title: "C", purpose: "Gear", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    expect(structure).not.toBeNull();
    const report = detectTitleDegeneracy(structure);
    expect(report.hasDegeneracy).toBe(true);
    expect(report.singleCharTitles).toEqual(["A", "B", "C"]);
  });

  it("detects repeated single-character titles (e.g. A × 6)", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [
        { key: "s1", title: "A", purpose: "p", ruleIds: [] },
        { key: "s2", title: "A", purpose: "p", ruleIds: [] },
        { key: "s3", title: "A", purpose: "p", ruleIds: [] },
        { key: "s4", title: "A", purpose: "p", ruleIds: [] },
        { key: "s5", title: "A", purpose: "p", ruleIds: [] },
        { key: "s6", title: "A", purpose: "p", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    const report = detectTitleDegeneracy(structure);
    expect(report.hasDegeneracy).toBe(true);
    expect(report.singleCharTitles).toHaveLength(6);
    expect(report.duplicateTitles).toEqual(["A"]);
  });

  it("does not flag multi-character titles as degenerate", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [
        {
          key: "attributes",
          title: "Attributes",
          purpose: "Core stats",
          ruleIds: [],
        },
        { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
        { key: "hp", title: "HP", purpose: "Hit points", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    const report = detectTitleDegeneracy(structure);
    expect(report.hasDegeneracy).toBe(false);
    expect(report.singleCharTitles).toEqual([]);
    expect(report.duplicateTitles).toEqual([]);
  });

  it("does not flag legitimate two-character RPG abbreviations as degenerate", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [
        {
          key: "attributes",
          title: "Attributes",
          purpose: "Core stats",
          ruleIds: [],
        },
        { key: "hp", title: "HP", purpose: "Hit points", ruleIds: [] },
        { key: "mp", title: "MP", purpose: "Mana points", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    const report = detectTitleDegeneracy(structure);
    expect(report.hasDegeneracy).toBe(false);
    expect(report.singleCharTitles).toEqual([]);
  });

  it("does not flag valid Spanish titles with accented characters as degenerate", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [
        {
          key: "proteccion",
          title: "Protección",
          purpose: "Armadura",
          ruleIds: [],
        },
        { key: "dano", title: "Daño", purpose: "Ataque", ruleIds: [] },
        { key: "mana", title: "Maná", purpose: "Reserva", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    const report = detectTitleDegeneracy(structure);
    expect(report.hasDegeneracy).toBe(false);
    expect(report.singleCharTitles).toEqual([]);
  });
});

describe("regression: Ctrl+K hijack", () => {
  it("does not produce injection markers in raw output", () => {
    const hijackText = JSON.stringify({
      mode: "player",
      sections: [
        { key: "ctrl", title: "Ctrl+K", purpose: "Quick action", ruleIds: [] },
      ],
    });
    const markers = ["compromised://", "<script", "alert(1)"];
    const result = containsInjectionMarkers(hijackText, markers);
    expect(result.found).toEqual([]);
  });

  it("detects injected hijack markers when present in raw text", () => {
    const compromised =
      '{"mode":"player","sections":[{"title":"COMPROMISED://identity"}]}';
    const result = containsInjectionMarkers(compromised, [
      "compromised://",
      "<script",
      "alert(1)",
    ]);
    expect(result.found).toEqual(["compromised://"]);
  });

  it("detects script injection markers in raw text", () => {
    const script =
      '{"mode":"player","sections":[{"title":"<script>alert(1)</script>"}]}';
    const result = containsInjectionMarkers(script, [
      "compromised://",
      "<script",
      "alert(1)",
    ]);
    expect(result.found).toContain("<script");
    expect(result.found).toContain("alert(1)");
  });
});

describe("regression: English-only drift", () => {
  it("verifies English locale for English fixture output", () => {
    const displayText =
      "attributes combat derived dexterity body attack defense armor rating hit points initiative";
    const verdict = evaluateLocaleFromText(displayText, "en");
    expect(verdict.verdict).toBe("satisfied");
    expect(verdict.detected).toBe("en");
  });

  it("rejects English output when Spanish is expected", () => {
    const displayText = "attributes combat derived dexterity body";
    const verdict = evaluateLocaleFromText(displayText, "es");
    expect(verdict.verdict).toBe("wrong_locale");
    expect(verdict.detected).toBe("en");
  });

  it("accepts Spanish locale for Spanish fixture output", () => {
    const displayText =
      "atributos combate derivados destreza cuerpo ataque defensa armadura";
    const verdict = evaluateLocaleFromText(displayText, "es");
    expect(verdict.verdict).toBe("satisfied");
    expect(verdict.detected).toBe("es");
  });

  it("rejects Spanish output when English is expected", () => {
    const displayText = "atributos combate derivados destreza cuerpo";
    const verdict = evaluateLocaleFromText(displayText, "en");
    expect(verdict.verdict).toBe("wrong_locale");
    expect(verdict.detected).toBe("es");
  });

  it("flags mixed-language output as mixed", () => {
    const displayText = "attributes combate dexterity cuerpo";
    const verdict = evaluateLocaleFromText(displayText, "en");
    expect(verdict.verdict).toBe("mixed");
    expect(verdict.detected).toBeNull();
  });

  it("returns insufficient when no recognizable locale words are present", () => {
    const displayText = "xyzzy plugh 12345";
    const verdict = evaluateLocaleFromText(displayText, "en");
    expect(verdict.verdict).toBe("insufficient");
    expect(verdict.detected).toBeNull();
  });
});

describe("regression: replay section drift", () => {
  it("detects section count amplification (5 → 11 drift)", () => {
    const previous = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          { key: "attr", title: "Attributes", purpose: "Core", ruleIds: [] },
          { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
          { key: "equip", title: "Equipment", purpose: "Gear", ruleIds: [] },
          { key: "skills", title: "Skills", purpose: "Abilities", ruleIds: [] },
          { key: "notes", title: "Notes", purpose: "Background", ruleIds: [] },
        ],
      }),
    );
    const current = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          { key: "a", title: "A", purpose: "p", ruleIds: [] },
          { key: "b", title: "B", purpose: "p", ruleIds: [] },
          { key: "c", title: "C", purpose: "p", ruleIds: [] },
          { key: "d", title: "D", purpose: "p", ruleIds: [] },
          { key: "e", title: "E", purpose: "p", ruleIds: [] },
          { key: "f", title: "F", purpose: "p", ruleIds: [] },
          { key: "g", title: "G", purpose: "p", ruleIds: [] },
          { key: "h", title: "H", purpose: "p", ruleIds: [] },
          { key: "i", title: "I", purpose: "p", ruleIds: [] },
          { key: "j", title: "J", purpose: "p", ruleIds: [] },
          { key: "k", title: "K", purpose: "p", ruleIds: [] },
        ],
      }),
    );
    const report = detectSectionDrift(previous, current);
    expect(report.drifted).toBe(true);
    expect(report.sectionCountDelta).toBe(6);
    expect(report.addedKeys.length).toBeGreaterThan(0);
  });

  it("detects section reordering as drift", () => {
    const previous = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core",
            ruleIds: [],
          },
          { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
        ],
      }),
    );
    const current = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core",
            ruleIds: [],
          },
        ],
      }),
    );
    const report = detectSectionDrift(previous, current);
    expect(report.drifted).toBe(true);
    expect(report.reordered).toBe(true);
  });

  it("detects section removal as drift", () => {
    const previous = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core",
            ruleIds: [],
          },
          { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
          { key: "skills", title: "Skills", purpose: "Abilities", ruleIds: [] },
        ],
      }),
    );
    const current = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core",
            ruleIds: [],
          },
          { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
        ],
      }),
    );
    const report = detectSectionDrift(previous, current);
    expect(report.drifted).toBe(true);
    expect(report.removedKeys).toEqual(["skills"]);
  });

  it("does not flag identical plans as drifted", () => {
    const plan = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          {
            key: "attributes",
            title: "Attributes",
            purpose: "Core",
            ruleIds: [],
          },
          { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
        ],
      }),
    );
    const report = detectSectionDrift(plan, plan);
    expect(report.drifted).toBe(false);
    expect(report.addedKeys).toEqual([]);
    expect(report.removedKeys).toEqual([]);
    expect(report.reordered).toBe(false);
    expect(report.sectionCountDelta).toBe(0);
  });

  it("works with null structures (no previous plan or no current plan)", () => {
    const plan = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          { key: "attr", title: "Attributes", purpose: "Core", ruleIds: [] },
        ],
      }),
    );
    const reportNullPrev = detectSectionDrift(null, plan);
    expect(reportNullPrev.drifted).toBe(true);
    expect(reportNullPrev.addedKeys).toEqual(["attr"]);

    const reportNullCurr = detectSectionDrift(plan, null);
    expect(reportNullCurr.drifted).toBe(true);
    expect(reportNullCurr.removedKeys).toEqual(["attr"]);
  });
});

describe("regression: repeated-hit abort", () => {
  it("aborts after reaching the bounded violation threshold", async () => {
    const persona = getPersona("minimal-token");
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, persona);

    expect(shouldAbort(persona, port, "section-plan")).toBe(false);
    port.recordViolation("section-plan");
    expect(shouldAbort(persona, port, "section-plan")).toBe(false);
    port.recordViolation("section-plan");
    expect(shouldAbort(persona, port, "section-plan")).toBe(false);
    port.recordViolation("section-plan");
    expect(shouldAbort(persona, port, "section-plan")).toBe(true);
  });

  it("does not abort for personas without a threshold", () => {
    const persona = getPersona("baseline");
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, persona);

    for (let i = 0; i < 100; i++) {
      port.recordViolation("section-plan");
    }
    expect(shouldAbort(persona, port, "section-plan")).toBe(false);
  });

  it("tracks violations independently per slot", () => {
    const persona = getPersona("minimal-token");
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, persona);

    port.recordViolation("section-plan");
    port.recordViolation("section-plan");
    port.recordViolation("field-candidates:combat");

    expect(port.getViolationCount("section-plan")).toBe(2);
    expect(port.getViolationCount("field-candidates:combat")).toBe(1);

    expect(shouldAbort(persona, port, "section-plan")).toBe(false);
    expect(shouldAbort(persona, port, "field-candidates:combat")).toBe(false);
  });

  it("resetViolations clears a specific slot", () => {
    const persona = getPersona("minimal-token");
    const inner = new ScriptedMeleePort("ok");
    const port = new PersonaAwarePort(inner, persona);

    port.recordViolation("section-plan");
    port.recordViolation("section-plan");
    port.recordViolation("section-plan");

    expect(shouldAbort(persona, port, "section-plan")).toBe(true);
    port.resetViolations("section-plan");
    expect(shouldAbort(persona, port, "section-plan")).toBe(false);
  });
});

describe("regression: raw structural parser", () => {
  it("parses valid raw JSON into a structural view", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [
        {
          key: "attr",
          title: "Attributes",
          purpose: "Core stats",
          ruleIds: ["r1", "r2"],
        },
        { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    expect(structure).not.toBeNull();
    expect(structure!.mode).toBe("player");
    expect(structure!.sections).toHaveLength(2);
    expect(structure!.sections[0]!.key).toBe("attr");
    expect(structure!.sections[0]!.title).toBe("Attributes");
    expect(structure!.sections[0]!.ruleIds).toEqual(["r1", "r2"]);
  });

  it("handles invalid JSON gracefully", () => {
    expect(parseRawPlanStructure("not json")).toBeNull();
  });

  it("handles JSON without sections array", () => {
    expect(parseRawPlanStructure('{"mode": "player"}')).toBeNull();
  });

  it("handles sections with malformed entries gracefully", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [
        { key: "attr", title: "Attributes", purpose: "Core", ruleIds: [] },
        { notAKey: true },
        { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    expect(structure).not.toBeNull();
    expect(structure!.sections).toHaveLength(2);
    expect(structure!.sections[0]!.key).toBe("attr");
    expect(structure!.sections[1]!.key).toBe("combat");
  });

  it("handles sections with missing optional fields", () => {
    const raw = JSON.stringify({
      mode: "player",
      sections: [{ key: "attr", title: "Attributes" }],
    });
    const structure = parseRawPlanStructure(raw);
    expect(structure).not.toBeNull();
    expect(structure!.sections[0]!.purpose).toBe("");
    expect(structure!.sections[0]!.ruleIds).toEqual([]);
  });

  it("handles null mode", () => {
    const raw = JSON.stringify({
      sections: [
        { key: "attr", title: "Attributes", purpose: "Core", ruleIds: [] },
      ],
    });
    const structure = parseRawPlanStructure(raw);
    expect(structure).not.toBeNull();
    expect(structure!.mode).toBeNull();
  });

  it("collects display text from raw structure for locale evaluation", () => {
    const structure = parseRawPlanStructure(
      JSON.stringify({
        mode: "player",
        sections: [
          { key: "attr", title: "Attributes", purpose: "Core", ruleIds: [] },
          { key: "combat", title: "Combat", purpose: "Fighting", ruleIds: [] },
        ],
      }),
    );
    const text = collectRawPlanDisplayText(structure);
    expect(text).toBe("attributes combat");
  });
});
