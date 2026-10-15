import { describe, expect, it } from "vitest";
import {
  applyDraftMutationV2,
  parseDraftMutationV2,
  type DraftMutationV2,
} from "./draft-mutation-v2";
import {
  applyDraftSlotRegistryMutationWithExpectedVersionV2,
  parseDraftSlotRegistryMutationV2,
} from "./draft-slot-registry-mutation-v2";
import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { defaultDraftLayoutV1 } from "./draft-layout-v1";
import { buildDraftStructuralReadModelV2 } from "./draft-read-model-v2";
import { DraftError } from "./errors";

function makeSlotDraft(): CharacterSheetDraftV2 {
  const base = {
    schemaVersion: "2" as const,
    draftId: "draft.slot",
    sessionId: "session.slot",
    baseVersion: 1,
    version: 2,
    mode: "pc" as const,
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text" as const, locked: false },
      { key: "strength", label: "Strength", type: "number" as const, min: 1, max: 20, locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section" as const, key: "core", parentKey: null },
      { kind: "field" as const, key: "character_name", parentKey: "core" },
      { kind: "field" as const, key: "strength", parentKey: "core" },
    ],
    values: { character_name: "Aria", strength: 12 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
  return {
    ...base,
    layout: defaultDraftLayoutV1(base),
  };
}

function apply(
  draft: CharacterSheetDraftV2,
  mutation: DraftMutationV2,
  expectedVersion = draft.version,
): CharacterSheetDraftV2 {
  return applyDraftMutationV2(draft, mutation, expectedVersion);
}

function errorCodeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    if (error instanceof DraftError) return error.code;
    throw error;
  }
  return null;
}

describe("draft-slot schema (14.13)", () => {
  it("historical V2 without slots remains valid", () => {
    const draft = makeSlotDraft();
    expect(draft.slots).toBeUndefined();
    expect(() => validateDraftV2(draft)).not.toThrow();
  });

  it("slots are optional and default absent", () => {
    const parsed = validateDraftV2(makeSlotDraft());
    expect(parsed.slots).toBeUndefined();
  });

  it("rejects more than one portrait slot", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() =>
        validateDraftV2({
          ...draft,
          slots: [
            { key: "portrait_a", type: "portrait" },
            { key: "portrait_b", type: "portrait" },
          ],
          structure: [
            ...draft.structure,
            { kind: "slot", key: "portrait_a", parentKey: null },
            { kind: "slot", key: "portrait_b", parentKey: null },
          ],
        }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects a slot key colliding with a field", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() =>
        validateDraftV2({
          ...draft,
          slots: [{ key: "strength", type: "portrait" }],
          structure: [
            ...draft.structure,
            { kind: "slot", key: "strength", parentKey: null },
          ],
        }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects a slot key colliding with a section", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() =>
        validateDraftV2({
          ...draft,
          slots: [{ key: "core", type: "portrait" }],
          structure: [
            ...draft.structure,
            { kind: "slot", key: "core", parentKey: null },
          ],
        }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects an orphan slot without placement", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() =>
        validateDraftV2({
          ...draft,
          slots: [{ key: "portrait", type: "portrait" }],
        }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects a duplicated slot placement", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    expect(
      errorCodeOf(() =>
        validateDraftV2({
          ...withSlot,
          structure: [
            ...withSlot.structure,
            { kind: "slot", key: "portrait", parentKey: null },
          ],
        }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects children parented by a slot (slot is terminal)", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    expect(
      errorCodeOf(() =>
        validateDraftV2({
          ...withSlot,
          structure: [
            ...withSlot.structure.slice(0, 1),
            { kind: "field", key: "strength", parentKey: "portrait" },
            ...withSlot.structure.slice(1),
          ],
        }),
      ),
    ).toBe("invalid_draft");
  });

  it("rejects a slot parented by a field", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    expect(
      errorCodeOf(() =>
        validateDraftV2({
          ...withSlot,
          structure: withSlot.structure.map((p) =>
            p.kind === "slot" && p.key === "portrait"
              ? { ...p, parentKey: "strength" }
              : p,
          ),
        }),
      ),
    ).toBe("invalid_draft");
  });
});

describe("add_portrait_slot", () => {
  it("adds slot + placement + layout node + default 3:4 aspect atomically", () => {
    const draft = makeSlotDraft();
    const next = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    expect(next.version).toBe(draft.version + 1);
    expect(next.baseVersion).toBe(draft.baseVersion);
    expect(next.slots).toEqual([{ key: "portrait", type: "portrait" }]);
    expect(
      next.structure.find((p) => p.kind === "slot" && p.key === "portrait"),
    ).toEqual({ kind: "slot", key: "portrait", parentKey: null });
    expect(next.layout?.nodes["portrait"]).toEqual({
      columnStart: 1,
      columnSpan: 1,
      rowSpan: 1,
      breakBefore: false,
    });
    expect(next.layout?.slotDetails?.["portrait"]).toEqual({ aspectRatio: "3:4" });
    // Draft content untouched.
    expect(next.fields).toEqual(draft.fields);
    expect(next.values).toEqual(draft.values);
  });

  it("accepts an explicit Section parent", () => {
    const draft = makeSlotDraft();
    const next = apply(draft, {
      op: "add_portrait_slot",
      key: "portrait",
      parentKey: "core",
    });
    expect(
      next.structure.find((p) => p.kind === "slot" && p.key === "portrait")?.parentKey,
    ).toBe("core");
  });

  it("rejects a non-section parent", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() => apply(draft, { op: "add_portrait_slot", key: "portrait", parentKey: "strength" })),
    ).toBe("invalid_mutation");
  });

  it("rejects a second portrait slot", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    expect(
      errorCodeOf(() =>
        apply(withSlot, { op: "add_portrait_slot", key: "portrait_b" }, withSlot.version),
      ),
    ).toBe("invalid_mutation");
  });

  it("rejects a colliding key", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() => apply(draft, { op: "add_portrait_slot", key: "strength" })),
    ).toBe("invalid_mutation");
  });

  it("rejects on a confirmed draft", () => {
    const draft = validateDraftV2({ ...makeSlotDraft(), confirmed: true });
    expect(
      errorCodeOf(() => apply(draft, { op: "add_portrait_slot", key: "portrait" })),
    ).toBe("draft_confirmed");
  });

  it("rejects a stale expectedVersion", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() =>
        apply(draft, { op: "add_portrait_slot", key: "portrait" }, draft.version + 5),
      ),
    ).toBe("version_conflict");
  });

  it("keeps a layoutless draft layoutless", () => {
    const { layout: _layout, ...layoutless } = makeSlotDraft();
    void _layout;
    const base = validateDraftV2(layoutless);
    const next = apply(base, { op: "add_portrait_slot", key: "portrait" });
    expect(next.layout).toBeUndefined();
    expect(next.slots).toEqual([{ key: "portrait", type: "portrait" }]);
  });
});

describe("remove_portrait_slot", () => {
  it("removes slot + placement + layout node + slot detail atomically", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    const next = apply(withSlot, { op: "remove_portrait_slot", key: "portrait" }, withSlot.version);
    expect(next.version).toBe(withSlot.version + 1);
    expect(next.slots ?? []).toEqual([]);
    expect(next.structure.some((p) => p.kind === "slot")).toBe(false);
    expect(next.layout?.nodes["portrait"]).toBeUndefined();
    expect(next.layout?.slotDetails?.["portrait"]).toBeUndefined();
    expect(next.fields).toEqual(draft.fields);
  });

  it("rejects an unknown slot", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() => apply(draft, { op: "remove_portrait_slot", key: "ghost" })),
    ).toBe("invalid_mutation");
  });

  it("rejects on a confirmed draft", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    const confirmed = validateDraftV2({ ...withSlot, confirmed: true });
    expect(
      errorCodeOf(() =>
        apply(confirmed, { op: "remove_portrait_slot", key: "portrait" }, confirmed.version),
      ),
    ).toBe("draft_confirmed");
  });
});

describe("set_portrait_aspect_ratio", () => {
  it("updates the aspect ratio with one version bump", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    const next = apply(
      withSlot,
      { op: "set_portrait_aspect_ratio", key: "portrait", aspectRatio: "1:1" },
      withSlot.version,
    );
    expect(next.version).toBe(withSlot.version + 1);
    expect(next.layout?.slotDetails?.["portrait"]).toEqual({ aspectRatio: "1:1" });
    expect(next.slots).toEqual(withSlot.slots);
    expect(next.structure).toEqual(withSlot.structure);
  });

  it("accepts every bounded aspect ratio", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    for (const aspectRatio of ["1:1", "3:4", "4:5", "16:9"] as const) {
      const next = applyDraftSlotRegistryMutationWithExpectedVersionV2(
        withSlot,
        { op: "set_portrait_aspect_ratio", key: "portrait", aspectRatio },
        withSlot.version,
      );
      expect(next.layout?.slotDetails?.["portrait"]?.aspectRatio).toBe(aspectRatio);
    }
  });

  it("is a semantic no-op when the ratio is unchanged", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    const next = apply(
      withSlot,
      { op: "set_portrait_aspect_ratio", key: "portrait", aspectRatio: "3:4" },
      withSlot.version,
    );
    expect(next).toBe(withSlot);
  });

  it("rejects an unknown slot", () => {
    const draft = makeSlotDraft();
    expect(
      errorCodeOf(() =>
        apply(draft, { op: "set_portrait_aspect_ratio", key: "ghost", aspectRatio: "1:1" }),
      ),
    ).toBe("invalid_mutation");
  });

  it("rejects an unbounded aspect ratio at parse time", () => {
    expect(
      errorCodeOf(() =>
        parseDraftSlotRegistryMutationV2({
          op: "set_portrait_aspect_ratio",
          key: "portrait",
          aspectRatio: "21:9",
        }),
      ),
    ).toBe("invalid_mutation");
    expect(
      errorCodeOf(() =>
        parseDraftMutationV2({
          op: "set_portrait_aspect_ratio",
          key: "portrait",
          aspectRatio: "21:9",
        }),
      ),
    ).toBe("invalid_mutation");
  });
});

describe("place_node with slots", () => {
  function slottedDraft(): CharacterSheetDraftV2 {
    const draft = makeSlotDraft();
    return apply(draft, { op: "add_portrait_slot", key: "portrait" });
  }

  it("moves a slot before a field", () => {
    const draft = slottedDraft();
    const next = apply(
      draft,
      { op: "place_node", key: "portrait", destination: { position: "before", targetKey: "strength" } },
      draft.version,
    );
    expect(next.version).toBe(draft.version + 1);
    const order = next.structure.map((p) => `${p.kind}:${p.key}`);
    expect(order.indexOf("slot:portrait")).toBeLessThan(order.indexOf("field:strength"));
    // Geometry and aspect preserved.
    expect(next.layout?.nodes["portrait"]).toEqual(draft.layout?.nodes["portrait"]);
    expect(next.layout?.slotDetails?.["portrait"]).toEqual({ aspectRatio: "3:4" });
  });

  it("moves a slot inside a section and back to root", () => {
    const draft = slottedDraft();
    const inside = apply(
      draft,
      { op: "place_node", key: "portrait", destination: { position: "inside", parentKey: "core" } },
      draft.version,
    );
    expect(
      inside.structure.find((p) => p.kind === "slot" && p.key === "portrait")?.parentKey,
    ).toBe("core");
    const back = apply(
      inside,
      { op: "place_node", key: "portrait", destination: { position: "inside", parentKey: null } },
      inside.version,
    );
    expect(
      back.structure.find((p) => p.kind === "slot" && p.key === "portrait")?.parentKey,
    ).toBeNull();
  });

  it("moves a field after a slot", () => {
    const draft = slottedDraft();
    const next = apply(
      draft,
      { op: "place_node", key: "strength", destination: { position: "after", targetKey: "portrait" } },
      draft.version,
    );
    const order = next.structure.map((p) => `${p.kind}:${p.key}`);
    expect(order.indexOf("field:strength")).toBeGreaterThan(order.indexOf("slot:portrait"));
  });

  it("rejects parenting a field inside a slot", () => {
    const draft = slottedDraft();
    expect(
      errorCodeOf(() =>
        apply(
          draft,
          { op: "place_node", key: "strength", destination: { position: "inside", parentKey: "portrait" } },
          draft.version,
        ),
      ),
    ).toBe("invalid_mutation");
  });

  it("rejects incompatible destination geometry without clamping", () => {
    const base = makeSlotDraft();
    const layout = {
      schemaVersion: "1" as const,
      root: { columns: 2 },
      sections: { core: { columns: 2 } },
      nodes: {
        core: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
        character_name: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        strength: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        portrait: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
      },
      slotDetails: { portrait: { aspectRatio: "3:4" as const } },
    };
    const draft = validateDraftV2({
      ...base,
      slots: [{ key: "portrait", type: "portrait" }],
      structure: [
        ...base.structure,
        { kind: "slot", key: "portrait", parentKey: null },
      ],
      layout,
    });
    // Portrait at column 2 fits the 2-column root. Shrinking the target
    // section to 1 column makes the preserved geometry incompatible.
    const narrow = validateDraftV2({
      ...draft,
      layout: {
        ...layout,
        sections: { core: { columns: 1 } },
      },
    });
    expect(
      errorCodeOf(() =>
        applyDraftSlotRegistryMutationWithExpectedVersionV2(
          narrow,
          { op: "set_portrait_aspect_ratio", key: "portrait", aspectRatio: "1:1" },
          narrow.version,
        ),
      ),
    ).toBe(null); // aspect change is geometry-independent
    expect(
      errorCodeOf(() =>
        apply(
          narrow,
          { op: "place_node", key: "portrait", destination: { position: "inside", parentKey: "core" } },
          narrow.version,
        ),
      ),
    ).toBe("invalid_mutation");
  });
});

describe("slot read model", () => {
  it("exposes the slot as a first-class read node", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    const model = buildDraftStructuralReadModelV2(withSlot);
    const node = model.nodeByKey.get("portrait");
    if (node?.kind !== "slot") throw new Error("expected a slot node");
    expect(node.slot).toEqual({ key: "portrait", type: "portrait" });
    expect(node.parentKey).toBeNull();
    const roots = model.roots.map((n) => `${n.kind}:${n.key}`);
    expect(roots).toContain("slot:portrait");
  });
});

describe("slot undo", () => {
  // Server-authoritative Undo restores content by loading the undo-source
  // snapshot from R2 and re-applying the undo mutation on top. These tests
  // simulate exactly that orchestration step: slot registry, placement and
  // layout geometry all travel inside the snapshot, so no portrait-specific
  // Undo path exists.
  function undoFromSource(
    current: CharacterSheetDraftV2,
    source: CharacterSheetDraftV2,
  ): CharacterSheetDraftV2 {
    const restored: CharacterSheetDraftV2 = {
      ...source,
      draftId: current.draftId,
      sessionId: current.sessionId,
      baseVersion: current.baseVersion,
      version: current.version,
      mode: current.mode,
      rulesContextId: current.rulesContextId,
      source: current.source,
      characterName: current.characterName,
      confirmed: false,
    };
    return applyDraftMutationV2(restored, { op: "undo" }, restored.version);
  }

  it("add portrait slot then undo removes the slot", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    expect(withSlot.slots).toHaveLength(1);
    const undone = undoFromSource(withSlot, draft);
    expect(undone.slots ?? []).toEqual([]);
    expect(undone.structure.some((p) => p.kind === "slot")).toBe(false);
    expect(undone.layout?.nodes["portrait"]).toBeUndefined();
    expect(undone.layout?.slotDetails?.["portrait"]).toBeUndefined();
  });

  it("aspect change then undo restores the previous aspect", () => {
    const draft = makeSlotDraft();
    const withSlot = apply(draft, { op: "add_portrait_slot", key: "portrait" });
    const changed = apply(
      withSlot,
      { op: "set_portrait_aspect_ratio", key: "portrait", aspectRatio: "16:9" },
      withSlot.version,
    );
    expect(changed.layout?.slotDetails?.["portrait"]).toEqual({ aspectRatio: "16:9" });
    const undone = undoFromSource(changed, withSlot);
    expect(undone.layout?.slotDetails?.["portrait"]).toEqual({ aspectRatio: "3:4" });
    expect(undone.slots).toEqual([{ key: "portrait", type: "portrait" }]);
    // Asset content itself is not part of the Draft and is untouched by Undo.
  });
});
