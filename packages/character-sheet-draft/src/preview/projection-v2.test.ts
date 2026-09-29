import { describe, expect, it } from "vitest";
import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
  type CharacterSheetField,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import { buildDraftStructuralReadModelV2 } from "../draft-read-model-v2";
import type { DraftField } from "../draft-schema";
import type { CharacterSheetDraftV2, DraftPlacement } from "../draft-schema-v2";
import { DraftError } from "../errors";
import { makeDraft as makeV1Draft } from "../draft-fixture";
import { projectDraftToSpec } from "./projection";
import { projectDraftV2ToSpec } from "./projection-v2";

/**
 * Rich canonical V2 fixture shaped like:
 *
 *   Root
 *   ├─ Field root_a
 *   ├─ Section attributes
 *   │  ├─ Field strength
 *   │  ├─ Section derived
 *   │  │  └─ Field initiative
 *   │  └─ Field dexterity
 *   ├─ Field root_b
 *   ├─ Section equipment
 *   │  └─ Field weapon
 *   └─ Field character_name
 *
 * `fields[]` and `sections[]` are registered in an order that does NOT match
 * `structure[]`, so every ordering assertion proves registry order never leaks
 * into the projection.
 */
function makeRichDraft(
  overrides: Partial<CharacterSheetDraftV2> = {},
): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.projection",
    sessionId: "session.projection",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: "ctx.core.001",
    fields: [
      { key: "dexterity", label: "Dexterity", type: "number", locked: false },
      { key: "root_b", label: "Root B", type: "text", locked: false },
      { key: "initiative", label: "Initiative", type: "number", locked: true },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow"],
        locked: true,
      },
      { key: "root_a", label: "Root A", type: "text", locked: false },
      { key: "character_name", label: "Name", type: "text", locked: false },
      { key: "strength", label: "Strength", type: "number", locked: true },
    ],
    sections: [
      { key: "equipment", title: "Equipment" },
      { key: "derived", title: "Derived" },
      { key: "attributes", title: "Attributes" },
    ],
    structure: [
      { kind: "field", key: "root_a", parentKey: null },
      { kind: "section", key: "attributes", parentKey: null },
      { kind: "field", key: "strength", parentKey: "attributes" },
      { kind: "section", key: "derived", parentKey: "attributes" },
      { kind: "field", key: "initiative", parentKey: "derived" },
      { kind: "field", key: "dexterity", parentKey: "attributes" },
      { kind: "field", key: "root_b", parentKey: null },
      { kind: "section", key: "equipment", parentKey: null },
      { kind: "field", key: "weapon", parentKey: "equipment" },
      { kind: "field", key: "character_name", parentKey: null },
    ],
    values: {
      character_name: "Aria Stone",
      root_a: "Root A",
      strength: 12,
      initiative: 15,
      dexterity: 14,
      root_b: "Root B",
      weapon: "sword",
    },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

/** Builds a canonical draft from parallel registries plus explicit structure. */
function makeDraft(options: {
  fields: readonly DraftField[];
  sections?: readonly { key: string; title: string }[];
  structure: readonly DraftPlacement[];
  mode?: "pc" | "npc";
  characterName?: string | null;
  values?: Record<string, string | number | boolean | null | string[]>;
  draftId?: string;
  rulesContextId?: string | null;
  baseVersion?: number;
  version?: number;
  confirmed?: boolean;
}): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: options.draftId ?? "draft.projection.generic",
    sessionId: "session.projection",
    baseVersion: options.baseVersion ?? 1,
    version: options.version ?? 1,
    mode: options.mode ?? "pc",
    characterName: options.characterName ?? null,
    rulesContextId: options.rulesContextId ?? null,
    fields: options.fields.map((field) => ({ ...field })),
    sections: (options.sections ?? []).map((section) => ({ ...section })),
    structure: options.structure.map((placement) => ({ ...placement })),
    values: { ...(options.values ?? {}) },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: options.confirmed ?? false,
  };
}

function textField(key: string, label = key): DraftField {
  return { key, label, type: "text", locked: false };
}

/** Canonical Field order taken from the approved 4C1 read model. */
function canonicalFieldKeys(draft: CharacterSheetDraftV2): string[] {
  return buildDraftStructuralReadModelV2(draft)
    .preorder.filter((node) => node.kind === "field")
    .map((node) => node.key);
}

/** Renders the flat spec back into one Field traversal: page -> section -> field. */
function flattenedFieldIds(spec: CharacterSheetSpec): string[] {
  const sectionById = new Map(spec.sections.map((s) => [s.id, s]));
  const flattened: string[] = [];
  for (const page of spec.pages) {
    for (const sectionId of page.layout.sectionIds) {
      const section = sectionById.get(sectionId);
      if (section === undefined) {
        throw new Error(`Page "${page.id}" references missing section.`);
      }
      flattened.push(...section.fieldIds);
    }
  }
  return flattened;
}

function fieldIdsOfTitle(spec: CharacterSheetSpec, title: string): string[][] {
  return spec.sections
    .filter((section) => section.title === title)
    .map((section) => section.fieldIds);
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

function expectSchemaAndDomainValid(spec: CharacterSheetSpec): void {
  expect(CharacterSheetSpecSchema.safeParse(spec).success).toBe(true);
  expect(validateCharacterSheetSpecDomain(spec).valid).toBe(true);
}

const RICH_FIELD_ORDER = [
  "root_a",
  "strength",
  "initiative",
  "dexterity",
  "root_b",
  "weapon",
  "character_name",
];

const RICH_GROUP_SEQUENCE = [
  "Character",
  "Attributes",
  "Attributes · Derived",
  "Attributes",
  "Character",
  "Equipment",
  "Character",
];

describe("projection-v2 BLOCK A canonical Field order", () => {
  it("1. spec.fields order equals canonical Field preorder", () => {
    const draft = makeRichDraft();
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.fields.map((field) => field.id)).toEqual(RICH_FIELD_ORDER);
    expect(spec.fields.map((field) => field.id)).toEqual(
      canonicalFieldKeys(draft),
    );
  });

  it("2. registry order deliberately differs and is ignored", () => {
    const draft = makeRichDraft();
    const registryOrder = draft.fields.map((field) => field.key);
    expect(registryOrder).not.toEqual(RICH_FIELD_ORDER);
    expect(registryOrder[0]).toBe("dexterity");

    const spec = projectDraftV2ToSpec(draft);
    expect(spec.fields.map((field) => field.id)).not.toEqual(registryOrder);
    expect(spec.fields[0]?.id).toBe("root_a");
  });

  it("3. every canonical Field appears exactly once", () => {
    const draft = makeRichDraft();
    const spec = projectDraftV2ToSpec(draft);
    const ids = spec.fields.map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...canonicalFieldKeys(draft)].sort());
  });

  it("4. no Field is dropped", () => {
    const draft = makeRichDraft();
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.fields).toHaveLength(draft.fields.length);
  });

  it("5. no Field is duplicated across sections", () => {
    const draft = makeRichDraft();
    const spec = projectDraftV2ToSpec(draft);
    const all = spec.sections.flatMap((section) => section.fieldIds);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([...canonicalFieldKeys(draft)].sort());
  });

  it("6. page/section flattening reproduces canonical Field preorder", () => {
    const draft = makeRichDraft();
    const spec = projectDraftV2ToSpec(draft);
    expect(flattenedFieldIds(spec)).toEqual(canonicalFieldKeys(draft));
    expect(flattenedFieldIds(spec)).toEqual(RICH_FIELD_ORDER);
  });
});

describe("projection-v2 BLOCK B nested interruption", () => {
  it("7. a nested Section interrupts the parent Field run", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    expect(fieldIdsOfTitle(spec, "Attributes")).toEqual([
      ["strength"],
      ["dexterity"],
    ]);
    expect(fieldIdsOfTitle(spec, "Attributes · Derived")).toEqual([
      ["initiative"],
    ]);
  });

  it("8. the parent run is never merged across the child Section", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    const attributes = fieldIdsOfTitle(spec, "Attributes");
    expect(attributes).toHaveLength(2);
    for (const run of attributes) {
      expect(run).not.toContain("initiative");
      expect(run).not.toContain("strength,dexterity");
    }
    expect(attributes.flat()).toEqual(["strength", "dexterity"]);
  });

  it("9. rendered order is strength, initiative, dexterity", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    const page = spec.pages[0];
    const sectionById = new Map(spec.sections.map((s) => [s.id, s]));
    const order: string[] = [];
    for (const sectionId of page?.layout.sectionIds ?? []) {
      const section = sectionById.get(sectionId);
      if (section === undefined) continue;
      if (section.title.startsWith("Attributes")) {
        order.push(...section.fieldIds);
      }
    }
    expect(order).toEqual(["strength", "initiative", "dexterity"]);
  });
});

describe("projection-v2 BLOCK C root interleaving", () => {
  it("10. interleaved root Fields and Sections keep canonical order", () => {
    const draft = makeDraft({
      fields: [textField("a"), textField("b"), textField("c")],
      sections: [
        { key: "s1", title: "S1" },
        { key: "s2", title: "S2" },
      ],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "section", key: "s1", parentKey: null },
        { kind: "field", key: "b", parentKey: "s1" },
        { kind: "section", key: "s2", parentKey: null },
        { kind: "field", key: "c", parentKey: "s2" },
      ],
    });
    const spec = projectDraftV2ToSpec(draft);
    // Root "a" is neither deferred to the end nor merged with "b"/"c": the
    // intervening Sections split the root context into separate runs.
    expect(spec.fields.map((field) => field.id)).toEqual(["a", "b", "c"]);
    expect(flattenedFieldIds(spec)).toEqual(["a", "b", "c"]);
    expect(spec.sections.map((section) => section.title)).toEqual([
      "Character",
      "S1",
      "S2",
    ]);
    expect(spec.sections.map((section) => section.fieldIds)).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("11. root Fields are not deferred into an Other fields bucket", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    const titles = spec.sections.map((section) => section.title);
    expect(titles).toEqual(RICH_GROUP_SEQUENCE);
    expect(titles.some((title) => /other|ungrouped/i.test(title))).toBe(false);
    expect(flattenedFieldIds(spec).slice(0, 1)).toEqual(["root_a"]);
  });

  it("12. multiple separated root runs share one semantic title", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    expect(fieldIdsOfTitle(spec, "Character")).toEqual([
      ["root_a"],
      ["root_b"],
      ["character_name"],
    ]);
  });

  it("13. an NPC draft titles root runs NPC", () => {
    const draft = makeRichDraft();
    const npc: CharacterSheetDraftV2 = { ...draft, mode: "npc" };
    const spec = projectDraftV2ToSpec(npc);
    expect(spec.mode).toBe("npc");
    for (const title of spec.sections.map((section) => section.title)) {
      expect(title === "NPC" || /[A-Za-z]/.test(title)).toBe(true);
    }
    expect(
      spec.sections.filter((section) => section.title === "Character"),
    ).toHaveLength(0);
    expect(
      spec.sections.filter((section) => section.title === "NPC").length,
    ).toBe(3);
  });
});

describe("projection-v2 BLOCK D hierarchy titles", () => {
  it("14. a direct Section child uses the Section title", () => {
    const draft = makeDraft({
      fields: [textField("weapon")],
      sections: [{ key: "equipment", title: "Equipment" }],
      structure: [
        { kind: "section", key: "equipment", parentKey: null },
        { kind: "field", key: "weapon", parentKey: "equipment" },
      ],
    });
    expect(projectDraftV2ToSpec(draft).sections[0]?.title).toBe("Equipment");
  });

  it("15. a nested Section child uses the full ancestry path", () => {
    const draft = makeDraft({
      fields: [textField("attack")],
      sections: [
        { key: "combat", title: "Combat" },
        { key: "offense", title: "Offense" },
      ],
      structure: [
        { kind: "section", key: "combat", parentKey: null },
        { kind: "section", key: "offense", parentKey: "combat" },
        { kind: "field", key: "attack", parentKey: "offense" },
      ],
    });
    expect(projectDraftV2ToSpec(draft).sections[0]?.title).toBe(
      "Combat · Offense",
    );
  });

  it("16. depth 3 produces a deterministic three-part path", () => {
    const draft = makeDraft({
      fields: [textField("deep")],
      sections: [
        { key: "a", title: "A" },
        { key: "b", title: "B" },
        { key: "c", title: "C" },
      ],
      structure: [
        { kind: "section", key: "a", parentKey: null },
        { kind: "section", key: "b", parentKey: "a" },
        { kind: "section", key: "c", parentKey: "b" },
        { kind: "field", key: "deep", parentKey: "c" },
      ],
    });
    const first = projectDraftV2ToSpec(draft);
    const second = projectDraftV2ToSpec(draft);
    expect(first.sections[0]?.title).toBe("A · B · C");
    expect(second.sections[0]?.title).toBe("A · B · C");
  });

  it("17. returning to a parent reuses the same title in a new group", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    const attributes = spec.sections.filter(
      (section) => section.title === "Attributes",
    );
    expect(attributes).toHaveLength(2);
    expect(attributes[0]?.id).not.toBe(attributes[1]?.id);
  });

  it("18. Section titles are never mutated", () => {
    const draft = makeRichDraft();
    projectDraftV2ToSpec(draft);
    expect(draft.sections.map((section) => section.title)).toEqual([
      "Equipment",
      "Derived",
      "Attributes",
    ]);
    expect(
      draft.sections.map((section) => Object.keys(section).sort().join(",")),
    ).toEqual(["key,title", "key,title", "key,title"]);
  });
});

describe("projection-v2 BLOCK E empty Sections", () => {
  it("19. an empty leaf Section produces no spec Section", () => {
    const draft = makeDraft({
      fields: [textField("a")],
      sections: [{ key: "empty", title: "Empty" }],
      structure: [
        { kind: "section", key: "empty", parentKey: null },
        { kind: "field", key: "a", parentKey: null },
      ],
    });
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0]?.title).toBe("Character");
    for (const section of spec.sections) {
      expect(section.fieldIds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("20. an empty parent does not suppress a non-empty descendant", () => {
    const draft = makeDraft({
      fields: [textField("attack")],
      sections: [
        { key: "combat", title: "Combat" },
        { key: "offense", title: "Offense" },
      ],
      structure: [
        { kind: "section", key: "combat", parentKey: null },
        { kind: "section", key: "offense", parentKey: "combat" },
        { kind: "field", key: "attack", parentKey: "offense" },
      ],
    });
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0]?.title).toBe("Combat · Offense");
  });

  it("21. an empty Section between root Fields changes no order", () => {
    const draft = makeDraft({
      fields: [textField("a"), textField("b")],
      sections: [{ key: "empty", title: "Empty" }],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "section", key: "empty", parentKey: null },
        { kind: "field", key: "b", parentKey: null },
      ],
    });
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.fields.map((field) => field.id)).toEqual(["a", "b"]);
    expect(flattenedFieldIds(spec)).toEqual(["a", "b"]);
    expectSchemaAndDomainValid(spec);
  });

  it("22. empty Sections keep the spec schema and domain valid", () => {
    for (const draft of [
      makeRichDraft(),
      makeDraft({
        fields: [textField("a")],
        sections: [{ key: "empty", title: "Empty" }],
        structure: [
          { kind: "section", key: "empty", parentKey: null },
          { kind: "field", key: "a", parentKey: null },
        ],
      }),
    ]) {
      expectSchemaAndDomainValid(projectDraftV2ToSpec(draft));
    }
  });
});

describe("projection-v2 BLOCK F oversized run chunking", () => {
  const oversized = (): CharacterSheetDraftV2 => {
    const keys = Array.from({ length: 70 }, (_, index) => `bulk_${index}`);
    return makeDraft({
      fields: keys.map((key) => textField(key)),
      structure: keys.map((key) => ({
        kind: "field" as const,
        key,
        parentKey: null,
      })),
    });
  };

  it("23. an oversized run is split at the flat capacity", () => {
    const spec = projectDraftV2ToSpec(oversized());
    expect(spec.sections).toHaveLength(2);
    expect(spec.sections[0]?.fieldIds).toHaveLength(64);
    expect(spec.sections[1]?.fieldIds).toHaveLength(6);
  });

  it("24. no projected Section exceeds 64 fieldIds", () => {
    const spec = projectDraftV2ToSpec(oversized());
    for (const section of spec.sections) {
      expect(section.fieldIds.length).toBeLessThanOrEqual(64);
    }
  });

  it("25. chunking preserves order and coverage exactly", () => {
    const draft = oversized();
    const spec = projectDraftV2ToSpec(draft);
    expect(flattenedFieldIds(spec)).toEqual(canonicalFieldKeys(draft));
    const all = spec.sections.flatMap((section) => section.fieldIds);
    expect(new Set(all).size).toBe(all.length);
    expect(spec.fields).toHaveLength(70);
  });

  it("26. continuation groups have deterministic unique IDs and titles", () => {
    const first = projectDraftV2ToSpec(oversized());
    const second = projectDraftV2ToSpec(oversized());
    expect(first.sections.map((s) => s.id)).toEqual([
      "draft.v2.section.0",
      "draft.v2.section.1",
    ]);
    expect(first.sections.map((s) => s.title)).toEqual([
      "Character",
      "Character",
    ]);
    expect(second).toEqual(first);
    expect(new Set(first.sections.map((s) => s.id)).size).toBe(2);
  });

  it("27. placement.order restarts per chunk", () => {
    const spec = projectDraftV2ToSpec(oversized());
    const byId = new Map(spec.fields.map((field) => [field.id, field]));
    for (const section of spec.sections) {
      const orders = section.fieldIds.map(
        (id) => byId.get(id)?.placement.order ?? -1,
      );
      expect(orders).toEqual(section.fieldIds.map((_, index) => index));
    }
  });
});

describe("projection-v2 BLOCK G page chunking", () => {
  /** 10 root runs + 10 Section runs = 20 projected Sections (2 pages). */
  const manyGroups = (): CharacterSheetDraftV2 => {
    const fields: DraftField[] = [];
    const sections: { key: string; title: string }[] = [];
    const structure: DraftPlacement[] = [];
    for (let index = 0; index < 10; index += 1) {
      const rootKey = `r${index}`;
      const sectionKey = `s${index}`;
      const childKey = `c${index}`;
      fields.push(textField(rootKey), textField(childKey));
      sections.push({ key: sectionKey, title: `S${index}` });
      structure.push({ kind: "field", key: rootKey, parentKey: null });
      structure.push({ kind: "section", key: sectionKey, parentKey: null });
      structure.push({ kind: "field", key: childKey, parentKey: sectionKey });
    }
    return makeDraft({ fields, sections, structure });
  };

  it("28. more than 16 projected Sections produce multiple pages", () => {
    const spec = projectDraftV2ToSpec(manyGroups());
    expect(spec.sections).toHaveLength(20);
    expect(spec.pages).toHaveLength(2);
    expect(spec.pages.map((page) => page.id)).toEqual([
      "draft.v2.page.0",
      "draft.v2.page.1",
    ]);
  });

  it("29. every page respects the 16-section limit", () => {
    const spec = projectDraftV2ToSpec(manyGroups());
    for (const page of spec.pages) {
      expect(page.layout.sectionIds.length).toBeLessThanOrEqual(16);
    }
    expect(spec.pages[0]?.layout.sectionIds).toHaveLength(16);
    expect(spec.pages[1]?.layout.sectionIds).toHaveLength(4);
  });

  it("30. every Section is referenced exactly once", () => {
    const spec = projectDraftV2ToSpec(manyGroups());
    const referenced = spec.pages.flatMap((page) => page.layout.sectionIds);
    expect(new Set(referenced).size).toBe(referenced.length);
    expect(referenced.sort()).toEqual(
      spec.sections.map((section) => section.id).sort(),
    );
  });

  it("31. global group order is preserved across the page boundary", () => {
    const spec = projectDraftV2ToSpec(manyGroups());
    expect(spec.pages.flatMap((page) => page.layout.sectionIds)).toEqual(
      spec.sections.map((section) => section.id),
    );
    expect(flattenedFieldIds(spec)).toEqual(canonicalFieldKeys(manyGroups()));
    expectSchemaAndDomainValid(spec);
  });

  it("32. layout.order is a page-local ordinal", () => {
    const spec = projectDraftV2ToSpec(manyGroups());
    const byId = new Map(spec.sections.map((section) => [section.id, section]));
    for (const page of spec.pages) {
      const orders = page.layout.sectionIds.map(
        (id) => byId.get(id)?.layout.order ?? -1,
      );
      expect(orders).toEqual(page.layout.sectionIds.map((_, index) => index));
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});

describe("projection-v2 BLOCK H flat capacity alignment", () => {
  /**
   * Builds `pairs` interleaved root-Field / Section groups, each Section
   * holding `fieldsPerSection` child Fields.
   *
   * Projected groups = 2 * pairs: the Section boundary splits the root run, so
   * each pair yields one root group plus one Section group. Stays inside valid
   * V2 limits: Sections <= MAX_DRAFT_SECTIONS (48) and
   * Fields <= MAX_DRAFT_SURFACE_FIELDS (192).
   */
  const interleavedDraft = (
    pairs: number,
    fieldsPerSection = 1,
  ): CharacterSheetDraftV2 => {
    const fields: DraftField[] = [];
    const sections: { key: string; title: string }[] = [];
    const structure: DraftPlacement[] = [];
    for (let index = 0; index < pairs; index += 1) {
      const rootKey = `r${index}`;
      const sectionKey = `s${index}`;
      fields.push(textField(rootKey));
      sections.push({ key: sectionKey, title: `S${index}` });
      structure.push({ kind: "field", key: rootKey, parentKey: null });
      structure.push({ kind: "section", key: sectionKey, parentKey: null });
      for (let slot = 0; slot < fieldsPerSection; slot += 1) {
        const childKey = `c${index}_${slot}`;
        fields.push(textField(childKey));
        structure.push({
          kind: "field",
          key: childKey,
          parentKey: sectionKey,
        });
      }
    }
    return makeDraft({ fields, sections, structure });
  };

  /** The 4C2 fixture that previously failed: 25 pairs = 50 required Sections. */
  const overOldLimit = (): CharacterSheetDraftV2 => interleavedDraft(25);

  it("33. a valid draft requiring 50 groups now projects", () => {
    const spec = projectDraftV2ToSpec(overOldLimit());
    expect(spec.sections).toHaveLength(50);
  });

  it("34. the 50-group projection paginates 16/16/16/2", () => {
    const spec = projectDraftV2ToSpec(overOldLimit());
    expect(spec.pages).toHaveLength(4);
    expect(spec.pages.map((page) => page.layout.sectionIds.length)).toEqual([
      16, 16, 16, 2,
    ]);
  });

  it("35. the 50-group projection preserves canonical Field preorder", () => {
    const draft = overOldLimit();
    const spec = projectDraftV2ToSpec(draft);
    expect(flattenedFieldIds(spec)).toEqual(canonicalFieldKeys(draft));
    expect(flattenedFieldIds(spec)).toEqual(
      spec.fields.map((field) => field.id),
    );
  });

  it("36. no Field is merged or dropped to clear the old 48 limit", () => {
    const draft = overOldLimit();
    const spec = projectDraftV2ToSpec(draft);
    const all = spec.sections.flatMap((section) => section.fieldIds);
    expect(all).toHaveLength(draft.fields.length);
    expect(new Set(all).size).toBe(all.length);
    for (const section of spec.sections) {
      expect(section.fieldIds.length).toBeGreaterThanOrEqual(1);
    }
    expectSchemaAndDomainValid(spec);
  });

  it("37. groups 48, 49 and 50 all exist with deterministic IDs", () => {
    const spec = projectDraftV2ToSpec(overOldLimit());
    const ids = spec.sections.map((section) => section.id);
    expect(ids).toHaveLength(50);
    expect(ids[47]).toBe("draft.v2.section.47");
    expect(ids[48]).toBe("draft.v2.section.48");
    expect(ids[49]).toBe("draft.v2.section.49");
    expect(new Set(ids).size).toBe(50);
    expect(spec.sections[47]?.fieldIds).toEqual(["c23_0"]);
    expect(spec.sections[48]?.fieldIds).toEqual(["r24"]);
    expect(spec.sections[49]?.fieldIds).toEqual(["c24_0"]);
  });

  it("38. every projected Section stays non-empty at high group counts", () => {
    const spec = projectDraftV2ToSpec(overOldLimit());
    for (const section of spec.sections) {
      expect(section.fieldIds).not.toHaveLength(0);
    }
  });

  it("39. layout.order remains page-local unique across 4 pages", () => {
    const spec = projectDraftV2ToSpec(overOldLimit());
    const byId = new Map(spec.sections.map((section) => [section.id, section]));
    for (const page of spec.pages) {
      const orders = page.layout.sectionIds.map(
        (id) => byId.get(id)?.layout.order ?? -1,
      );
      expect(orders).toEqual(page.layout.sectionIds.map((_, index) => index));
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("40. the projection is deterministic at 50 groups", () => {
    const draft = overOldLimit();
    expect(projectDraftV2ToSpec(draft)).toEqual(
      projectDraftV2ToSpec(interleavedDraft(25)),
    );
  });

  it("41. an 80-group draft projects and preserves order", () => {
    const draft = interleavedDraft(40);
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.sections).toHaveLength(80);
    expect(spec.pages).toHaveLength(5);
    expect(flattenedFieldIds(spec)).toEqual(canonicalFieldKeys(draft));
    expectSchemaAndDomainValid(spec);
  });

  it("42. a 96-group draft at the V2 Section limit projects", () => {
    // 48 Sections is MAX_DRAFT_SECTIONS, the canonical V2 ceiling, and each
    // Section splits one root group, so 96 is the maximum reachable group count.
    const draft = interleavedDraft(48);
    expect(draft.sections).toHaveLength(48);
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.sections).toHaveLength(96);
    expect(spec.pages).toHaveLength(6);
    expect(flattenedFieldIds(spec)).toEqual(canonicalFieldKeys(draft));
    expectSchemaAndDomainValid(spec);
  });

  it("43. projected Sections never exceed canonical Fields", () => {
    for (const draft of [
      makeRichDraft(),
      interleavedDraft(25),
      interleavedDraft(40),
      interleavedDraft(48),
    ]) {
      const spec = projectDraftV2ToSpec(draft);
      expect(spec.sections.length).toBeLessThanOrEqual(draft.fields.length);
    }
  });

  it("44. the 192-Field maximum V2 draft projects at capacity", () => {
    // 48 Sections x 4 Fields = 192 canonical Fields, the MAX_DRAFT_SURFACE_FIELDS
    // ceiling, projecting 96 non-empty Sections.
    const draft = interleavedDraft(48, 3);
    expect(draft.fields).toHaveLength(192);
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.sections).toHaveLength(96);
    expect(spec.sections.length).toBeLessThanOrEqual(draft.fields.length);
    expect(spec.pages).toHaveLength(6);
    expect(flattenedFieldIds(spec)).toEqual(canonicalFieldKeys(draft));
    expectSchemaAndDomainValid(spec);
  });

  it("45. the >192 guard stays unreachable for every valid V2 draft", () => {
    // Documents the invariant: because Sections <= Fields and V2 caps Fields at
    // 192, no valid draft can trip the defensive guard. The guard remains for a
    // future schema change, not for normal V2 input.
    for (const [pairs, perSection] of [
      [1, 1],
      [25, 1],
      [48, 1],
      [48, 3],
    ] as const) {
      const draft = interleavedDraft(pairs, perSection);
      expect(draft.fields.length).toBeLessThanOrEqual(192);
      const spec = projectDraftV2ToSpec(draft);
      expect(spec.sections.length).toBeLessThanOrEqual(192);
      for (const section of spec.sections) {
        expect(section.fieldIds.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("46. the projection never mutates a large draft", () => {
    const draft = interleavedDraft(48);
    const before = JSON.stringify(draft);
    projectDraftV2ToSpec(draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
});

describe("projection-v2 BLOCK I field conversion", () => {
  const typedDraft = (): CharacterSheetDraftV2 =>
    makeDraft({
      fields: [
        { key: "t", label: "Text", type: "text", locked: false },
        { key: "ta", label: "Textarea", type: "textarea", locked: false },
        {
          key: "n",
          label: "Number",
          type: "number",
          min: 1,
          max: 20,
          locked: false,
        },
        { key: "c", label: "Checkbox", type: "checkbox", locked: false },
        {
          key: "ch",
          label: "Choice",
          type: "choice",
          options: ["sword", "bow"],
          locked: false,
        },
        { key: "l", label: "List", type: "list", locked: false },
      ],
      sections: [{ key: "s", title: "Stats" }],
      structure: [
        { kind: "section", key: "s", parentKey: null },
        { kind: "field", key: "t", parentKey: "s" },
        { kind: "field", key: "ta", parentKey: "s" },
        { kind: "field", key: "n", parentKey: "s" },
        { kind: "field", key: "c", parentKey: "s" },
        { kind: "field", key: "ch", parentKey: "s" },
        { kind: "field", key: "l", parentKey: "s" },
      ],
      values: {
        t: "hello",
        ta: "notes",
        n: 12,
        c: true,
        ch: "bow",
        l: ["one", "two"],
      },
    });

  it("37. every V2 Field type maps to its V1 spec type", () => {
    const byId = new Map(
      projectDraftV2ToSpec(typedDraft()).fields.map((field) => [
        field.id,
        field,
      ]),
    );
    expect(byId.get("t")?.type).toBe("text");
    expect(byId.get("ta")?.type).toBe("textarea");
    expect(byId.get("n")?.type).toBe("number");
    expect(byId.get("c")?.type).toBe("checkbox");
    expect(byId.get("ch")?.type).toBe("select");
    expect(byId.get("l")?.type).toBe("list");
  });

  it("38. V2 and V1 conversions agree Field for Field", () => {
    const typed = typedDraft();
    const v2 = projectDraftV2ToSpec(typed);
    const v1 = projectDraftToSpec(
      makeV1Draft({
        characterName: null,
        fields: typed.fields,
        sections: [
          {
            key: "s",
            title: "Stats",
            fieldKeys: ["t", "ta", "n", "c", "ch", "l"],
          },
        ],
        values: typed.values,
      }),
    );
    const strip = (field: CharacterSheetField): unknown => {
      const { placement: _placement, ...rest } = field;
      return rest;
    };
    expect(v2.fields.map(strip)).toEqual(v1.fields.map(strip));
  });

  it("39. number bounds, choice options and list semantics are preserved", () => {
    const byId = new Map(
      projectDraftV2ToSpec(typedDraft()).fields.map((field) => [
        field.id,
        field,
      ]),
    );
    expect(byId.get("n")).toMatchObject({ min: 1, max: 20 });
    expect(byId.get("ch")).toMatchObject({
      options: [
        { value: "sword", label: "sword" },
        { value: "bow", label: "bow" },
      ],
    });
    expect(byId.get("l")).toMatchObject({ itemLabel: "List", maxItems: 100 });
    expect(byId.get("t")).toMatchObject({ maxLength: 2000 });
  });

  it("40. labels and requiredForPlayableNpc are preserved", () => {
    const byId = new Map(
      projectDraftV2ToSpec(typedDraft()).fields.map((field) => [
        field.id,
        field,
      ]),
    );
    for (const field of byId.values()) {
      expect(field.requiredForPlayableNpc).toBe(false);
    }
    expect(byId.get("ta")?.label).toBe("Textarea");
  });

  it("41. no new Field type is introduced", () => {
    const allowed = new Set([
      "text",
      "textarea",
      "number",
      "checkbox",
      "select",
      "list",
    ]);
    for (const field of projectDraftV2ToSpec(typedDraft()).fields) {
      expect(allowed.has(field.type)).toBe(true);
    }
  });
});

describe("projection-v2 BLOCK J placement order", () => {
  it("42. a multi-Field Section gets 0,1,2,... canonical local order", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    const section = spec.sections.find(
      (candidate) => candidate.title === "Attributes",
    );
    if (section === undefined)
      throw new Error("expected an Attributes section");
    const byId = new Map(spec.fields.map((field) => [field.id, field]));
    expect(section.fieldIds.map((id) => byId.get(id)?.placement.order)).toEqual(
      section.fieldIds.map((_, index) => index),
    );
  });

  it("43. a multi-Field run does not leave every field at order 0", () => {
    const draft = makeDraft({
      fields: [textField("a"), textField("b"), textField("c")],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "field", key: "b", parentKey: null },
        { kind: "field", key: "c", parentKey: null },
      ],
    });
    const spec = projectDraftV2ToSpec(draft);
    expect(spec.sections).toHaveLength(1);
    expect(spec.fields.map((field) => field.placement.order)).toEqual([
      0, 1, 2,
    ]);
    expect(
      spec.fields.filter((field) => field.placement.order === 0),
    ).toHaveLength(1);
  });

  it("44. conservative layout defaults are kept", () => {
    for (const field of projectDraftV2ToSpec(makeRichDraft()).fields) {
      expect(field.placement.columnStart).toBe(1);
      expect(field.placement.columnSpan).toBe(1);
      expect(field.placement.rowSpan).toBe(1);
      expect(field.placement.breakBefore).toBe(false);
    }
    for (const section of projectDraftV2ToSpec(makeRichDraft()).sections) {
      expect(section.layout.mode).toBe("flow");
      expect(section.layout.columns).toBe(1);
      expect(section.layout.emphasis).toBeNull();
    }
  });
});

describe("projection-v2 BLOCK K values and metadata", () => {
  it("45. only canonical Field values are emitted", () => {
    const draft = makeRichDraft();
    const spec = projectDraftV2ToSpec(draft);
    const canonical = new Set(canonicalFieldKeys(draft));
    for (const key of Object.keys(spec.values)) {
      expect(canonical.has(key)).toBe(true);
    }
    expect(Object.keys(spec.values).sort()).toEqual(
      Object.keys(draft.values).sort(),
    );
  });

  it("46. a Field with no value emits no value entry", () => {
    const draft = makeDraft({
      fields: [textField("a"), textField("b")],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "field", key: "b", parentKey: null },
      ],
      values: { a: "set" },
    });
    const spec = projectDraftV2ToSpec(draft);
    expect(Object.keys(spec.values)).toEqual(["a"]);
    expect(spec.values.b).toBeUndefined();
  });

  it("47. valid DraftValue values are preserved unchanged", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    expect(spec.values.strength).toBe(12);
    expect(spec.values.weapon).toBe("sword");
    expect(spec.values.character_name).toBe("Aria Stone");
  });

  it("48. characterName becomes metadata.title and defaults when absent", () => {
    expect(projectDraftV2ToSpec(makeRichDraft()).metadata.title).toBe(
      "Aria Stone",
    );
    const unnamed = makeDraft({
      fields: [textField("a"), textField("character_name")],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "field", key: "character_name", parentKey: null },
      ],
      characterName: null,
    });
    expect(projectDraftV2ToSpec(unnamed).metadata.title).toBe("Untitled draft");
  });

  it("48b. a null text value fails closed exactly as V1 does", () => {
    // A V2 draft may legitimately carry `values.character_name = null`, but
    // CharacterSheetSpec requires a text value to be a string. V1 projection
    // fails closed on the identical input, so this is an inherited
    // representational boundary rather than a V2 regression.
    const draft = makeRichDraft({
      characterName: null,
      values: { ...makeRichDraft().values, character_name: null },
    });
    expect(errorCodeOf(() => projectDraftV2ToSpec(draft))).toBe(
      "projection_invalid",
    );

    const v1Draft = makeV1Draft({
      characterName: null,
      fields: [
        { key: "character_name", label: "Name", type: "text", locked: false },
      ],
      sections: [],
      values: { character_name: null },
    });
    expect(errorCodeOf(() => projectDraftToSpec(v1Draft))).toBe(
      "projection_invalid",
    );
  });

  it("49. mode maps pc to player and npc to npc", () => {
    expect(projectDraftV2ToSpec(makeRichDraft()).mode).toBe("player");
    const draft = makeRichDraft();
    expect(projectDraftV2ToSpec({ ...draft, mode: "npc" }).mode).toBe("npc");
  });

  it("50. metadata id, description, locale and rulesContextId are stable", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    expect(spec.metadata.id).toBe("sheet.draft.draft.projection");
    expect(spec.metadata.description).toBeNull();
    expect(spec.metadata.locale).toBeNull();
    expect(spec.rulesContextId).toBe("ctx.core.001");
  });

  it("51. schemaVersion, sourceMap and theme are the deterministic defaults", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    expect(spec.schemaVersion).toBe("1");
    expect(spec.sourceMap).toEqual({});
    expect(spec.theme).toEqual({
      style: "minimal",
      typography: "serif",
      density: "standard",
      borderStyle: "none",
      decorationIntensity: "none",
      accentColor: "#332211",
      backgroundIntent: "none",
    });
  });

  it("52. metadata id follows the draftId deterministically", () => {
    const spec = projectDraftV2ToSpec(
      makeRichDraft({ draftId: "draft.other.id" }),
    );
    expect(spec.metadata.id).toBe("sheet.draft.draft.other.id");
  });
});

describe("projection-v2 BLOCK L lifecycle independence", () => {
  it("53. a confirmed draft projects normally", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft({ confirmed: true }));
    expect(spec.fields.map((field) => field.id)).toEqual(RICH_FIELD_ORDER);
    expectSchemaAndDomainValid(spec);
  });

  it("54. confirmed does not change the projection", () => {
    const open = projectDraftV2ToSpec(makeRichDraft({ confirmed: false }));
    const confirmed = projectDraftV2ToSpec(makeRichDraft({ confirmed: true }));
    expect(confirmed).toEqual(open);
  });

  it("55. version and baseVersion do not change the projection", () => {
    const base = projectDraftV2ToSpec(
      makeRichDraft({ version: 1, baseVersion: 1 }),
    );
    const bumped = projectDraftV2ToSpec(
      makeRichDraft({ version: 37, baseVersion: 4 }),
    );
    expect(bumped).toEqual(base);
  });
});

describe("projection-v2 BLOCK M determinism and purity", () => {
  it("56. repeated projection is deeply equal", () => {
    const draft = makeRichDraft();
    expect(projectDraftV2ToSpec(draft)).toEqual(projectDraftV2ToSpec(draft));
  });

  it("57. an identical clone projects to a deeply equal spec", () => {
    const draft = makeRichDraft();
    const clone = JSON.parse(JSON.stringify(draft)) as CharacterSheetDraftV2;
    expect(projectDraftV2ToSpec(clone)).toEqual(projectDraftV2ToSpec(draft));
  });

  it("58. no randomness, clock or UUID leaks into the spec", () => {
    const first = projectDraftV2ToSpec(makeRichDraft());
    const second = projectDraftV2ToSpec(makeRichDraft());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.metadata.id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("59. the draft and all registries are never mutated", () => {
    const draft = makeRichDraft();
    const before = JSON.stringify(draft);
    const fieldsRef = draft.fields;
    const sectionsRef = draft.sections;
    const structureRef = draft.structure;
    const valuesRef = draft.values;
    const beforeVersion = draft.version;
    const beforeBaseVersion = draft.baseVersion;

    const spec = projectDraftV2ToSpec(draft);

    expect(JSON.stringify(draft)).toBe(before);
    expect(draft.fields).toBe(fieldsRef);
    expect(draft.sections).toBe(sectionsRef);
    expect(draft.structure).toBe(structureRef);
    expect(draft.values).toBe(valuesRef);
    expect(draft.version).toBe(beforeVersion);
    expect(draft.baseVersion).toBe(beforeBaseVersion);
    expect(spec).toBeDefined();
  });

  it("60. projecting the returned spec's draft again is stable", () => {
    const draft = makeRichDraft();
    projectDraftV2ToSpec(draft);
    expect(projectDraftV2ToSpec(draft)).toEqual(
      projectDraftV2ToSpec(makeRichDraft()),
    );
  });
});

describe("projection-v2 BLOCK N validation", () => {
  const simpleRootOnly = (): CharacterSheetDraftV2 =>
    makeDraft({
      fields: [textField("a"), textField("b")],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "field", key: "b", parentKey: null },
      ],
      values: { a: "A", b: "B" },
    });

  it("61. every projected spec passes schema and domain validation", () => {
    const emptySectionDraft = makeDraft({
      fields: [textField("a")],
      sections: [{ key: "empty", title: "Empty" }],
      structure: [
        { kind: "section", key: "empty", parentKey: null },
        { kind: "field", key: "a", parentKey: null },
      ],
    });
    const oversizedKeys = Array.from({ length: 70 }, (_, i) => `bulk_${i}`);
    const oversizedDraft = makeDraft({
      fields: oversizedKeys.map((key) => textField(key)),
      structure: oversizedKeys.map((key) => ({
        kind: "field" as const,
        key,
        parentKey: null,
      })),
    });

    for (const draft of [
      simpleRootOnly(),
      makeRichDraft(),
      emptySectionDraft,
      oversizedDraft,
      makeRichDraft({ confirmed: true }),
      projectDraftV2ToSpec(simpleRootOnly()) && makeRichDraft({ mode: "npc" }),
    ]) {
      expectSchemaAndDomainValid(projectDraftV2ToSpec(draft));
    }
  });

  it("62. the projection is the parsed, validated spec", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    expect(spec).toEqual(
      CharacterSheetSpecSchema.parse(
        JSON.parse(JSON.stringify(projectDraftV2ToSpec(makeRichDraft()))),
      ),
    );
  });

  it("63. a malformed V2 draft fails closed before projection", () => {
    const draft = makeRichDraft();
    const broken: CharacterSheetDraftV2 = {
      ...draft,
      structure: [
        ...draft.structure.filter(
          (placement) =>
            placement.key !== "root_a" || placement.kind !== "field",
        ),
        { kind: "field", key: "ghost", parentKey: null },
      ],
    };
    expect(errorCodeOf(() => projectDraftV2ToSpec(broken))).toBe(
      "invalid_draft",
    );
  });

  it("64. a non-V2 draft fails closed", () => {
    const draft = makeRichDraft() as unknown as Record<string, unknown>;
    delete draft.structure;
    expect(
      errorCodeOf(() => projectDraftV2ToSpec(draft as CharacterSheetDraftV2)),
    ).toBe("invalid_draft");
  });
});

describe("projection-v2 BLOCK O scope guarantees", () => {
  it("65. V1 projection is unchanged and still operational", () => {
    const spec = projectDraftToSpec(
      makeV1Draft({
        draftId: "draft.v1",
        characterName: "V1 Hero",
        fields: [textField("a"), textField("b")],
        sections: [{ key: "s", title: "Stats", fieldKeys: ["a"] }],
        values: { a: "A" },
      }),
    );
    expect(spec.sections.map((section) => section.id)).toEqual([
      "draft.section.s",
      "draft.section.ungrouped",
    ]);
    expect(spec.pages[0]?.id).toBe("draft.page");
  });

  it("66. the V2 projection uses bounded ordinal IDs only", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    for (const section of spec.sections) {
      expect(section.id).toMatch(/^draft\.v2\.section\.\d+$/);
    }
    for (const page of spec.pages) {
      expect(page.id).toMatch(/^draft\.v2\.page\.\d+$/);
    }
  });

  it("67. projected Section ids stay within identifier limits", () => {
    const spec = projectDraftV2ToSpec(makeRichDraft());
    for (const section of spec.sections) {
      expect(section.id.length).toBeLessThanOrEqual(128);
      expect(section.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    }
  });

  it("68. structure[] remains the only structural authority", () => {
    const draft = makeRichDraft();
    const spec = projectDraftV2ToSpec(draft);
    const fromReadModel = buildDraftStructuralReadModelV2(draft)
      .preorder.filter((node) => node.kind === "field")
      .map((node) => node.key);
    expect(spec.fields.map((field) => field.id)).toEqual(fromReadModel);
    expect(flattenedFieldIds(spec)).toEqual(fromReadModel);
  });

  it("69. the V2 projection is exposed through the package index", async () => {
    // 4C3 supersedes the 4C2 public-absence assumption: `projectDraftV2ToSpec` is
    // now intentionally part of the reviewed package-root V2 boundary. This
    // assertion only records that deliberate promotion; the full public
    // contract lives in draft-read-projection-v2-public.test.ts.
    const index = await import("../index");
    expect(Object.keys(index)).toContain("projectDraftV2ToSpec");
  });

  it("70. a large realistic draft projects within canonical order", () => {
    const fields: DraftField[] = [];
    const structure: DraftPlacement[] = [];
    const values: Record<string, string> = {};
    for (let index = 0; index < 100; index += 1) {
      const key = `f${index}`;
      fields.push(textField(key));
      structure.push({ kind: "field", key, parentKey: null });
      values[key] = key;
    }
    const spec = projectDraftV2ToSpec(makeDraft({ fields, structure, values }));
    expect(flattenedFieldIds(spec)).toEqual(
      canonicalFieldKeys(makeDraft({ fields, structure, values })),
    );
    expectSchemaAndDomainValid(spec);
  });
});
