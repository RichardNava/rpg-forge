import { describe, expect, it } from "vitest";
import {
  applyDraftLayoutMutationWithExpectedVersionV2,
  parseDraftLayoutMutationV2,
} from "./draft-layout-mutation-v2";
import {
  applyDraftMutationV2,
  parseDraftMutationV2,
} from "./draft-mutation-v2";
import {
  DEFAULT_DRAFT_NODE_LAYOUT_V1,
  resolveEffectiveDraftLayoutV1,
} from "./draft-layout-v1";
import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";

/**
 * Explicit-layout fixture: two-column Root, two-column "attributes"
 * container, strength placed at column 2 inside attributes.
 */
function makeLayoutDraft(overrides: Partial<CharacterSheetDraftV2> = {}) {
  const draft: CharacterSheetDraftV2 = {
    schemaVersion: "2",
    draftId: "draft.spatial",
    sessionId: "session.spatial",
    baseVersion: 3,
    version: 7,
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
    layout: {
      schemaVersion: "1",
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
    },
    ...overrides,
  };
  return draft;
}

function makeLayoutlessDraft(): CharacterSheetDraftV2 {
  const draft = makeLayoutDraft();
  const { layout: _layout, ...rest } = draft;
  return rest;
}

function draftErrorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}

function apply(
  draft: CharacterSheetDraftV2,
  mutation: Parameters<typeof applyDraftMutationV2>[1],
): CharacterSheetDraftV2 {
  return applyDraftMutationV2(draft, mutation, draft.version);
}

describe("set_container_layout", () => {
  it("sets Root columns with exactly N+1", () => {
    const draft = makeLayoutDraft();
    const next = apply(draft, {
      op: "set_container_layout",
      containerKey: null,
      columns: 3,
    });
    expect(next.version).toBe(8);
    expect(next.baseVersion).toBe(3);
    expect(next.layout?.root.columns).toBe(3);
    expect(next.layout?.sections["attributes"]?.columns).toBe(2);
  });

  it("sets Section container columns", () => {
    const draft = makeLayoutDraft();
    const next = apply(draft, {
      op: "set_container_layout",
      containerKey: "attributes",
      columns: 4,
    });
    expect(next.version).toBe(8);
    expect(next.layout?.sections["attributes"]?.columns).toBe(4);
    // Existing child geometry is preserved, not rescaled.
    expect(next.layout?.nodes["strength"]).toEqual({
      columnStart: 2,
      columnSpan: 1,
      rowSpan: 1,
      breakBefore: false,
    });
  });

  it("rejects an unknown container section", () => {
    const draft = makeLayoutDraft();
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_container_layout",
          containerKey: "ghost",
          columns: 2,
        }),
      ),
    ).toBe("invalid_mutation");
  });

  it("rejects out-of-range columns at parse time", () => {
    for (const columns of [0, 5]) {
      expect(
        draftErrorCodeOf(() =>
          parseDraftMutationV2({
            op: "set_container_layout",
            containerKey: null,
            columns,
          }),
        ),
      ).toBe("invalid_mutation");
    }
  });

  it("is a semantic no-op when columns are unchanged", () => {
    const draft = makeLayoutDraft();
    const next = apply(draft, {
      op: "set_container_layout",
      containerKey: null,
      columns: 2,
    });
    expect(next).toBe(draft);
  });

  it("rejects shrinking columns that would orphan child geometry", () => {
    // strength sits at column 2 inside the 2-column attributes container.
    const draft = makeLayoutDraft();
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_container_layout",
          containerKey: "attributes",
          columns: 1,
        }),
      ),
    ).toBe("invalid_mutation");
  });

  it("rejects shrinking Root columns that would orphan child geometry", () => {
    const draft = makeLayoutDraft({
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: { attributes: { columns: 2 } },
        nodes: {
          character_name: {
            columnStart: 2,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
          attributes: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
          strength: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
          homeland: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
        },
      },
    });
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_container_layout",
          containerKey: null,
          columns: 1,
        }),
      ),
    ).toBe("invalid_mutation");
  });

  it("materializes defaults on a layoutless draft before applying", () => {
    const draft = makeLayoutlessDraft();
    const next = apply(draft, {
      op: "set_container_layout",
      containerKey: "attributes",
      columns: 3,
    });
    expect(next.version).toBe(8);
    expect(next.layout?.root.columns).toBe(1);
    expect(next.layout?.sections["attributes"]?.columns).toBe(3);
    expect(next.layout?.nodes["strength"]).toEqual(
      DEFAULT_DRAFT_NODE_LAYOUT_V1,
    );
  });

  it("rejects a confirmed draft", () => {
    const draft = makeLayoutDraft({ confirmed: true });
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_container_layout",
          containerKey: null,
          columns: 3,
        }),
      ),
    ).toBe("draft_confirmed");
  });

  it("rejects a stale expectedVersion first", () => {
    const draft = makeLayoutDraft();
    expect(
      draftErrorCodeOf(() =>
        applyDraftMutationV2(
          draft,
          {
            op: "set_container_layout",
            containerKey: "ghost",
            columns: 3,
          },
          draft.version - 1,
        ),
      ),
    ).toBe("version_conflict");
  });
});

describe("set_node_layout", () => {
  it("sets Field geometry with exactly N+1", () => {
    const draft = makeLayoutDraft();
    const next = apply(draft, {
      op: "set_node_layout",
      key: "homeland",
      placement: {
        columnStart: 2,
        columnSpan: 1,
        rowSpan: 2,
        breakBefore: true,
      },
    });
    expect(next.version).toBe(8);
    expect(next.baseVersion).toBe(3);
    expect(next.layout?.nodes["homeland"]).toEqual({
      columnStart: 2,
      columnSpan: 1,
      rowSpan: 2,
      breakBefore: true,
    });
  });

  it("sets Section-node geometry", () => {
    const draft = makeLayoutDraft();
    const next = apply(draft, {
      op: "set_node_layout",
      key: "attributes",
      placement: {
        columnStart: 1,
        columnSpan: 2,
        rowSpan: 1,
        breakBefore: false,
      },
    });
    expect(next.version).toBe(8);
    expect(next.layout?.nodes["attributes"]).toEqual({
      columnStart: 1,
      columnSpan: 2,
      rowSpan: 1,
      breakBefore: false,
    });
  });

  it("rejects an unknown node key", () => {
    const draft = makeLayoutDraft();
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_node_layout",
          key: "ghost",
          placement: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
        }),
      ),
    ).toBe("invalid_mutation");
  });

  it("rejects geometry beyond the current parent columns", () => {
    const draft = makeLayoutDraft();
    // strength lives in the 2-column attributes container.
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_node_layout",
          key: "strength",
          placement: {
            columnStart: 2,
            columnSpan: 2,
            rowSpan: 1,
            breakBefore: false,
          },
        }),
      ),
    ).toBe("invalid_mutation");
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_node_layout",
          key: "strength",
          placement: {
            columnStart: 3,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
        }),
      ),
    ).toBe("invalid_mutation");
  });

  it("rejects an out-of-range rowSpan at parse time", () => {
    expect(
      draftErrorCodeOf(() =>
        parseDraftMutationV2({
          op: "set_node_layout",
          key: "strength",
          placement: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 13,
            breakBefore: false,
          },
        }),
      ),
    ).toBe("invalid_mutation");
  });

  it("is a semantic no-op for identical geometry", () => {
    const draft = makeLayoutDraft();
    const next = apply(draft, {
      op: "set_node_layout",
      key: "strength",
      placement: {
        columnStart: 2,
        columnSpan: 1,
        rowSpan: 1,
        breakBefore: false,
      },
    });
    expect(next).toBe(draft);
  });

  it("materializes defaults on a layoutless draft before applying", () => {
    const draft = makeLayoutlessDraft();
    const next = apply(draft, {
      op: "set_node_layout",
      key: "strength",
      placement: {
        columnStart: 1,
        columnSpan: 1,
        rowSpan: 2,
        breakBefore: true,
      },
    });
    expect(next.version).toBe(8);
    // Materialized layout is complete: every node present.
    expect(Object.keys(next.layout?.nodes ?? {}).sort()).toEqual([
      "attributes",
      "character_name",
      "homeland",
      "strength",
    ]);
    expect(next.layout?.nodes["strength"]).toEqual({
      columnStart: 1,
      columnSpan: 1,
      rowSpan: 2,
      breakBefore: true,
    });
  });

  it("rejects a confirmed draft", () => {
    const draft = makeLayoutDraft({ confirmed: true });
    expect(
      draftErrorCodeOf(() =>
        apply(draft, {
          op: "set_node_layout",
          key: "strength",
          placement: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
        }),
      ),
    ).toBe("draft_confirmed");
  });

  it("rejects an expectedVersion smuggled into the payload", () => {
    expect(
      draftErrorCodeOf(() =>
        parseDraftLayoutMutationV2({
          op: "set_node_layout",
          key: "strength",
          placement: { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 },
          expectedVersion: 7,
        }),
      ),
    ).toBe("invalid_mutation");
  });
});

describe("spatial union routing", () => {
  it("dispatches both spatial ops through the unified contract", () => {
    const draft = makeLayoutDraft();
    const container = applyDraftMutationV2(
      draft,
      parseDraftMutationV2({
        op: "set_container_layout",
        containerKey: null,
        columns: 4,
      }),
      draft.version,
    );
    expect(container.layout?.root.columns).toBe(4);
    const node = applyDraftMutationV2(
      draft,
      parseDraftMutationV2({
        op: "set_node_layout",
        key: "homeland",
        placement: {
          columnStart: 1,
          columnSpan: 2,
          rowSpan: 1,
          breakBefore: false,
        },
      }),
      draft.version,
    );
    expect(node.layout?.nodes["homeland"]?.columnSpan).toBe(2);
  });

  it("effective layout reflects spatial mutations", () => {
    const draft = makeLayoutDraft();
    const next = apply(draft, {
      op: "set_container_layout",
      containerKey: null,
      columns: 4,
    });
    expect(resolveEffectiveDraftLayoutV1(next).root.columns).toBe(4);
  });
});
