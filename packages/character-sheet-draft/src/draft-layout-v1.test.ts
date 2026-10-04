import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRAFT_CONTAINER_LAYOUT_V1,
  DEFAULT_DRAFT_NODE_LAYOUT_V1,
  DRAFT_LAYOUT_V1_VERSION,
  DraftLayoutV1Schema,
  assertDraftLayoutComplete,
  defaultDraftLayoutV1,
  resolveEffectiveDraftLayoutV1,
  type DraftLayoutV1,
} from "./draft-layout-v1";
import {
  migrateCharacterSheetDraftV1ToV2,
  parseLegacyCharacterSheetDraftV1,
} from "./draft-migration-v1-to-v2";
import { makeDraft } from "./draft-fixture";
import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";

/**
 * Rich canonical V2 fixture with one nested section, used as the structural
 * base for layout assertions.
 */
function makeStructuredDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.layout",
    sessionId: "session.layout",
    baseVersion: 1,
    version: 4,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Character Name",
        type: "text",
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      {
        key: "homeland",
        label: "Homeland",
        type: "textarea",
        locked: false,
      },
    ],
    sections: [{ key: "attributes", title: "Attributes" }],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "section", key: "attributes", parentKey: null },
      { kind: "field", key: "strength", parentKey: "attributes" },
      { kind: "field", key: "homeland", parentKey: null },
    ],
    values: { character_name: "Aria Stone", strength: 12 },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

function makeExplicitLayout(
  overrides: Partial<DraftLayoutV1> = {},
): DraftLayoutV1 {
  return {
    schemaVersion: DRAFT_LAYOUT_V1_VERSION,
    root: { columns: 2 },
    sections: { attributes: { columns: 2 } },
    nodes: {
      character_name: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
      attributes: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
      strength: {
        columnStart: 2,
        columnSpan: 1,
        rowSpan: 1,
        breakBefore: false,
      },
      homeland: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
    },
    ...overrides,
  };
}

function draftErrorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

describe("draft-layout-v1 schema", () => {
  it("accepts a valid complete explicit layout", () => {
    const draft = { ...makeStructuredDraft(), layout: makeExplicitLayout() };
    expect(() => validateDraftV2(draft)).not.toThrow();
  });

  it("accepts a missing optional layout", () => {
    expect(() => validateDraftV2(makeStructuredDraft())).not.toThrow();
  });

  it("rejects an unknown section container entry", () => {
    const layout = makeExplicitLayout({
      sections: {
        attributes: { columns: 2 },
        ghost: { columns: 1 },
      },
    });
    expect(
      draftErrorCodeOf(() =>
        validateDraftV2({ ...makeStructuredDraft(), layout }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects a missing section container entry when layout is explicit", () => {
    const layout = makeExplicitLayout({ sections: {} });
    expect(
      draftErrorCodeOf(() =>
        validateDraftV2({ ...makeStructuredDraft(), layout }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects an unknown node entry", () => {
    const base = makeExplicitLayout();
    const layout: DraftLayoutV1 = {
      ...base,
      nodes: { ...base.nodes, ghost: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 } },
    };
    expect(
      draftErrorCodeOf(() =>
        validateDraftV2({ ...makeStructuredDraft(), layout }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects a missing node entry when layout is explicit", () => {
    const base = makeExplicitLayout();
    const { strength: _removed, ...nodes } = base.nodes;
    const layout: DraftLayoutV1 = { ...base, nodes };
    expect(
      draftErrorCodeOf(() =>
        validateDraftV2({ ...makeStructuredDraft(), layout }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects out-of-range container columns", () => {
    for (const columns of [0, 5, 2.5, Number.NaN]) {
      const layout = makeExplicitLayout({ root: { columns } });
      expect(
        draftErrorCodeOf(() =>
          validateDraftV2({ ...makeStructuredDraft(), layout }),
        ),
      ).toBe("invalid_draft");
    }
  });

  it("rejects node geometry beyond the current parent columns", () => {
    const base = makeExplicitLayout();
    const layout: DraftLayoutV1 = {
      ...base,
      nodes: {
        ...base.nodes,
        strength: {
          columnStart: 2,
          columnSpan: 2,
          rowSpan: 1,
          breakBefore: false,
        },
      },
    };
    expect(
      draftErrorCodeOf(() =>
        validateDraftV2({ ...makeStructuredDraft(), layout }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects an out-of-range rowSpan", () => {
    const base = makeExplicitLayout();
    for (const rowSpan of [0, 13]) {
      const layout: DraftLayoutV1 = {
        ...base,
        nodes: {
          ...base.nodes,
          strength: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan,
            breakBefore: false,
          },
        },
      };
      expect(
        draftErrorCodeOf(() =>
          validateDraftV2({ ...makeStructuredDraft(), layout }),
        ),
      ).toBe("invalid_draft");
    }
  });

  it("carries no structural authority: only geometry keys exist", () => {
    const parsed = DraftLayoutV1Schema.parse(makeExplicitLayout());
    expect(Object.keys(parsed).sort()).toEqual([
      "nodes",
      "root",
      "schemaVersion",
      "sections",
    ]);
    expect(Object.keys(parsed.root)).toEqual(["columns"]);
    for (const node of Object.values(parsed.nodes)) {
      expect(Object.keys(node).sort()).toEqual([
        "breakBefore",
        "columnSpan",
        "columnStart",
        "rowSpan",
      ]);
    }
  });

  it("rejects a wrong layout schemaVersion", () => {
    const layout = { ...makeExplicitLayout(), schemaVersion: "2" };
    expect(
      draftErrorCodeOf(() =>
        validateDraftV2({ ...makeStructuredDraft(), layout }),
      ),
    ).toBe("invalid_draft");
  });
});

describe("resolveEffectiveDraftLayoutV1", () => {
  it("resolves deterministic defaults for a layoutless V2 draft", () => {
    const effective = resolveEffectiveDraftLayoutV1(makeStructuredDraft());
    expect(effective).toEqual({
      schemaVersion: "1",
      root: { columns: 1 },
      sections: { attributes: { columns: 1 } },
      nodes: {
        character_name: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
        attributes: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
        strength: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
        homeland: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
      },
    });
  });

  it("returns an explicit layout faithfully", () => {
    const layout = makeExplicitLayout();
    const draft = { ...makeStructuredDraft(), layout };
    expect(resolveEffectiveDraftLayoutV1(draft)).toBe(layout);
  });

  it("never mutates the input draft", () => {
    const draft = makeStructuredDraft();
    const before = JSON.stringify(draft);
    resolveEffectiveDraftLayoutV1(draft);
    expect(JSON.stringify(draft)).toBe(before);
    expect(draft.layout).toBeUndefined();
  });

  it("resolves defaults for a migrated V1 draft", () => {
    const v1 = makeDraft();
    const migrated = migrateCharacterSheetDraftV1ToV2(
      parseLegacyCharacterSheetDraftV1(v1),
    );
    expect(migrated.layout).toBeUndefined();
    const effective = resolveEffectiveDraftLayoutV1(migrated);
    expect(effective.root).toEqual(DEFAULT_DRAFT_CONTAINER_LAYOUT_V1);
    expect(Object.keys(effective.nodes).sort()).toEqual(
      migrated.structure.map((entry) => entry.key).sort(),
    );
  });

  it("a layoutless historical V2 draft remains valid", () => {
    const draft = makeStructuredDraft();
    expect(draft.layout).toBeUndefined();
    expect(() => validateDraftV2(draft)).not.toThrow();
  });

  it("assertDraftLayoutComplete accepts the default layout", () => {
    const draft = makeStructuredDraft();
    expect(() =>
      assertDraftLayoutComplete(draft, defaultDraftLayoutV1(draft)),
    ).not.toThrow();
  });
});
