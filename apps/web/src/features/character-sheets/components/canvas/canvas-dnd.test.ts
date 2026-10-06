import { describe, expect, it } from "vitest";
import {
  buildDraftStructuralReadModelV2,
  defaultDraftLayoutV1,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import {
  canvasAnnouncements,
  canvasCollisionDetection,
  canvasScreenReaderInstructions,
  describeDropIntent,
  describeDropResult,
  dropIntentId,
  parseDropIntentId,
  resolveDropDestination,
  validMoveTargets,
} from "./canvas-dnd";

function makeDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.canvas",
    sessionId: "session.canvas",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: null,
    rulesContextId: null,
    fields: [
      { key: "a", label: "Alpha", type: "text", locked: false },
      { key: "b", label: "Beta", type: "text", locked: false },
      { key: "c", label: "Gamma", type: "text", locked: false },
    ],
    sections: [
      { key: "s1", title: "First" },
      { key: "s2", title: "Second" },
    ],
    structure: [
      { kind: "field", key: "a", parentKey: null },
      { kind: "section", key: "s1", parentKey: null },
      { kind: "field", key: "b", parentKey: "s1" },
      { kind: "section", key: "s2", parentKey: "s1" },
      { kind: "field", key: "c", parentKey: null },
    ],
    values: {},
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function contextOf(
  sourceKey: string,
  sourceKind: "field" | "section" = "field",
) {
  const draft = makeDraft();
  return {
    readModel: buildDraftStructuralReadModelV2(draft),
    layout: defaultDraftLayoutV1(draft),
    sourceKey,
    sourceKind,
    draft,
  };
}

describe("drop intent ids", () => {
  it("round-trips before/after/inside/root intents", () => {
    expect(
      parseDropIntentId(
        dropIntentId({ kind: "before", targetKind: "field", key: "a" }),
      ),
    ).toEqual({ kind: "before", targetKind: "field", key: "a" });
    expect(
      parseDropIntentId(
        dropIntentId({ kind: "after", targetKind: "section", key: "s1" }),
      ),
    ).toEqual({ kind: "after", targetKind: "section", key: "s1" });
    expect(
      parseDropIntentId(dropIntentId({ kind: "inside", sectionKey: "s1" })),
    ).toEqual({ kind: "inside", sectionKey: "s1" });
    expect(
      parseDropIntentId(dropIntentId({ kind: "inside", sectionKey: null })),
    ).toEqual({ kind: "inside", sectionKey: null });
  });

  it("rejects foreign ids", () => {
    expect(parseDropIntentId("unassigned")).toBeNull();
    expect(parseDropIntentId("canvas:before:field:")).toBeNull();
    expect(parseDropIntentId("canvas:sideways:field:a")).toBeNull();
    expect(parseDropIntentId("other:inside:s1")).toBeNull();
  });
});

describe("resolveDropDestination", () => {
  it("maps before/after to sibling destinations", () => {
    const context = contextOf("a");
    expect(
      resolveDropDestination(context, {
        kind: "before",
        targetKind: "field",
        key: "c",
      }),
    ).toEqual({
      ok: true,
      destination: { position: "before", targetKey: "c" },
    });
    expect(
      resolveDropDestination(context, {
        kind: "after",
        targetKind: "section",
        key: "s1",
      }),
    ).toEqual({
      ok: true,
      destination: { position: "after", targetKey: "s1" },
    });
  });

  it("maps inside to container destinations", () => {
    const context = contextOf("a");
    expect(
      resolveDropDestination(context, { kind: "inside", sectionKey: "s1" }),
    ).toEqual({
      ok: true,
      destination: { position: "inside", parentKey: "s1" },
    });
    expect(
      resolveDropDestination(context, { kind: "inside", sectionKey: null }),
    ).toEqual({
      ok: true,
      destination: { position: "inside", parentKey: null },
    });
  });

  it("rejects self targets", () => {
    const context = contextOf("s1", "section");
    const self = resolveDropDestination(context, {
      kind: "inside",
      sectionKey: "s1",
    });
    expect(self.ok).toBe(false);
    const sibling = resolveDropDestination(context, {
      kind: "before",
      targetKind: "section",
      key: "s1",
    });
    expect(sibling.ok).toBe(false);
  });

  it("rejects descendant targets", () => {
    const context = contextOf("s1", "section");
    const resolved = resolveDropDestination(context, {
      kind: "inside",
      sectionKey: "s2",
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain("s2");
    }
  });

  it("rejects unknown targets", () => {
    const context = contextOf("a");
    expect(
      resolveDropDestination(context, {
        kind: "before",
        targetKind: "field",
        key: "ghost",
      }).ok,
    ).toBe(false);
    expect(
      resolveDropDestination(context, {
        kind: "inside",
        sectionKey: "ghost",
      }).ok,
    ).toBe(false);
  });

  it("rejects geometry that does not fit the destination", () => {
    const draft = makeDraft();
    const layout = {
      ...defaultDraftLayoutV1(draft),
      root: { columns: 2 },
      nodes: {
        ...defaultDraftLayoutV1(draft).nodes,
        a: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
      },
    };
    const context = {
      readModel: buildDraftStructuralReadModelV2({ ...draft, layout }),
      layout,
      sourceKey: "a",
      sourceKind: "field" as const,
    };
    // Narrow the destination container below the preserved start column.
    const narrow = {
      ...layout,
      sections: { s1: { columns: 1 }, s2: { columns: 1 } },
    };
    const narrowed = {
      ...context,
      layout: narrow,
    };
    const resolved = resolveDropDestination(narrowed, {
      kind: "inside",
      sectionKey: "s1",
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain("1 column");
    }
  });
});

describe("intent labels", () => {
  it("describes before/after/inside/root intents", () => {
    expect(
      describeDropIntent(
        { kind: "before", targetKind: "field", key: "b" },
        { sourceLabel: "Alpha", targetLabel: "Beta", parentLabel: "First" },
      ),
    ).toBe("Alpha, insert before Beta in First.");
    expect(
      describeDropIntent(
        { kind: "after", targetKind: "section", key: "s1" },
        { sourceLabel: "Alpha", targetLabel: "First", parentLabel: "" },
      ),
    ).toBe("Alpha, insert after First at top level.");
    expect(
      describeDropIntent(
        { kind: "inside", sectionKey: "s1" },
        { sourceLabel: "Alpha", targetLabel: "First", parentLabel: "" },
      ),
    ).toBe("Alpha, move inside First.");
    expect(
      describeDropIntent(
        { kind: "inside", sectionKey: null },
        { sourceLabel: "Alpha", targetLabel: "top level", parentLabel: "" },
      ),
    ).toBe("Alpha, move to top level.");
  });

  it("describes committed positions", () => {
    const draft = makeDraft();
    const readModel = buildDraftStructuralReadModelV2(draft);
    expect(
      describeDropResult(draft, readModel, draft.sections, "a", "Alpha", {
        position: "inside",
        parentKey: "s1",
      }),
    ).toBe("Alpha moved to position 3 of 3 in First.");
    expect(
      describeDropResult(draft, readModel, draft.sections, "c", "Gamma", {
        position: "before",
        targetKey: "a",
      }),
    ).toBe("Gamma moved to position 1 of 3 at top level.");
  });
});

describe("validMoveTargets", () => {
  function labelOf(key: string): string {
    const draft = makeDraft();
    return (
      draft.fields.find((entry) => entry.key === key)?.label ??
      draft.sections.find((entry) => entry.key === key)?.title ??
      key
    );
  }

  it("lists sibling, section, and root targets for a field", () => {
    const draft = makeDraft();
    const targets = validMoveTargets(
      buildDraftStructuralReadModelV2(draft),
      defaultDraftLayoutV1(draft),
      draft.sections,
      "a",
      "field",
      labelOf,
    );
    const labels = targets.map((entry) => entry.label);
    expect(labels).toContain("Before Gamma");
    expect(labels).toContain("After Gamma");
    expect(labels).toContain("Inside First");
    expect(labels).not.toContain("To top level");
  });

  it("omits self, descendant, and invalid entries for a section", () => {
    const draft = makeDraft();
    const targets = validMoveTargets(
      buildDraftStructuralReadModelV2(draft),
      defaultDraftLayoutV1(draft),
      draft.sections,
      "s1",
      "section",
      labelOf,
    );
    const labels = targets.map((entry) => entry.label);
    expect(labels).not.toContain("Inside First");
    expect(labels).not.toContain("Inside Second");
    // s1 already lives at top level, so no root entry is offered for it.
    expect(labels).not.toContain("To top level");
    expect(labels).toContain("Before Gamma");
  });

  it("offers top level for a nested section", () => {
    const draft = makeDraft();
    const targets = validMoveTargets(
      buildDraftStructuralReadModelV2(draft),
      defaultDraftLayoutV1(draft),
      draft.sections,
      "s2",
      "section",
      labelOf,
    );
    expect(targets.map((entry) => entry.label)).toContain("To top level");
  });
});

describe("announcements", () => {
  it("customizes instructions and pickup messages", () => {
    expect(canvasScreenReaderInstructions.draggable).toContain("Space");
    const announcements = canvasAnnouncements((key) => key);
    expect(
      announcements.onDragStart({
        active: {
          id: "field:a",
          data: { current: { label: "Alpha" } },
        } as never,
      }),
    ).toBe("Picked up Alpha.");
    expect(announcements.onDragCancel()).toBe("Move cancelled.");
  });

  it("announces hovered intents with readable labels", () => {
    const announcements = canvasAnnouncements((key) => key);
    expect(
      announcements.onDragOver({
        active: {
          id: "field:a",
          data: { current: { label: "Alpha" } },
        } as never,
        over: {
          id: "canvas:before:field:b",
          data: {
            current: {
              targetKey: "b",
              targetLabel: "Beta",
              parentLabel: "First",
            },
          },
        } as never,
      }),
    ).toBe("Alpha, insert before Beta in First.");
    expect(
      announcements.onDragOver({
        active: { id: "field:a", data: { current: {} } } as never,
        over: null,
      }),
    ).toBeUndefined();
  });
});

describe("canvasCollisionDetection", () => {
  function container(
    id: string,
    rect: { left: number; right: number; top: number; bottom: number },
  ) {
    return {
      id,
      data: { current: {} },
      node: { current: null },
      rect: { current: rect },
    };
  }

  const argsFor = (
    containers: ReturnType<typeof container>[],
    pointer: { x: number; y: number } | null,
  ) =>
    ({
      active: {
        id: "field:a",
        rect: { current: { left: 90, right: 110, top: 4, bottom: 24 } },
        data: { current: {} },
      },
      collisionRect: { left: 90, right: 110, top: 4, bottom: 24 },
      droppableContainers: containers,
      droppableRects: new Map(
        containers.map((entry) => [entry.id, entry.rect.current as never]),
      ),
      pointerCoordinates: pointer,
    }) as never;

  it("prefers rails over section bodies under the pointer", () => {
    const collisions = canvasCollisionDetection(
      argsFor(
        [
          container("canvas:inside:s1", {
            left: 0,
            right: 200,
            top: 0,
            bottom: 200,
          }),
          container("canvas:before:field:b", {
            left: 10,
            right: 190,
            top: 10,
            bottom: 18,
          }),
        ],
        { x: 100, y: 14 },
      ),
    );
    expect(collisions[0]?.id).toBe("canvas:before:field:b");
  });

  it("prefers the smallest body among nested sections", () => {
    const collisions = canvasCollisionDetection(
      argsFor(
        [
          container("canvas:inside:s1", {
            left: 0,
            right: 200,
            top: 0,
            bottom: 200,
          }),
          container("canvas:inside:s2", {
            left: 20,
            right: 100,
            top: 20,
            bottom: 100,
          }),
        ],
        { x: 50, y: 50 },
      ),
    );
    expect(collisions[0]?.id).toBe("canvas:inside:s2");
  });

  it("falls back to closestCenter without pointer coordinates", () => {
    const collisions = canvasCollisionDetection(
      argsFor(
        [
          container("canvas:inside:s1", {
            left: 0,
            right: 200,
            top: 0,
            bottom: 200,
          }),
        ],
        null,
      ),
    );
    expect(collisions.length).toBeGreaterThan(0);
  });
});
