import { describe, expect, it } from "vitest";
import {
  CharacterSheetSpecSchema,
  validateCharacterSheetSpecDomain,
  type CharacterSheetSpec,
} from "@repo/character-sheet-schema";
import {
  applyDraftMutationV2,
  buildDraftStructuralReadModelV2,
  finalizeDraftV2,
  parseCanonicalCharacterSheetDraft,
  projectDraftToSpec,
  projectDraftV2ToSpec,
  writebackDraftToSpec,
  type CharacterSheetDraft,
  type CharacterSheetDraftV2,
  type DraftFieldReadNodeV2,
  type DraftMutationV2,
  type DraftReadNodeV2,
  type DraftSectionReadNodeV2,
  type DraftStructuralReadModelV2,
} from "./index";

/**
 * 4C PUBLIC BOUNDARY SUITE.
 *
 * This file deliberately imports EVERY V2 read/projection API from the package
 * root (`./index`) and never deep-imports `draft-read-model-v2`,
 * `preview/projection-v2`, `draft-structure` or `draft-migration-v1-to-v2`. That
 * restriction is the point of the suite: it proves the reviewed package root is
 * sufficient for a future runtime consumer, and that the lower structural and
 * projection machinery is not required.
 *
 * It is an INTEGRATION suite, not a unit suite. It deliberately re-proves only
 * the public contract (availability, types, canonical order, V1/V2
 * compatibility, composition). The exhaustive 4C1 read-model assertions and the
 * 4C2/4C2B projection assertions stay in their own suites and are not duplicated
 * here.
 */

/**
 * Rich canonical V2 draft, shaped exactly as the 4C public contract requires:
 *
 *   Root
 *   ├─ Field root_a
 *   ├─ Section attributes
 *   │  ├─ Field strength
 *   │  ├─ Section derived
 *   │  │  └─ Field initiative
 *   │  └─ Field dexterity
 *   └─ Field root_b
 *
 * `fields[]` and `sections[]` are registered in an order that does NOT match
 * `structure[]`, so every ordering assertion here also proves registry order
 * never leaks into the read model or the projection.
 */
function makePublicRichDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.public",
    sessionId: "session.public",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    // No `character_name` Field in this fixture, so the V2 invariant requires a
    // null characterName.
    characterName: null,
    rulesContextId: "ctx.public.001",
    fields: [
      { key: "dexterity", label: "Dexterity", type: "number", locked: false },
      { key: "initiative", label: "Initiative", type: "number", locked: false },
      { key: "root_b", label: "Root B", type: "text", locked: false },
      { key: "strength", label: "Strength", type: "number", locked: false },
      { key: "root_a", label: "Root A", type: "text", locked: false },
    ],
    sections: [
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
    ],
    values: {
      root_a: "Alpha",
      strength: 12,
      initiative: 3,
      dexterity: 14,
      root_b: "Beta",
    },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

/** Canonical Field order the fixtures above must produce. */
const RICH_FIELD_ORDER = [
  "root_a",
  "strength",
  "initiative",
  "dexterity",
  "root_b",
];

const RICH_PREORDER_KEYS = [
  "root_a",
  "attributes",
  "strength",
  "derived",
  "initiative",
  "dexterity",
  "root_b",
];

/**
 * A genuinely historical V1 draft: Section-owned `fieldKeys`, Section
 * `parentKey`, and Fields that belong to no Section at all. This is the shape
 * that actually exists in R2 today, and the only approved way to read it is the
 * canonical parser — the migration function itself is intentionally private.
 */
function makeHistoricalV1Draft(): CharacterSheetDraft {
  return {
    schemaVersion: "1",
    draftId: "draft.historical",
    sessionId: "session.historical",
    baseVersion: 3,
    version: 7,
    mode: "npc",
    characterName: "Keeper",
    rulesContextId: "ctx.historical",
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      {
        key: "str",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      {
        key: "dex",
        label: "Dexterity",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      { key: "notes", label: "Notes", type: "textarea", locked: false },
      { key: "history", label: "History", type: "textarea", locked: false },
    ],
    sections: [
      { key: "attributes", title: "Attributes", fieldKeys: ["str", "dex"] },
      {
        key: "sub",
        title: "Sub",
        parentKey: "attributes",
        fieldKeys: ["notes"],
      },
    ],
    values: {
      character_name: "Keeper",
      str: 10,
      dex: 12,
      notes: "note",
      history: "old",
    },
    source: { sourceSheetId: "sheet-1", sourceRunId: "run-2" },
    confirmed: false,
  };
}

function modelFieldKeys(model: DraftStructuralReadModelV2): string[] {
  return model.preorder
    .filter((node): node is DraftFieldReadNodeV2 => node.kind === "field")
    .map((node) => node.key);
}

function projectedFieldKeys(spec: CharacterSheetSpec): string[] {
  const sectionById = new Map(spec.sections.map((s) => [s.id, s]));
  return spec.pages.flatMap((page) =>
    page.layout.sectionIds.flatMap((id) => sectionById.get(id)?.fieldIds ?? []),
  );
}

function expectSpecValid(spec: CharacterSheetSpec): void {
  const parsed = CharacterSheetSpecSchema.safeParse(spec);
  expect(parsed.success).toBe(true);
  expect(validateCharacterSheetSpecDomain(spec).valid).toBe(true);
}

describe("4C3 public V2 boundary — availability", () => {
  it("1. buildDraftStructuralReadModelV2 is available from ./index", async () => {
    const index = await import("./index");
    expect(typeof index.buildDraftStructuralReadModelV2).toBe("function");
    // Callable through the root import alone, with no deep import.
    const model = buildDraftStructuralReadModelV2(makePublicRichDraft());
    expect(model.preorder).toHaveLength(RICH_PREORDER_KEYS.length);
  });

  it("2. projectDraftV2ToSpec is available from ./index", async () => {
    const index = await import("./index");
    expect(typeof index.projectDraftV2ToSpec).toBe("function");
    // Callable through the root import alone, with no deep import.
    const spec = projectDraftV2ToSpec(makePublicRichDraft());
    expect(spec.schemaVersion).toBe("1");
  });
});

describe("4C3 public V2 boundary — type usability", () => {
  it("3. DraftFieldReadNodeV2 is a usable public type", () => {
    const model = buildDraftStructuralReadModelV2(makePublicRichDraft());
    const node: DraftReadNodeV2 | undefined = model.nodeByKey.get("strength");
    expect(node?.kind).toBe("field");
    if (node === undefined || node.kind !== "field") {
      throw new Error("Expected a resolved Field read node.");
    }
    const fieldNode: DraftFieldReadNodeV2 = node;
    expect(fieldNode.key).toBe("strength");
    expect(fieldNode.parentKey).toBe("attributes");
    expect(fieldNode.depth).toBe(1);
    expect(fieldNode.field.type).toBe("number");
  });

  it("4. DraftSectionReadNodeV2 is a usable public type", () => {
    const model = buildDraftStructuralReadModelV2(makePublicRichDraft());
    const node: DraftReadNodeV2 | undefined = model.nodeByKey.get("derived");
    expect(node?.kind).toBe("section");
    if (node === undefined || node.kind !== "section") {
      throw new Error("Expected a resolved Section read node.");
    }
    const sectionNode: DraftSectionReadNodeV2 = node;
    expect(sectionNode.key).toBe("derived");
    expect(sectionNode.parentKey).toBe("attributes");
    expect(sectionNode.section.title).toBe("Derived");
  });

  it("5. DraftReadNodeV2 is a usable public union type", () => {
    const draft = makePublicRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const nodes: readonly DraftReadNodeV2[] = model.preorder;
    // The union discriminates cleanly, with no `any` and no cast.
    const keys = nodes.map((node) => `${node.kind}:${node.key}`);
    expect(keys).toEqual(
      RICH_PREORDER_KEYS.map((key) =>
        model.nodeByKey.get(key)?.kind === "section"
          ? `section:${key}`
          : `field:${key}`,
      ),
    );
    expect(nodes).toHaveLength(draft.structure.length);
  });

  it("6. DraftStructuralReadModelV2 is a usable public type", () => {
    const draft: CharacterSheetDraftV2 = makePublicRichDraft();
    const model: DraftStructuralReadModelV2 =
      buildDraftStructuralReadModelV2(draft);
    expect(model.preorder).toHaveLength(draft.structure.length);
    expect(model.roots.length).toBeGreaterThan(0);
    expect(model.nodeByKey.size).toBe(draft.structure.length);
    expect(model.childrenByParent.has(null)).toBe(true);
  });
});

describe("4C3 public V2 boundary — read model semantics", () => {
  it("7. public read model preserves canonical preorder", () => {
    const draft = makePublicRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    // 1:1 and in EXACT order with draft.structure[] — no sorting, no regrouping.
    expect(model.preorder.map((node) => node.key)).toEqual(RICH_PREORDER_KEYS);
    expect(model.preorder.map((node) => node.key)).toEqual(
      draft.structure.map((placement) => placement.key),
    );
  });

  it("8. public read model preserves mixed Root order", () => {
    const draft = makePublicRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    // Root is parentKey === null only; Fields and Sections stay interleaved in
    // their canonical sibling order with no "Other fields" bucket.
    expect(model.roots.map((node) => `${node.kind}:${node.key}`)).toEqual([
      "field:root_a",
      "section:attributes",
      "field:root_b",
    ]);
    expect(model.roots.every((node) => node.parentKey === null)).toBe(true);
  });

  it("9. public read model preserves mixed child order", () => {
    const model = buildDraftStructuralReadModelV2(makePublicRichDraft());
    // Inside "attributes" the canonical order is Field, Section, Field.
    expect(
      (model.childrenByParent.get("attributes") ?? []).map(
        (node) => `${node.kind}:${node.key}`,
      ),
    ).toEqual(["field:strength", "section:derived", "field:dexterity"]);
  });

  it("10. public read model resolves exact registry/placement references", () => {
    const draft = makePublicRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);

    const fieldNode = model.nodeByKey.get("strength");
    const sectionNode = model.nodeByKey.get("attributes");
    if (fieldNode?.kind !== "field" || sectionNode?.kind !== "section") {
      throw new Error("Expected resolved Field and Section read nodes.");
    }

    // EXACT references: the read model wraps, it never clones or repairs.
    expect(fieldNode.placement).toBe(draft.structure[2]);
    expect(fieldNode.field).toBe(
      draft.fields.find((f) => f.key === "strength"),
    );
    expect(sectionNode.placement).toBe(draft.structure[1]);
    expect(sectionNode.section).toBe(
      draft.sections.find((s) => s.key === "attributes"),
    );

    // Depth is preserved.
    expect(model.nodeByKey.get("root_a")?.depth).toBe(0);
    expect(fieldNode.depth).toBe(1);
    expect(sectionNode.depth).toBe(0);
    expect(model.nodeByKey.get("derived")?.depth).toBe(1);
    expect(model.nodeByKey.get("initiative")?.depth).toBe(2);

    // The same wrapper instances are reused across every view.
    expect(model.preorder[0]).toBe(model.nodeByKey.get("root_a"));
    expect(model.preorder[0]).toBe(model.roots[0]);
    expect(model.roots[0]).toBe(model.childrenByParent.get(null)?.[0]);
    expect(model.preorder[1]).toBe(model.childrenByParent.get(null)?.[1]);
    expect(fieldNode).toBe(model.childrenByParent.get("attributes")?.[0]);
  });
});

describe("4C3 public V2 boundary — projection semantics", () => {
  it("11. public projection preserves canonical Field traversal", () => {
    const draft = makePublicRichDraft();
    const spec = projectDraftV2ToSpec(draft);

    expect(spec.schemaVersion).toBe("1");
    expect(projectedFieldKeys(spec)).toEqual(RICH_FIELD_ORDER);
    expect(spec.fields.map((field) => field.id)).toEqual(RICH_FIELD_ORDER);

    // A nested Section interrupts the parent Field run, and the parent resumes
    // as a new run afterwards: [strength] ... [dexterity], never merged.
    expect(spec.sections.map((section) => section.fieldIds)).toEqual([
      ["root_a"],
      ["strength"],
      ["initiative"],
      ["dexterity"],
      ["root_b"],
    ]);
    // The Root Field before and after the Root Section keeps its position.
    expect(spec.sections[0]?.fieldIds).toEqual(["root_a"]);
    expect(spec.sections[4]?.fieldIds).toEqual(["root_b"]);

    // Deterministic.
    expect(projectDraftV2ToSpec(draft)).toEqual(spec);
  });

  it("12. public projection passes schema/domain validation", () => {
    const spec = projectDraftV2ToSpec(makePublicRichDraft());
    expectSpecValid(spec);
    expect(CharacterSheetSpecSchema.parse(spec)).toEqual(spec);
  });
});

describe("4C3 public V2 boundary — read/projection consistency", () => {
  it("13. read-model Field traversal === projected Field traversal", () => {
    const draft = makePublicRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const spec = projectDraftV2ToSpec(draft);

    // Freezes the contract: the structural read model and the render projection
    // interpret the SAME canonical structure.
    const modelFieldOrder = modelFieldKeys(model);
    expect(modelFieldOrder).toEqual(projectedFieldKeys(spec));
    expect(modelFieldOrder).toEqual(RICH_FIELD_ORDER);
  });
});

describe("4C3 public V2 boundary — mutation → read → projection", () => {
  it("14. public place_node changes read and projected order consistently", () => {
    const draft = makePublicRichDraft();
    const before = JSON.stringify(draft);

    const mutation: DraftMutationV2 = {
      op: "place_node",
      key: "root_b",
      destination: { position: "before", targetKey: "root_a" },
    };
    const mutated = applyDraftMutationV2(draft, mutation, draft.version);

    const model = buildDraftStructuralReadModelV2(mutated);
    const spec = projectDraftV2ToSpec(mutated);

    const expected = [
      "root_b",
      "root_a",
      "strength",
      "initiative",
      "dexterity",
    ];
    expect(modelFieldKeys(model)).toEqual(expected);
    expect(projectedFieldKeys(spec)).toEqual(expected);
    expect(modelFieldKeys(model)).toEqual(projectedFieldKeys(spec));
    expectSpecValid(spec);

    // Version moved exactly once, per mutation semantics; baseVersion is fixed.
    expect(mutated.version).toBe(draft.version + 1);
    expect(mutated.baseVersion).toBe(draft.baseVersion);

    // The pre-mutation draft is untouched.
    expect(JSON.stringify(draft)).toBe(before);
    expect(draft.version).toBe(1);
    expect(draft.structure[0]?.key).toBe("root_a");
  });
});

describe("4C3 public V2 boundary — historical V1 compatibility", () => {
  it("15. historical V1 canonical parse returns V2", () => {
    const v1 = makeHistoricalV1Draft();
    const canonical = parseCanonicalCharacterSheetDraft(v1);

    expect(canonical.schemaVersion).toBe("2");
    // The approved V1→V2 migration ordering policy is reflected: root Sections
    // in registry order with their Fields, then nested Sections, then the
    // Section-less Fields in Field registry order.
    expect(canonical.structure.map((p) => p.key)).toEqual([
      "attributes",
      "str",
      "dex",
      "sub",
      "notes",
      "character_name",
      "history",
    ]);
    // Reading is in-memory only: the V1 source is not rewritten.
    const v1Sections = v1.sections ?? [];
    expect(v1Sections[0]?.fieldKeys).toEqual(["str", "dex"]);
    expect(v1Sections[1]?.parentKey).toBe("attributes");
  });

  it("16. historical V1 canonical V2 read model works", () => {
    const canonical = parseCanonicalCharacterSheetDraft(
      makeHistoricalV1Draft(),
    );
    const model = buildDraftStructuralReadModelV2(canonical);

    expect(model.preorder.map((node) => node.key)).toEqual(
      canonical.structure.map((p) => p.key),
    );
    expect(modelFieldKeys(model)).toEqual([
      "str",
      "dex",
      "notes",
      "character_name",
      "history",
    ]);
    expect(model.nodeByKey.get("sub")?.depth).toBe(1);
    expect(
      (model.childrenByParent.get("attributes") ?? []).map(
        (n) => `${n.kind}:${n.key}`,
      ),
    ).toEqual(["field:str", "field:dex", "section:sub"]);
  });

  it("17. historical V1 canonical V2 projection works", () => {
    const canonical = parseCanonicalCharacterSheetDraft(
      makeHistoricalV1Draft(),
    );
    const spec = projectDraftV2ToSpec(canonical);

    expectSpecValid(spec);
    // Only semantic validity/order is required: the V1 and V2 projections use
    // different structural models and are deliberately not shape-identical.
    expect(projectedFieldKeys(spec)).toEqual([
      "str",
      "dex",
      "notes",
      "character_name",
      "history",
    ]);
    expect(spec.metadata.title).toBe("Keeper");
    expect(spec.mode).toBe("npc");
  });
});

describe("4C3 public V2 boundary — V1/V2 coexistence", () => {
  it("18. V1 projectDraftToSpec remains callable", () => {
    const v1 = makeHistoricalV1Draft();
    const spec = projectDraftToSpec(v1);
    expectSpecValid(spec);
    // The V1 projection keeps its own V1-specific behaviour, including its own
    // root Section for Fields that belong to no V1 Section.
    expect(spec.sections.map((section) => section.title)).toEqual([
      "Attributes",
      "Attributes · Sub",
      "NPC",
    ]);
  });

  it("19. V1 writebackDraftToSpec remains exported", () => {
    expect(typeof writebackDraftToSpec).toBe("function");
    // writeback still overlays a draft's values onto an existing base spec.
    const v1 = makeHistoricalV1Draft();
    const baseSpec = projectDraftToSpec(v1);
    const edited: CharacterSheetDraft = {
      ...v1,
      values: { ...v1.values, str: 18 },
    };
    const spec = writebackDraftToSpec(edited, baseSpec);
    expectSpecValid(spec);
    expect(spec.values.str).toBe(18);
    expect(spec.sections).toEqual(baseSpec.sections);
  });

  it("20. V1 and V2 projection symbols coexist without collision", async () => {
    const index = await import("./index");
    expect(index.projectDraftToSpec).toBe(projectDraftToSpec);
    expect(index.projectDraftV2ToSpec).toBe(projectDraftV2ToSpec);
    // Distinct functions: no rename, no overload, no replacement.
    expect(index.projectDraftToSpec).not.toBe(index.projectDraftV2ToSpec);
    expect(typeof index.writebackDraftToSpec).toBe("function");

    // Each API keeps its own input type, and both work in the same process.
    const v1Spec = projectDraftToSpec(makeHistoricalV1Draft());
    const v2Spec = projectDraftV2ToSpec(
      parseCanonicalCharacterSheetDraft(makeHistoricalV1Draft()),
    );
    expectSpecValid(v1Spec);
    expectSpecValid(v2Spec);
  });
});

describe("4C3 public V2 boundary — confirmed readability", () => {
  it("21. confirmed V2 remains readable", () => {
    const confirmed = finalizeDraftV2(makePublicRichDraft());
    expect(confirmed.confirmed).toBe(true);

    const model = buildDraftStructuralReadModelV2(confirmed);
    // Confirmed means immutable, not unreadable.
    expect(model.preorder.map((node) => node.key)).toEqual(RICH_PREORDER_KEYS);
    expect(modelFieldKeys(model)).toEqual(RICH_FIELD_ORDER);
  });

  it("22. confirmed V2 remains projectable", () => {
    const confirmed = finalizeDraftV2(makePublicRichDraft());
    const spec = projectDraftV2ToSpec(confirmed);

    expectSpecValid(spec);
    expect(projectedFieldKeys(spec)).toEqual(RICH_FIELD_ORDER);
    // Still the same canonical structure as before confirmation.
    expect(spec).toEqual(projectDraftV2ToSpec(makePublicRichDraft()));
  });
});

/**
 * Compile-time private-surface checks.
 *
 * `keyof PublicApi` covers the package root's VALUE exports, so `IsPublic<K>`
 * resolves to `true` only for a key that actually reached the public boundary.
 * `ExpectFalse<T extends false>` makes a leaked symbol a COMPILE error rather
 * than a silently passing assertion. Nothing private is imported or referenced
 * at runtime; the `expect` calls below only pin the resolved literal.
 */
type PublicApi = typeof import("./index");
type PublicApiKeys = keyof PublicApi;

/** Resolves to `true` only when `K` is a public value export. */
type IsPublic<K extends PropertyKey> = K extends PublicApiKeys ? true : false;
/** Makes a leaked symbol a compile error. */
type ExpectFalse<T extends false> = T;
/** Makes a missing symbol a compile error. */
type ExpectTrue<T extends true> = T;

type ReadModelIsPublic = ExpectTrue<
  IsPublic<"buildDraftStructuralReadModelV2">
>;
type ProjectionIsPublic = ExpectTrue<IsPublic<"projectDraftV2ToSpec">>;

type StructuralIndexIsPrivate = ExpectFalse<
  IsPublic<"buildDraftStructuralIndex">
>;
type GetDraftChildrenIsPrivate = ExpectFalse<IsPublic<"getDraftChildren">>;
type GetDraftDepthIsPrivate = ExpectFalse<IsPublic<"getDraftDepth">>;
type BumpDraftVersionIsPrivate = ExpectFalse<IsPublic<"bumpDraftVersionV2">>;
type ContentPrimitiveIsPrivate = ExpectFalse<
  IsPublic<"applyDraftContentMutationWithExpectedVersionV2">
>;
type FieldRegistryPrimitiveIsPrivate = ExpectFalse<
  IsPublic<"applyDraftFieldRegistryMutationWithExpectedVersionV2">
>;
type SectionRegistryPrimitiveIsPrivate = ExpectFalse<
  IsPublic<"applyDraftSectionRegistryMutationWithExpectedVersionV2">
>;

describe("4C3 public V2 boundary — compile-time private surface", () => {
  it("23. buildDraftStructuralIndex is NOT public", () => {
    const isPublic: StructuralIndexIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("24. getDraftChildren is NOT public", () => {
    const isPublic: GetDraftChildrenIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("25. getDraftDepth is NOT public", () => {
    const isPublic: GetDraftDepthIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("26. bumpDraftVersionV2 is NOT public", () => {
    const isPublic: BumpDraftVersionIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("27. the 4A content-mutation family primitive is NOT public", () => {
    const isPublic: ContentPrimitiveIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("28. the 4A field-registry family primitive is NOT public", () => {
    const isPublic: FieldRegistryPrimitiveIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("29. the 4A section-registry family primitive is NOT public", () => {
    const isPublic: SectionRegistryPrimitiveIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("30. the read model and the V2 projection ARE public", () => {
    // The positive half of the same compile-time contract.
    const readModelIsPublic: ReadModelIsPublic = true;
    const projectionIsPublic: ProjectionIsPublic = true;
    expect(readModelIsPublic).toBe(true);
    expect(projectionIsPublic).toBe(true);
  });
});
