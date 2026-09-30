import {
  DraftError,
  MAX_DRAFT_SECTIONS,
  MAX_DRAFT_SURFACE_FIELDS,
  parseCanonicalCharacterSheetDraft,
  validateDraftV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { describe, expect, it } from "vitest";
import { compileExtractedCharacterStructureV2 } from "./compile-extracted-character-structure-v2.js";
import type { ExtractedCharacterStructure } from "./extracted-character-structure.js";

const SESSION_ID = "session.123";

function structureOf(
  nodes: ExtractedCharacterStructure["nodes"],
): ExtractedCharacterStructure {
  return { schemaVersion: "1", document: { pageCount: 1 }, nodes };
}

function compile(
  nodes: ExtractedCharacterStructure["nodes"],
  sourceSheetId: string | null = "sheet",
): CharacterSheetDraftV2 {
  return compileExtractedCharacterStructureV2({
    structure: structureOf(nodes),
    sessionId: SESSION_ID,
    sourceSheetId,
  });
}

function placementKeys(draft: CharacterSheetDraftV2): string[] {
  return draft.structure.map(
    (placement) => `${placement.kind}:${placement.key}`,
  );
}

/**
 * Asserts the `validateDraftV2` gate REJECTED the candidate. The gate contract
 * is the typed error code, not zod's exact issue wording, so the message is
 * only checked for the budget it tripped.
 */
function expectGateRejection(action: () => unknown, budget: RegExp): void {
  let captured: unknown;
  let threw = false;
  try {
    action();
  } catch (error) {
    threw = true;
    captured = error;
  }
  expect(threw).toBe(true);
  expect(captured).toBeInstanceOf(DraftError);
  expect((captured as DraftError).code).toBe("invalid_draft");
  expect((captured as DraftError).message).toMatch(budget);
}

describe("compileExtractedCharacterStructureV2", () => {
  describe("DIRECT V2 PRODUCTION — no V1 intermediate", () => {
    it("1. produces a canonical V2 draft at version 1", () => {
      const draft = compile([
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ]);

      expect(draft.schemaVersion).toBe("2");
      expect(draft.version).toBe(1);
      expect(draft.baseVersion).toBe(1);
      expect(draft.mode).toBe("pc");
      expect(draft.confirmed).toBe(false);
      expect(draft.sessionId).toBe(SESSION_ID);
      expect(draft.source).toEqual({
        sourceSheetId: "sheet",
        sourceRunId: null,
      });
      expect(draft.rulesContextId).toBeNull();
    });

    it("2. sections carry ONLY key and title, never V1 nesting", () => {
      const draft = compile([
        {
          kind: "section",
          label: "Attributes",
          children: [
            { kind: "field", label: "Strength", control: { kind: "rating" } },
          ],
        },
      ]);

      // The V1 shapes are absent at the type level AND at runtime: V2 has no
      // fieldKeys and no section-level parentKey.
      expect(draft.sections).toEqual([
        { key: "attributes", title: "Attributes" },
      ]);
      for (const section of draft.sections) {
        expect(Object.keys(section).sort()).toEqual(["key", "title"]);
      }
    });

    it("3. emits structure[] as the sole structural authority", () => {
      const draft = compile([
        {
          kind: "section",
          label: "Attributes",
          children: [
            { kind: "field", label: "Strength", control: { kind: "rating" } },
          ],
        },
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ]);

      expect(draft.structure).toEqual([
        { kind: "section", key: "attributes", parentKey: null },
        { kind: "field", key: "strength", parentKey: "attributes" },
        { kind: "field", key: "notes", parentKey: null },
      ]);
    });

    it("4. every field and section has exactly one placement", () => {
      const draft = compile([
        {
          kind: "section",
          label: "Core",
          children: [
            {
              kind: "section",
              label: "Physical",
              children: [
                {
                  kind: "field",
                  label: "Strength",
                  control: { kind: "rating" },
                },
                {
                  kind: "field",
                  label: "Agility",
                  control: { kind: "rating" },
                },
              ],
            },
            { kind: "field", label: "Name", control: { kind: "text" } },
          ],
        },
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ]);

      for (const field of draft.fields) {
        expect(
          draft.structure.filter(
            (p) => p.kind === "field" && p.key === field.key,
          ),
        ).toHaveLength(1);
      }
      for (const section of draft.sections) {
        expect(
          draft.structure.filter(
            (p) => p.kind === "section" && p.key === section.key,
          ),
        ).toHaveLength(1);
      }
      expect(draft.structure).toHaveLength(
        draft.fields.length + draft.sections.length,
      );
    });

    it("5. output is already canonical: validateDraftV2 accepts it unchanged", () => {
      const draft = compile([
        {
          kind: "section",
          label: "Attributes",
          children: [
            { kind: "field", label: "Strength", control: { kind: "rating" } },
          ],
        },
      ]);

      expect(() => validateDraftV2(draft)).not.toThrow();
      // Idempotent: revalidating returns equal content, so the producer needed
      // no repair pass.
      expect(validateDraftV2(draft)).toEqual(draft);
    });

    it("6. needs no migration to be read back as canonical V2", () => {
      const draft = compile([
        {
          kind: "section",
          label: "Attributes",
          children: [
            { kind: "field", label: "Strength", control: { kind: "rating" } },
          ],
        },
      ]);

      // parseCanonicalCharacterSheetDraft dispatches on schemaVersion "2" and
      // takes the direct V2 path — the strict V1 parse/migrate branch is never
      // entered for producer output.
      expect(parseCanonicalCharacterSheetDraft(draft)).toEqual(draft);
    });
  });

  describe("CANONICAL PREORDER — produced, not repaired", () => {
    it("7. a section is followed by its own fields, then its child sections", () => {
      const draft = compile([
        {
          kind: "section",
          label: "Outer",
          children: [
            { kind: "field", label: "First", control: { kind: "text" } },
            {
              kind: "section",
              label: "Inner",
              children: [
                { kind: "field", label: "Nested", control: { kind: "text" } },
              ],
            },
            { kind: "field", label: "Second", control: { kind: "text" } },
          ],
        },
      ]);

      expect(placementKeys(draft)).toEqual([
        "section:outer",
        "field:first",
        "section:inner",
        "field:nested",
        "field:second",
      ]);
      expect(draft.structure[3]).toEqual({
        kind: "field",
        key: "nested",
        parentKey: "inner",
      });
    });

    it("8. sibling sections keep document order", () => {
      const draft = compile([
        {
          kind: "section",
          label: "Alpha",
          children: [{ kind: "field", label: "A", control: { kind: "text" } }],
        },
        {
          kind: "section",
          label: "Beta",
          children: [{ kind: "field", label: "B", control: { kind: "text" } }],
        },
      ]);

      expect(placementKeys(draft)).toEqual([
        "section:alpha",
        "field:a",
        "section:beta",
        "field:b",
      ]);
    });

    it("9. deep nesting stays contiguous and depth-legal", () => {
      const draft = compile([
        {
          kind: "section",
          label: "L1",
          children: [
            {
              kind: "section",
              label: "L2",
              children: [
                {
                  kind: "section",
                  label: "L3",
                  children: [
                    { kind: "field", label: "Deep", control: { kind: "text" } },
                  ],
                },
              ],
            },
          ],
        },
      ]);

      expect(placementKeys(draft)).toEqual([
        "section:l1",
        "section:l2",
        "section:l3",
        "field:deep",
      ]);
      expect(() => validateDraftV2(draft)).not.toThrow();
    });
  });

  describe("FIELD COMPILATION — parity with the V1 producer", () => {
    it("10. maps a rating control to a bounded number field", () => {
      const draft = compile([
        {
          kind: "field",
          label: "Strength",
          control: { kind: "rating", constraints: { min: 0, max: 5 } },
          value: 3,
        },
      ]);

      expect(draft.fields).toEqual([
        {
          key: "strength",
          label: "Strength",
          type: "number",
          locked: false,
          min: 0,
          max: 5,
        },
      ]);
      expect(draft.values).toEqual({ strength: 3 });
    });

    it("11. carries observed choice options and drops constraints elsewhere", () => {
      const draft = compile([
        {
          kind: "field",
          label: "Align",
          control: {
            kind: "choice",
            constraints: { options: ["Law", "Chaos"] },
          },
          value: "Law",
        },
      ]);

      expect(draft.fields[0]).toMatchObject({
        type: "choice",
        options: ["Law", "Chaos"],
      });
      expect(draft.values).toEqual({ align: "Law" });
    });

    it("12. derives unique safe keys with numeric collision suffixes", () => {
      const draft = compile([
        { kind: "field", label: "Aptitud!", control: { kind: "text" } },
        { kind: "field", label: "Aptitud?", control: { kind: "number" } },
        { kind: "field", label: "Aptitúd", control: { kind: "checkbox" } },
      ]);

      expect(draft.fields.map((field) => field.key)).toEqual([
        "aptitud",
        "aptitud_2",
        "aptitud_3",
      ]);
      // Keys stay inside the draft-key alphabet and length budget.
      for (const field of draft.fields) {
        expect(field.key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
        expect(field.key.length).toBeLessThanOrEqual(128);
      }
    });

    it("13. omits a type-incompatible observed value", () => {
      const draft = compile([
        {
          kind: "field",
          label: "Score",
          control: { kind: "number" },
          value: "not-a-number",
        },
        { kind: "field", label: "Flavor", control: { kind: "text" } },
      ]);

      expect(draft.values).toEqual({});
      expect(draft.fields.map((field) => field.key)).toEqual([
        "score",
        "flavor",
      ]);
    });
  });

  describe("characterName MIRROR INVARIANT", () => {
    it("14. mirrors an observed textual character_name", () => {
      const draft = compile([
        {
          kind: "field",
          label: "Character Name",
          control: { kind: "text" },
          value: "Aria Stone",
        },
      ]);

      expect(draft.values.character_name).toBe("Aria Stone");
      expect(draft.characterName).toBe("Aria Stone");
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("15. drops a non-string character_name and nulls the mirror", () => {
      // A "Character Name" column misread as a number cannot satisfy the V2
      // mirror rule. The domain convention (set_field_type / clear_value) drops
      // the value and nulls the mirror rather than keeping a non-string value.
      const draft = compile([
        {
          kind: "field",
          label: "Character Name",
          control: { kind: "number" },
          value: 7,
        },
      ]);

      expect(draft.values.character_name).toBeUndefined();
      expect(draft.characterName).toBeNull();
      expect(() => validateDraftV2(draft)).not.toThrow();
    });

    it("16. characterName is null when no character_name was observed", () => {
      const draft = compile([
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ]);

      expect(draft.characterName).toBeNull();
      expect(() => validateDraftV2(draft)).not.toThrow();
    });
  });

  describe("validateDraftV2 GATE", () => {
    it("17. rejects an empty field set with the V1 producer's error", () => {
      // Structural parity with the V1 producer: same plain Error, same message.
      expect(() =>
        compile([
          {
            kind: "section",
            label: "Empty",
            children: [
              {
                kind: "section",
                label: "AlsoEmpty",
                children: [],
              },
            ],
          },
        ]),
      ).toThrowError("Observed structure contains no editable fields.");
    });

    it("18. rejects a field set over the surface budget", () => {
      const nodes = Array.from(
        { length: MAX_DRAFT_SURFACE_FIELDS + 1 },
        (_, i) => ({
          kind: "field" as const,
          label: `Field ${i}`,
          control: { kind: "text" as const },
        }),
      );

      // validateDraftV2 is the gate: it rejects rather than truncating.
      expectGateRejection(
        () => compile(nodes),
        new RegExp(`<=${MAX_DRAFT_SURFACE_FIELDS} items`, "i"),
      );
    });

    it("19. rejects a section count over the section budget", () => {
      const nodes = Array.from({ length: MAX_DRAFT_SECTIONS + 1 }, (_, i) => ({
        kind: "section" as const,
        label: `Section ${i}`,
        children: [
          {
            kind: "field" as const,
            label: `Field ${i}`,
            control: { kind: "text" as const },
          },
        ],
      }));

      expectGateRejection(
        () => compile(nodes),
        new RegExp(`<=${MAX_DRAFT_SECTIONS} items`, "i"),
      );
    });

    it("20. rejects untrusted input at the extraction boundary", () => {
      expect(() =>
        compileExtractedCharacterStructureV2({
          // Nodes must be at least one; an empty list is invalid input.
          structure: structureOf([]),
          sessionId: SESSION_ID,
          sourceSheetId: null,
        }),
      ).toThrow();
    });

    it("20b. accepts exactly the budget and rejects one over it", () => {
      // Boundary pair proving the gate is what rejects the over-budget draft,
      // rather than some incidental limit: 192 fields is accepted, 193 is not.
      // Both inputs stay under the extraction node budget (240), so the
      // extraction boundary is not what fails.
      const fieldsAt = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
          kind: "field" as const,
          label: `Field ${i}`,
          control: { kind: "text" as const },
        }));

      const atLimit = compile(fieldsAt(MAX_DRAFT_SURFACE_FIELDS));
      expect(atLimit.fields).toHaveLength(MAX_DRAFT_SURFACE_FIELDS);
      expect(atLimit.structure).toHaveLength(MAX_DRAFT_SURFACE_FIELDS);

      expectGateRejection(
        () => compile(fieldsAt(MAX_DRAFT_SURFACE_FIELDS + 1)),
        new RegExp(`<=${MAX_DRAFT_SURFACE_FIELDS} items`, "i"),
      );
    });
  });

  describe("REFERENCE SEMANTICS — purity", () => {
    it("21. never mutates the caller's structure", () => {
      const input = structureOf([
        {
          kind: "section",
          label: "Attributes",
          children: [
            {
              kind: "field",
              label: "Strength",
              control: { kind: "rating", constraints: { min: 0, max: 5 } },
              value: 3,
            },
          ],
        },
      ]);
      const before = structuredClone(input);

      compileExtractedCharacterStructureV2({
        structure: input,
        sessionId: SESSION_ID,
        sourceSheetId: "sheet",
      });

      expect(input).toEqual(before);
    });

    it("22. does not alias caller objects into the produced draft", () => {
      const input = structureOf([
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ]);

      const draft = compileExtractedCharacterStructureV2({
        structure: input,
        sessionId: SESSION_ID,
        sourceSheetId: "sheet",
      });

      // No output collection may be the caller's array or node object.
      expect(draft.fields).not.toBe(input.nodes);
      expect(draft.fields[0]).not.toBe(input.nodes[0]);
      expect(draft.sections).not.toBe(input.nodes);
      expect(draft.values).not.toBe(input.nodes);
      expect(draft.structure).not.toBe(input.nodes);
    });

    it("23. repeated calls are independent and carry fresh identities", () => {
      const nodes: ExtractedCharacterStructure["nodes"] = [
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ];
      const first = compile(nodes);
      const second = compile(nodes);

      expect(first.structure).not.toBe(second.structure);
      expect(first.fields).not.toBe(second.fields);
      expect(first.values).not.toBe(second.values);
      // draftId is server-minted per draft, so two producers never collide.
      expect(first.draftId).not.toBe(second.draftId);
      // Structurally identical apart from identity.
      expect({ ...first, draftId: null }).toEqual({
        ...second,
        draftId: null,
      });
    });

    it("24. mutating a produced draft does not affect a later production", () => {
      const nodes: ExtractedCharacterStructure["nodes"] = [
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ];
      const first = compile(nodes);
      first.fields.push({
        key: "injected",
        label: "Injected",
        type: "text",
        locked: false,
      });
      first.values.injected = "mutated";

      const second = compile(nodes);

      expect(second.fields.map((field) => field.key)).toEqual(["notes"]);
      expect(second.values).toEqual({});
    });

    it("25. key uniqueness is tracked per call, not across calls", () => {
      const nodes: ExtractedCharacterStructure["nodes"] = [
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ];

      expect(compile(nodes).fields[0]?.key).toBe("notes");
      // A second call must not see the first call's "notes" as taken.
      expect(compile(nodes).fields[0]?.key).toBe("notes");
    });
  });

  describe("PROVENANCE", () => {
    it("26. preserves a null source sheet id", () => {
      const draft = compile(
        [{ kind: "field", label: "Notes", control: { kind: "textarea" } }],
        null,
      );

      expect(draft.source).toEqual({ sourceSheetId: null, sourceRunId: null });
    });

    it("27. mints an opaque path-safe draft id", () => {
      const draft = compile([
        { kind: "field", label: "Notes", control: { kind: "textarea" } },
      ]);

      expect(draft.draftId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });
});
