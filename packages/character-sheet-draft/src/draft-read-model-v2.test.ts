import { describe, expect, it } from "vitest";
import { buildDraftStructuralReadModelV2 } from "./draft-read-model-v2";
import { buildDraftStructuralIndex, getDraftDepth } from "./draft-structure";
import {
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import { DraftError } from "./errors";

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
 * `fields[]` and `sections[]` are deliberately registered in an order that
 * does NOT match structure[], so every assertion about structural order proves
 * that registry ordering never leaks into the read model.
 */
function makeRichDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.readmodel",
    sessionId: "session.readmodel",
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
  };
}

/** Canonical draft whose only Section is a childless leaf. */
function makeLeafSectionDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.readmodel.leaf",
    sessionId: "session.readmodel",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: null,
    rulesContextId: null,
    fields: [{ key: "a", label: "A", type: "text", locked: false }],
    sections: [{ key: "empty", title: "Empty" }],
    structure: [
      { kind: "section", key: "empty", parentKey: null },
      { kind: "field", key: "a", parentKey: null },
    ],
    values: { a: "A" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

const STRUCTURE_KEYS = [
  "root_a",
  "attributes",
  "strength",
  "derived",
  "initiative",
  "dexterity",
  "root_b",
  "equipment",
  "weapon",
  "character_name",
];

const STRUCTURE_KINDS = [
  "field",
  "section",
  "field",
  "section",
  "field",
  "field",
  "field",
  "section",
  "field",
  "field",
];

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

describe("read model BLOCK A canonical preorder", () => {
  it("1. preorder length equals structure length", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.preorder.length).toBe(draft.structure.length);
  });

  it("2. preorder key sequence equals the structure key sequence", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.preorder.map((node) => node.key)).toEqual(STRUCTURE_KEYS);
    for (const [i, placement] of draft.structure.entries()) {
      expect(model.preorder[i]?.key).toBe(placement.key);
    }
  });

  it("3. preorder kind sequence equals the structure kind sequence", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.preorder.map((node) => node.kind)).toEqual(STRUCTURE_KINDS);
    for (const [i, placement] of draft.structure.entries()) {
      expect(model.preorder[i]?.kind).toBe(placement.kind);
    }
  });

  it("4. every placement is represented exactly once", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(new Set(model.preorder.map((node) => node.key)).size).toBe(
      draft.structure.length,
    );
    expect(model.preorder.length).toBe(
      new Set(draft.structure.map((placement) => placement.key)).size,
    );
  });

  it("5. mixed Root ordering is preserved", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.roots.map((node) => `${node.kind}:${node.key}`)).toEqual([
      "field:root_a",
      "section:attributes",
      "field:root_b",
      "section:equipment",
      "field:character_name",
    ]);
  });

  it("6. mixed nested sibling ordering is preserved", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const children = model.childrenByParent.get("attributes") ?? [];
    expect(children.map((node) => `${node.kind}:${node.key}`)).toEqual([
      "field:strength",
      "section:derived",
      "field:dexterity",
    ]);
  });

  it("7. nested descendants remain inside their Section subtree in preorder", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const keys = model.preorder.map((node) => node.key);
    expect(keys.indexOf("derived")).toBeGreaterThan(keys.indexOf("strength"));
    expect(keys.indexOf("initiative")).toBeGreaterThan(keys.indexOf("derived"));
    expect(keys.indexOf("dexterity")).toBeGreaterThan(
      keys.indexOf("initiative"),
    );
    expect(keys.indexOf("root_b")).toBeGreaterThan(keys.indexOf("dexterity"));
  });

  it("8. registry array ordering never overrides structural ordering", () => {
    const draft = makeRichDraft();
    // The registries are intentionally registered in a different order.
    expect(draft.fields[0]?.key).toBe("dexterity");
    expect(draft.sections[0]?.key).toBe("equipment");
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.preorder.map((node) => node.key)).not.toEqual(
      draft.fields.map((field) => field.key),
    );
    expect(model.preorder[0]?.key).toBe("root_a");
    expect(model.roots[0]?.key).toBe("root_a");
    expect(model.nodeByKey.get("equipment")?.key).toBe("equipment");
  });
});

describe("read model BLOCK B roots", () => {
  it("9. roots contain direct Root nodes only", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.roots.every((node) => node.parentKey === null)).toBe(true);
    expect(model.roots.length).toBe(5);
  });

  it("10. root Fields are included", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const rootFieldKeys = model.roots
      .filter((node) => node.kind === "field")
      .map((node) => node.key);
    expect(rootFieldKeys).toEqual(["root_a", "root_b", "character_name"]);
  });

  it("11. root Sections are included", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const rootSectionKeys = model.roots
      .filter((node) => node.kind === "section")
      .map((node) => node.key);
    expect(rootSectionKeys).toEqual(["attributes", "equipment"]);
  });

  it("12. a nested Section is excluded from roots", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.roots.some((node) => node.key === "derived")).toBe(false);
  });

  it("13. a nested Field is excluded from roots", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const key of ["strength", "initiative", "dexterity", "weapon"]) {
      expect(model.roots.some((node) => node.key === key)).toBe(false);
    }
  });

  it("14. root mixed sibling order is exactly preserved", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const expected = draft.structure
      .filter((placement) => placement.parentKey === null)
      .map((placement) => placement.key);
    expect(model.roots.map((node) => node.key)).toEqual(expected);
  });

  it("15. parentKey is null on every root node", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const node of model.roots) {
      expect(node.parentKey).toBeNull();
    }
  });

  it("16. roots reuse the exact preorder node instances", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const node of model.roots) {
      expect(model.preorder.includes(node)).toBe(true);
    }
  });
});

describe("read model BLOCK C children", () => {
  it("17. direct children of a Section are returned", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(
      (model.childrenByParent.get("equipment") ?? []).map((node) => node.key),
    ).toEqual(["weapon"]);
  });

  it("18. descendants are not returned as direct children", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const attributesChildren = model.childrenByParent.get("attributes") ?? [];
    expect(attributesChildren.some((node) => node.key === "initiative")).toBe(
      false,
    );
    expect(
      (model.childrenByParent.get(null) ?? []).some(
        (node) => node.key === "strength",
      ),
    ).toBe(false);
  });

  it("19. mixed Field/Section child order is preserved", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const children = model.childrenByParent.get("attributes") ?? [];
    expect(children.map((node) => node.kind)).toEqual([
      "field",
      "section",
      "field",
    ]);
    expect(children.map((node) => node.key)).toEqual([
      "strength",
      "derived",
      "dexterity",
    ]);
  });

  it("20. a nested Section owns its own direct children", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(
      (model.childrenByParent.get("derived") ?? []).map((node) => node.key),
    ).toEqual(["initiative"]);
  });

  it("21. a leaf Section has no children bucket at all", () => {
    const draft = makeLeafSectionDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.childrenByParent.has("empty")).toBe(false);
    expect(model.childrenByParent.get("empty")).toBeUndefined();
  });

  it("22. child nodes reuse the exact preorder node instances", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const siblings of model.childrenByParent.values()) {
      for (const node of siblings) {
        expect(model.preorder.includes(node)).toBe(true);
      }
    }
  });

  it("23. child nodes reuse the exact nodeByKey instances", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const siblings of model.childrenByParent.values()) {
      for (const node of siblings) {
        expect(model.nodeByKey.get(node.key)).toBe(node);
      }
    }
  });

  it("no empty buckets are manufactured for unknown parents", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.childrenByParent.has("ghost")).toBe(false);
    expect(model.childrenByParent.get("ghost")).toBeUndefined();
    expect(model.childrenByParent.has("root_a")).toBe(false);
  });
});

describe("read model BLOCK D registry resolution", () => {
  it("24. a Field placement resolves to the correct DraftField", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const node = model.nodeByKey.get("weapon");
    expect(node?.kind).toBe("field");
    if (node?.kind !== "field") throw new Error("expected a field node");
    expect(node.field.key).toBe("weapon");
    expect(node.field.type).toBe("choice");
    expect(node.field.locked).toBe(true);
  });

  it("25. a Section placement resolves to the correct DraftSectionV2", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const node = model.nodeByKey.get("attributes");
    expect(node?.kind).toBe("section");
    if (node?.kind !== "section") throw new Error("expected a section node");
    expect(node.section).toEqual({ key: "attributes", title: "Attributes" });
  });

  it("26. field references are the exact registry references", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const placement of draft.structure) {
      if (placement.kind !== "field") continue;
      const expected = draft.fields.find(
        (field) => field.key === placement.key,
      );
      const node = model.nodeByKey.get(placement.key);
      if (node?.kind !== "field") throw new Error("expected a field node");
      expect(node.field).toBe(expected);
    }
  });

  it("27. section references are the exact registry references", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const placement of draft.structure) {
      if (placement.kind !== "section") continue;
      const expected = draft.sections.find(
        (section) => section.key === placement.key,
      );
      const node = model.nodeByKey.get(placement.key);
      if (node?.kind !== "section") throw new Error("expected a section node");
      expect(node.section).toBe(expected);
    }
  });

  it("28. placement references are the exact structure references", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const placement of draft.structure) {
      expect(model.nodeByKey.get(placement.key)?.placement).toBe(placement);
    }
  });

  it("29. no registry object is cloned", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const fieldKeys = new Set(draft.fields.map((field) => field.key));
    const sectionKeys = new Set(draft.sections.map((section) => section.key));
    for (const node of model.preorder) {
      if (node.kind === "field") {
        expect(fieldKeys.has(node.field.key)).toBe(true);
      } else {
        expect(sectionKeys.has(node.section.key)).toBe(true);
      }
    }
    // Every registry entry is still present by identity, i.e. nothing was
    // replaced by a copy.
    for (const field of draft.fields) {
      const node = model.nodeByKey.get(field.key);
      if (node?.kind !== "field") throw new Error("expected a field node");
      expect(node.field).toBe(field);
    }
  });

  it("30. no placement object is cloned", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    const placements = new Set<DraftPlacement>(draft.structure);
    for (const node of model.preorder) {
      expect(placements.has(node.placement)).toBe(true);
    }
  });
});

describe("read model BLOCK E nodeByKey", () => {
  it("31. every canonical placement is available by raw key", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const placement of draft.structure) {
      expect(model.nodeByKey.has(placement.key)).toBe(true);
    }
  });

  it("32. Field lookup works", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.nodeByKey.get("strength")?.kind).toBe("field");
  });

  it("33. Section lookup works", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.nodeByKey.get("derived")?.kind).toBe("section");
  });

  it("34. no compound key aliases exist", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const key of model.nodeByKey.keys()) {
      expect(key).not.toContain(":");
    }
    expect(model.nodeByKey.has("field:strength")).toBe(false);
    expect(model.nodeByKey.has("section:attributes")).toBe(false);
    expect(model.nodeByKey.has("ghost")).toBe(false);
  });

  it("35. nodeByKey size equals structure length", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    expect(model.nodeByKey.size).toBe(draft.structure.length);
  });

  it("36. a lookup returns the identical preorder object", () => {
    const draft = makeRichDraft();
    const model = buildDraftStructuralReadModelV2(draft);
    for (const [i, node] of model.preorder.entries()) {
      expect(model.nodeByKey.get(node.key)).toBe(node);
      expect(model.preorder.indexOf(model.nodeByKey.get(node.key)!)).toBe(i);
    }
  });
});

describe("read model BLOCK F depth", () => {
  it("37. a root Field has depth 0", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    expect(model.nodeByKey.get("root_a")?.depth).toBe(0);
    expect(model.nodeByKey.get("character_name")?.depth).toBe(0);
  });

  it("38. a root Section has depth 0", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    expect(model.nodeByKey.get("attributes")?.depth).toBe(0);
    expect(model.nodeByKey.get("equipment")?.depth).toBe(0);
  });

  it("39. a direct Section child Field has depth 1", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    expect(model.nodeByKey.get("weapon")?.depth).toBe(1);
  });

  it("40. a nested Section has depth 1", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    expect(model.nodeByKey.get("derived")?.depth).toBe(1);
  });

  it("41. a Field inside the nested Section has depth 2", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    expect(model.nodeByKey.get("initiative")?.depth).toBe(2);
  });

  it("42. a Field following a nested subtree keeps its sibling depth", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    // "dexterity" follows the whole "derived" subtree but is a sibling of it.
    expect(model.nodeByKey.get("dexterity")?.depth).toBe(1);
  });

  it("43. every depth matches the approved structural index", () => {
    const draft = makeRichDraft();
    const index = buildDraftStructuralIndex(draft);
    const model = buildDraftStructuralReadModelV2(draft);
    for (const node of model.preorder) {
      expect(node.depth).toBe(getDraftDepth(index, node.key));
    }
  });
});

describe("read model BLOCK G referential coherence", () => {
  it("a nested Field is the same instance in every applicable view", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    const node = model.nodeByKey.get("strength");
    expect(node).toBeDefined();
    expect(model.preorder.includes(node!)).toBe(true);
    expect(model.childrenByParent.get("attributes")?.includes(node!)).toBe(
      true,
    );
    expect(model.roots.includes(node!)).toBe(false);
  });

  it("a root Field is the same instance in preorder, roots and nodeByKey", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    const node = model.nodeByKey.get("root_a");
    expect(model.preorder.includes(node!)).toBe(true);
    expect(model.roots.includes(node!)).toBe(true);
    expect(model.childrenByParent.get(null)?.includes(node!)).toBe(true);
  });

  it("a nested Section is the same instance in every applicable view", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    const node = model.nodeByKey.get("derived");
    expect(model.preorder.includes(node!)).toBe(true);
    expect(model.childrenByParent.get("attributes")?.includes(node!)).toBe(
      true,
    );
    expect(model.roots.includes(node!)).toBe(false);
  });

  it("every node wrapper instance is unique across the whole model", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    const instances = new Set<DraftReadNodeV2Like>();
    for (const node of model.preorder) {
      expect(instances.has(node)).toBe(false);
      instances.add(node);
    }
    expect(instances.size).toBe(model.preorder.length);
  });

  it("the read model exposes no function members", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    for (const [key, value] of Object.entries(model)) {
      expect(typeof value).not.toBe("function");
      expect(key).not.toBe("children");
    }
    expect(Object.keys(model).sort()).toEqual([
      "childrenByParent",
      "nodeByKey",
      "preorder",
      "roots",
    ]);
  });

  it("no node carries a recursive children array", () => {
    const model = buildDraftStructuralReadModelV2(makeRichDraft());
    for (const node of model.preorder) {
      const keys = Object.keys(node).sort();
      expect(keys).toContain("depth");
      expect(keys).toContain("key");
      expect(keys).toContain("kind");
      expect(keys).toContain("parentKey");
      expect(keys).toContain("placement");
      expect(keys).toContain(node.kind);
      expect(keys).toHaveLength(6);
    }
  });
});

describe("read model BLOCK H input immutability", () => {
  it("44-50. building the read model leaves the draft deeply unchanged", () => {
    const draft = makeRichDraft();
    const before = JSON.stringify(draft);
    const fields = draft.fields;
    const sections = draft.sections;
    const structure = draft.structure;
    const values = draft.values;
    const version = draft.version;
    const baseVersion = draft.baseVersion;

    buildDraftStructuralReadModelV2(draft);

    expect(JSON.stringify(draft)).toBe(before);
    expect(draft.fields).toBe(fields);
    expect(draft.sections).toBe(sections);
    expect(draft.structure).toBe(structure);
    expect(draft.values).toBe(values);
    expect(draft.version).toBe(version);
    expect(draft.baseVersion).toBe(baseVersion);
  });
});

describe("read model BLOCK I validation gate", () => {
  const base = makeRichDraft();

  it("51. rejects a missing Field placement", () => {
    const draft: CharacterSheetDraftV2 = {
      ...base,
      structure: base.structure.filter(
        (placement) => placement.key !== "root_b",
      ),
    };
    expect(errorCodeOf(() => buildDraftStructuralReadModelV2(draft))).toBe(
      "invalid_draft",
    );
  });

  it("52. rejects a missing Section placement", () => {
    const draft: CharacterSheetDraftV2 = {
      ...base,
      structure: base.structure.filter(
        (placement) => placement.key !== "derived",
      ),
    };
    expect(errorCodeOf(() => buildDraftStructuralReadModelV2(draft))).toBe(
      "invalid_draft",
    );
  });

  it("53. rejects an unknown parent Section", () => {
    const draft: CharacterSheetDraftV2 = {
      ...base,
      structure: [
        { kind: "field", key: "root_a", parentKey: null },
        { kind: "section", key: "attributes", parentKey: null },
        { kind: "field", key: "strength", parentKey: "ghost" },
        { kind: "section", key: "derived", parentKey: "attributes" },
        { kind: "field", key: "initiative", parentKey: "derived" },
        { kind: "field", key: "dexterity", parentKey: "attributes" },
        { kind: "field", key: "root_b", parentKey: null },
        { kind: "section", key: "equipment", parentKey: null },
        { kind: "field", key: "weapon", parentKey: "equipment" },
        { kind: "field", key: "character_name", parentKey: null },
      ],
    };
    expect(errorCodeOf(() => buildDraftStructuralReadModelV2(draft))).toBe(
      "invalid_draft",
    );
  });

  it("54. rejects a duplicate Field key", () => {
    const duplicate = base.fields[0];
    if (duplicate === undefined) throw new Error("fixture must have fields");
    const draft: CharacterSheetDraftV2 = {
      ...base,
      fields: [...base.fields, duplicate],
    };
    expect(errorCodeOf(() => buildDraftStructuralReadModelV2(draft))).toBe(
      "invalid_draft",
    );
  });

  it("54b. rejects a Section key colliding with a Field key", () => {
    const draft: CharacterSheetDraftV2 = {
      ...base,
      sections: [...base.sections, { key: "root_a", title: "Clash" }],
    };
    expect(errorCodeOf(() => buildDraftStructuralReadModelV2(draft))).toBe(
      "invalid_draft",
    );
  });

  it("55. rejects a non-contiguous subtree that breaks canonical preorder", () => {
    const draft: CharacterSheetDraftV2 = {
      ...base,
      structure: [
        { kind: "field", key: "root_a", parentKey: null },
        { kind: "section", key: "attributes", parentKey: null },
        { kind: "section", key: "derived", parentKey: "attributes" },
        { kind: "field", key: "strength", parentKey: "attributes" },
        { kind: "field", key: "initiative", parentKey: "derived" },
        { kind: "field", key: "dexterity", parentKey: "attributes" },
        { kind: "field", key: "root_b", parentKey: null },
        { kind: "section", key: "equipment", parentKey: null },
        { kind: "field", key: "weapon", parentKey: "equipment" },
        { kind: "field", key: "character_name", parentKey: null },
      ],
    };
    expect(errorCodeOf(() => buildDraftStructuralReadModelV2(draft))).toBe(
      "invalid_draft",
    );
  });

  it("56. rejects a self-parenting Section", () => {
    const draft: CharacterSheetDraftV2 = {
      ...base,
      structure: base.structure.map((placement) =>
        placement.key === "derived"
          ? { kind: "section", key: "derived", parentKey: "derived" }
          : placement,
      ),
    };
    expect(errorCodeOf(() => buildDraftStructuralReadModelV2(draft))).toBe(
      "invalid_draft",
    );
  });

  it("the gate is closed before any model is produced", () => {
    const draft: CharacterSheetDraftV2 = {
      ...base,
      structure: base.structure.filter(
        (placement) => placement.key !== "root_a",
      ),
    };
    let produced: unknown;
    try {
      produced = buildDraftStructuralReadModelV2(draft);
    } catch {
      produced = undefined;
    }
    expect(produced).toBeUndefined();
  });
});

describe("read model BLOCK J values independence", () => {
  it("31b. identical structure with different values yields the same read model shape", () => {
    const first = makeRichDraft();
    const second: CharacterSheetDraftV2 = {
      ...first,
      characterName: "Bramble Vale",
      values: {
        character_name: "Bramble Vale",
        root_a: "Other A",
        strength: 3,
        initiative: 20,
        dexterity: 1,
        root_b: "Other B",
        weapon: "bow",
      },
    };
    expect(validateDraftV2(second)).toEqual(second);

    const a = buildDraftStructuralReadModelV2(first);
    const b = buildDraftStructuralReadModelV2(second);

    expect(b.preorder.map((node) => node.key)).toEqual(
      a.preorder.map((node) => node.key),
    );
    expect(b.roots.map((node) => node.key)).toEqual(
      a.roots.map((node) => node.key),
    );
    for (const [parentKey, children] of a.childrenByParent) {
      expect(
        (b.childrenByParent.get(parentKey) ?? []).map((n) => n.key),
      ).toEqual(children.map((node) => node.key));
    }
    for (const node of a.preorder) {
      expect(b.nodeByKey.get(node.key)?.depth).toBe(node.depth);
    }
  });
});

describe("read model BLOCK K lifecycle independence", () => {
  it("32b. different version, baseVersion and confirmed produce equivalent structure", () => {
    const first = makeRichDraft();
    const later: CharacterSheetDraftV2 = {
      ...first,
      baseVersion: 4,
      version: 37,
      confirmed: true,
    };
    const a = buildDraftStructuralReadModelV2(first);
    const b = buildDraftStructuralReadModelV2(later);
    expect(b.preorder.map((node) => [node.kind, node.key, node.depth])).toEqual(
      a.preorder.map((node) => [node.kind, node.key, node.depth]),
    );
    expect(b.roots.map((node) => node.key)).toEqual(
      a.roots.map((node) => node.key),
    );
  });
});

describe("read model BLOCK L confirmed readability", () => {
  it("33. a confirmed draft is still readable with the same structure", () => {
    const editable = makeRichDraft();
    const confirmed: CharacterSheetDraftV2 = { ...editable, confirmed: true };
    const a = buildDraftStructuralReadModelV2(editable);
    const b = buildDraftStructuralReadModelV2(confirmed);
    expect(b.preorder.map((node) => node.key)).toEqual(
      a.preorder.map((node) => node.key),
    );
    expect(b.roots.map((node) => node.key)).toEqual(
      a.roots.map((node) => node.key),
    );
    for (const node of b.preorder) {
      expect(node.depth).toBe(a.nodeByKey.get(node.key)?.depth);
    }
  });
});

/** Local alias so the identity test does not depend on inference details. */
type DraftReadNodeV2Like = ReturnType<
  typeof buildDraftStructuralReadModelV2
>["preorder"][number];
