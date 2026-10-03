import { describe, expect, it } from "vitest";
import {
  applyDraftMutationV2,
  DraftMutationV2Schema,
  parseDraftMutationV2,
  type DraftMutationV2,
} from "./draft-mutation-v2";
import {
  applyDraftContentMutationWithExpectedVersionV2,
  type DraftContentMutationV2,
} from "./draft-content-mutation-v2";
import {
  applyDraftFieldRegistryMutationWithExpectedVersionV2,
  type DraftFieldRegistryMutationV2,
} from "./draft-field-registry-mutation-v2";
import {
  applyDraftSectionRegistryMutationWithExpectedVersionV2,
  type DraftSectionRegistryMutationV2,
} from "./draft-section-registry-mutation-v2";
import { applyDraftNodePlacementWithExpectedVersionV2 } from "./draft-node-placement-concurrent";
import { validateDraftV2, type CharacterSheetDraftV2 } from "./draft-schema-v2";
import { DraftError } from "./errors";
import * as publicApi from "./index";

const opPayloads: Array<{ op: string; payload: unknown }> = [
  {
    op: "place_node",
    payload: {
      op: "place_node",
      key: "B",
      destination: { position: "before", targetKey: "A" },
    },
  },
  { op: "set_value", payload: { op: "set_value", key: "A", value: "hello" } },
  { op: "clear_value", payload: { op: "clear_value", key: "A" } },
  {
    op: "set_field_label",
    payload: { op: "set_field_label", key: "A", label: "New Label" },
  },
  {
    op: "set_field_type",
    payload: { op: "set_field_type", field: { key: "A", type: "text" } },
  },
  { op: "lock_field", payload: { op: "lock_field", key: "A" } },
  { op: "unlock_field", payload: { op: "unlock_field", key: "A" } },
  {
    op: "add_field",
    payload: {
      op: "add_field",
      field: { key: "C", label: "C", type: "number" },
    },
  },
  { op: "remove_field", payload: { op: "remove_field", key: "A" } },
  {
    op: "add_section",
    payload: {
      op: "add_section",
      section: { key: "details", title: "Details" },
    },
  },
  {
    op: "rename_section",
    payload: { op: "rename_section", key: "X", title: "Renamed" },
  },
];

const legacyOps = ["move_field", "reparent_section", "remove_section"];

describe("unified V2 mutation contract — BLOCK A", () => {
  it("recognizes every operation via DraftMutationV2Schema.safeParse", () => {
    for (const row of opPayloads) {
      expect(DraftMutationV2Schema.safeParse(row.payload).success).toBe(true);
    }
  });

  it("parseDraftMutationV2 returns the discriminated op for every operation", () => {
    for (const row of opPayloads) {
      expect(parseDraftMutationV2(row.payload).op).toBe(row.op);
    }
  });
});

describe("unified V2 mutation contract — BLOCK B", () => {
  it("rejects legacy ops through the schema", () => {
    for (const op of legacyOps) {
      const result = DraftMutationV2Schema.safeParse({ op });
      expect(result.success).toBe(false);
    }
  });

  it("rejects arbitrary unknown ops through the schema", () => {
    const result = DraftMutationV2Schema.safeParse({
      op: "arbitrary",
      key: "A",
    });
    expect(result.success).toBe(false);
  });

  it("rejects legacy ops through the parser with invalid_mutation", () => {
    for (const op of legacyOps) {
      try {
        parseDraftMutationV2({ op });
        expect.unreachable(`expected ${op} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    }
  });

  it("rejects arbitrary unknown ops through the parser with invalid_mutation", () => {
    try {
      parseDraftMutationV2({ op: "arbitrary", key: "A" });
      expect.unreachable("expected unknown op to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(DraftError);
      expect((error as DraftError).code).toBe("invalid_mutation");
    }
  });
});

describe("unified V2 mutation contract — BLOCK C", () => {
  const strictPayloads: unknown[] = [
    {
      op: "place_node",
      key: "B",
      destination: { position: "before", targetKey: "A" },
      expectedVersion: 1,
    },
    { op: "set_value", key: "A", value: "hello", expectedVersion: 1 },
    {
      op: "add_field",
      field: { key: "C", label: "C", type: "number" },
      expectedVersion: 1,
    },
    {
      op: "add_section",
      section: { key: "details", title: "Details" },
      expectedVersion: 1,
    },
  ];

  it("rejects expectedVersion smuggled into payloads via the schema", () => {
    for (const payload of strictPayloads) {
      expect(DraftMutationV2Schema.safeParse(payload).success).toBe(false);
    }
  });

  it("rejects expectedVersion smuggled into payloads via the parser", () => {
    for (const payload of strictPayloads) {
      try {
        parseDraftMutationV2(payload);
        expect.unreachable("expected expectedVersion payload to be rejected");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).code).toBe("invalid_mutation");
      }
    }
  });

  it("rejects extra top-level properties", () => {
    const payload = { op: "set_value", key: "A", value: "hello", extra: true };
    expect(DraftMutationV2Schema.safeParse(payload).success).toBe(false);
    try {
      parseDraftMutationV2(payload);
      expect.unreachable("expected extra property to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(DraftError);
      expect((error as DraftError).code).toBe("invalid_mutation");
    }
  });
});

describe("unified V2 mutation contract — BLOCK D", () => {
  it("delegates add_field domain validation to the field registry parser", () => {
    try {
      parseDraftMutationV2({
        op: "add_field",
        field: { key: "C", label: "C", type: "choice" },
      });
      expect.unreachable("expected choice-without-options to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(DraftError);
      expect((error as DraftError).code).toBe("invalid_mutation");
    }
  });
});

describe("unified V2 mutation contract — BLOCK E equivalence", () => {
  it("place_node via dispatcher equals direct node placement", () => {
    const draftA = makeFieldDraft();
    const draftB = makeFieldDraft();
    const mutation: DraftMutationV2 = {
      op: "place_node",
      key: "B",
      destination: { position: "before", targetKey: "A" },
    };
    const viaDispatcher = applyDraftMutationV2(draftA, mutation, 1);
    const viaDirect = applyDraftNodePlacementWithExpectedVersionV2(
      draftB,
      mutation.key,
      mutation.destination,
      1,
    );
    expect(viaDispatcher).toEqual(viaDirect);
    expect(viaDispatcher.version).toBe(viaDirect.version);
    expect(viaDispatcher.baseVersion).toBe(viaDirect.baseVersion);
  });

  it("set_value via dispatcher equals direct content mutation", () => {
    const draftA = makeFieldDraft();
    const draftB = makeFieldDraft();
    const mutation: DraftContentMutationV2 = {
      op: "set_value",
      key: "A",
      value: "zapped",
    };
    const viaDispatcher = applyDraftMutationV2(
      draftA,
      mutation,
      draftA.version,
    );
    const viaDirect = applyDraftContentMutationWithExpectedVersionV2(
      draftB,
      mutation,
      draftB.version,
    );
    expect(viaDispatcher).toEqual(viaDirect);
    expect(viaDispatcher.version).toBe(viaDirect.version);
    expect(viaDispatcher.baseVersion).toBe(viaDirect.baseVersion);
  });

  it("add_field via dispatcher equals direct field registry mutation", () => {
    const draftA = makeFieldDraft();
    const draftB = makeFieldDraft();
    const mutation: DraftFieldRegistryMutationV2 = {
      op: "add_field",
      field: { key: "C", label: "C", type: "number", locked: false },
    };
    const viaDispatcher = applyDraftMutationV2(
      draftA,
      mutation,
      draftA.version,
    );
    const viaDirect = applyDraftFieldRegistryMutationWithExpectedVersionV2(
      draftB,
      mutation,
      draftB.version,
    );
    expect(viaDispatcher).toEqual(viaDirect);
    expect(viaDispatcher.version).toBe(viaDirect.version);
    expect(viaDispatcher.baseVersion).toBe(viaDirect.baseVersion);
  });

  it("add_section via dispatcher equals direct section registry mutation", () => {
    const draftA = makeFieldDraft();
    const draftB = makeFieldDraft();
    const mutation: DraftSectionRegistryMutationV2 = {
      op: "add_section",
      section: { key: "details", title: "Details" },
    };
    const viaDispatcher = applyDraftMutationV2(
      draftA,
      mutation,
      draftA.version,
    );
    const viaDirect = applyDraftSectionRegistryMutationWithExpectedVersionV2(
      draftB,
      mutation,
      draftB.version,
    );
    expect(viaDispatcher).toEqual(viaDirect);
    expect(viaDispatcher.version).toBe(viaDirect.version);
    expect(viaDispatcher.baseVersion).toBe(viaDirect.baseVersion);
  });
});

describe("unified V2 mutation contract — BLOCK F all dispatch routes", () => {
  interface UnifiedRoute {
    name: string;
    build: () => CharacterSheetDraftV2;
    mutation: DraftMutationV2;
  }

  const routes: UnifiedRoute[] = [
    {
      name: "place_node",
      build: makeFieldDraft,
      mutation: {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      },
    },
    {
      name: "set_value",
      build: makeFieldDraft,
      mutation: { op: "set_value", key: "A", value: "updated" },
    },
    {
      name: "clear_value",
      build: makeFieldDraft,
      mutation: { op: "clear_value", key: "A" },
    },
    {
      name: "set_field_label",
      build: makeFieldDraft,
      mutation: { op: "set_field_label", key: "A", label: "Label A" },
    },
    {
      name: "set_field_type",
      build: makeFieldDraft,
      mutation: { op: "set_field_type", field: { key: "A", type: "textarea" } },
    },
    {
      name: "lock_field",
      build: makeFieldDraft,
      mutation: { op: "lock_field", key: "A" },
    },
    {
      name: "unlock_field",
      build: makeLockedFieldDraft,
      mutation: { op: "unlock_field", key: "A" },
    },
    {
      name: "add_field",
      build: makeFieldDraft,
      mutation: {
        op: "add_field",
        field: { key: "C", label: "C", type: "number", locked: false },
      },
    },
    {
      name: "remove_field",
      build: makeFieldDraft,
      mutation: { op: "remove_field", key: "A" },
    },
    {
      name: "add_section",
      build: makeFieldDraft,
      mutation: {
        op: "add_section",
        section: { key: "details", title: "Details" },
      },
    },
    {
      name: "rename_section",
      build: makeSectionDraft,
      mutation: { op: "rename_section", key: "X", title: "Details" },
    },
  ];

  it("every operation dispatches successfully to a V2 draft", () => {
    for (const route of routes) {
      const draft = route.build();
      const result = applyDraftMutationV2(draft, route.mutation, draft.version);
      expect(result.schemaVersion, route.name).toBe("2");
      expect(result.version, route.name).toBe(draft.version + 1);
      expect(result.baseVersion, route.name).toBe(draft.baseVersion);
      expect(() => validateDraftV2(result), route.name).not.toThrow();
    }
  });
});

describe("unified V2 mutation contract — BLOCK G no-op propagation", () => {
  it("place_node no-op returns the exact original draft", () => {
    const draft = makeFieldDraft();
    const result = applyDraftMutationV2(
      draft,
      {
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "character_name" },
      },
      draft.version,
    );
    expect(result).toBe(draft);
    expect(result.version).toBe(draft.version);
    expect(result.baseVersion).toBe(draft.baseVersion);
  });

  it("set_value with the same value returns the exact original draft", () => {
    const draft = makeFieldDraft();
    const result = applyDraftMutationV2(
      draft,
      { op: "set_value", key: "A", value: "A" },
      draft.version,
    );
    expect(result).toBe(draft);
    expect(result.version).toBe(draft.version);
  });

  it("lock_field on an already-locked field returns the exact original draft", () => {
    const draft = makeLockedFieldDraft();
    const result = applyDraftMutationV2(
      draft,
      { op: "lock_field", key: "A" },
      draft.version,
    );
    expect(result).toBe(draft);
    expect(result.version).toBe(draft.version);
  });

  it("unlock_field on an already-unlocked field returns the exact original draft", () => {
    const draft = makeFieldDraft();
    const result = applyDraftMutationV2(
      draft,
      { op: "unlock_field", key: "A" },
      draft.version,
    );
    expect(result).toBe(draft);
    expect(result.version).toBe(draft.version);
  });

  it("rename_section with the same title returns the exact original draft", () => {
    const draft = makeSectionDraft();
    const result = applyDraftMutationV2(
      draft,
      { op: "rename_section", key: "X", title: "X" },
      draft.version,
    );
    expect(result).toBe(draft);
    expect(result.version).toBe(draft.version);
  });
});

describe("unified V2 mutation contract — BLOCK H version precedence", () => {
  it("stale place_node → version_conflict", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeFieldDraft(),
          {
            op: "place_node",
            key: "B",
            destination: { position: "before", targetKey: "A" },
          },
          0,
        ),
      ),
    ).toBe("version_conflict");
  });

  it("stale set_value → version_conflict", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeFieldDraft(),
          { op: "set_value", key: "A", value: "zap" },
          0,
        ),
      ),
    ).toBe("version_conflict");
  });

  it("stale add_field → version_conflict", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeFieldDraft(),
          {
            op: "add_field",
            field: { key: "C", label: "C", type: "number", locked: false },
          },
          0,
        ),
      ),
    ).toBe("version_conflict");
  });

  it("stale add_section → version_conflict", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeFieldDraft(),
          { op: "add_section", section: { key: "d", title: "D" } },
          0,
        ),
      ),
    ).toBe("version_conflict");
  });

  it("stale + locked set_value → version_conflict (not field_read_locked)", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeLockedFieldDraft(),
          { op: "set_value", key: "A", value: "zap" },
          0,
        ),
      ),
    ).toBe("version_conflict");
  });

  it("stale + duplicate add_field → version_conflict (not invalid_mutation)", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeFieldDraft(),
          {
            op: "add_field",
            field: { key: "A", label: "A", type: "number", locked: false },
          },
          0,
        ),
      ),
    ).toBe("version_conflict");
  });
});

describe("unified V2 mutation contract — BLOCK I confirmed guard", () => {
  it("place_node on a confirmed draft → draft_confirmed", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeConfirmedDraft(),
          {
            op: "place_node",
            key: "A",
            destination: { position: "after", targetKey: "character_name" },
          },
          1,
        ),
      ),
    ).toBe("draft_confirmed");
  });

  it("set_value on a confirmed draft → draft_confirmed", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeConfirmedDraft(),
          { op: "set_value", key: "A", value: "zap" },
          1,
        ),
      ),
    ).toBe("draft_confirmed");
  });

  it("add_field on a confirmed draft → draft_confirmed", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeConfirmedDraft(),
          {
            op: "add_field",
            field: { key: "C", label: "C", type: "number", locked: false },
          },
          1,
        ),
      ),
    ).toBe("draft_confirmed");
  });

  it("add_section on a confirmed draft → draft_confirmed", () => {
    expect(
      errorCodeOf(() =>
        applyDraftMutationV2(
          makeConfirmedDraft(),
          { op: "add_section", section: { key: "d", title: "D" } },
          1,
        ),
      ),
    ).toBe("draft_confirmed");
  });
});

describe("unified V2 mutation contract — BLOCK J version bump ownership", () => {
  it("real set_value bumps exactly once (never twice)", () => {
    const draft = makeFieldDraft(5, 3);
    const result = applyDraftMutationV2(
      draft,
      { op: "set_value", key: "A", value: "zap" },
      5,
    );
    expect(result.version).toBe(draft.version + 1);
    expect(result.version).not.toBe(draft.version + 2);
    expect(result.baseVersion).toBe(3);
  });

  it("real add_field bumps exactly once", () => {
    const draft = makeFieldDraft(5, 3);
    const result = applyDraftMutationV2(
      draft,
      {
        op: "add_field",
        field: { key: "C", label: "C", type: "number", locked: false },
      },
      5,
    );
    expect(result.version).toBe(draft.version + 1);
    expect(result.baseVersion).toBe(3);
  });

  it("real rename_section bumps exactly once", () => {
    const draft = makeSectionDraft(5, 3);
    const result = applyDraftMutationV2(
      draft,
      { op: "rename_section", key: "X", title: "Details" },
      5,
    );
    expect(result.version).toBe(draft.version + 1);
    expect(result.baseVersion).toBe(3);
  });

  it("real place_node bumps exactly once", () => {
    const draft = makeFieldDraft(5, 3);
    const result = applyDraftMutationV2(
      draft,
      {
        op: "place_node",
        key: "B",
        destination: { position: "before", targetKey: "A" },
      },
      5,
    );
    expect(result.version).toBe(draft.version + 1);
    expect(result.baseVersion).toBe(3);
  });
});

describe("unified V2 mutation contract — BLOCK K reference semantics", () => {
  it("real set_value preserves structure[] and sections[] references", () => {
    const draft = makeFieldDraft();
    const result = applyDraftMutationV2(
      draft,
      { op: "set_value", key: "A", value: "zap" },
      draft.version,
    );
    expect(result.structure).toBe(draft.structure);
    expect(result.sections).toBe(draft.sections);
  });

  it("real add_field preserves sections[] and values references", () => {
    const draft = makeFieldDraft();
    const result = applyDraftMutationV2(
      draft,
      {
        op: "add_field",
        field: { key: "C", label: "C", type: "number", locked: false },
      },
      draft.version,
    );
    expect(result.sections).toBe(draft.sections);
    expect(result.values).toBe(draft.values);
  });

  it("real rename_section preserves structure[], fields and values references", () => {
    const draft = makeSectionDraft();
    const result = applyDraftMutationV2(
      draft,
      { op: "rename_section", key: "X", title: "Details" },
      draft.version,
    );
    expect(result.structure).toBe(draft.structure);
    expect(result.fields).toBe(draft.fields);
    expect(result.values).toBe(draft.values);
  });

  it("place_node no-op returns the whole draft by reference", () => {
    const draft = makeFieldDraft();
    const result = applyDraftMutationV2(
      draft,
      {
        op: "place_node",
        key: "A",
        destination: { position: "after", targetKey: "character_name" },
      },
      draft.version,
    );
    expect(result).toBe(draft);
  });
});

describe("unified V2 mutation contract — BLOCK L parser input immutability", () => {
  it("does not mutate a valid content mutation input", () => {
    const input = { op: "set_value", key: "A", value: "hello" };
    const snapshot = JSON.stringify(input);
    parseDraftMutationV2(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not mutate a valid add_field input", () => {
    const input = {
      op: "add_field",
      field: { key: "C", label: "C", type: "number" },
    };
    const snapshot = JSON.stringify(input);
    parseDraftMutationV2(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not mutate a rejected input", () => {
    const input = { op: "move_field", key: "A" };
    const snapshot = JSON.stringify(input);
    try {
      parseDraftMutationV2(input);
    } catch {
      // expected
    }
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("unified V2 mutation contract — BLOCK M public API", () => {
  it("index exposes the unified V2 contract", () => {
    expect(typeof publicApi.parseDraftMutationV2).toBe("function");
    expect(typeof publicApi.applyDraftMutationV2).toBe("function");
    expect(DraftMutationV2Schema).toBe(publicApi.DraftMutationV2Schema);
    const typed: publicApi.DraftMutationV2 = {
      op: "set_value",
      key: "A",
      value: "x",
    };
    expect(typed.op).toBe("set_value");
  });

  it("index does not expose isolated internal primitives or family schemas", () => {
    const ns = publicApi as unknown as Record<string, unknown>;
    expect(
      ns["applyDraftContentMutationWithExpectedVersionV2"],
    ).toBeUndefined();
    expect(
      ns["applyDraftFieldRegistryMutationWithExpectedVersionV2"],
    ).toBeUndefined();
    expect(
      ns["applyDraftSectionRegistryMutationWithExpectedVersionV2"],
    ).toBeUndefined();
    expect(ns["DraftContentMutationV2Schema"]).toBeUndefined();
    expect(ns["DraftFieldRegistryMutationV2Schema"]).toBeUndefined();
    expect(ns["DraftSectionRegistryMutationV2Schema"]).toBeUndefined();
  });

  it("public end-to-end apply works", () => {
    const draft = makeFieldDraft();
    const result = publicApi.applyDraftMutationV2(
      draft,
      { op: "set_value", key: "A", value: "zap" },
      draft.version,
    );
    expect(result.values.A).toBe("zap");
    expect(result.version).toBe(draft.version + 1);
  });
});

function makeFieldDraft(version = 1, baseVersion = 1): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.unified",
    sessionId: "session.unified",
    baseVersion,
    version,
    mode: "pc" as const,
    characterName: "Test",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text" as const,
        locked: false,
      },
      { key: "A", label: "A", type: "text" as const, locked: false },
      { key: "B", label: "B", type: "text" as const, locked: false },
    ],
    sections: [],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "field" as const, key: "A", parentKey: null },
      { kind: "field" as const, key: "B", parentKey: null },
    ],
    values: { character_name: "Test", A: "A", B: "B" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeLockedFieldDraft(): CharacterSheetDraftV2 {
  const draft = makeFieldDraft();
  return {
    ...draft,
    fields: draft.fields.map((field) =>
      field.key === "A" ? { ...field, locked: true } : field,
    ),
  };
}

function makeSectionDraft(version = 1, baseVersion = 1): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.unified.sections",
    sessionId: "session.unified.sections",
    baseVersion,
    version,
    mode: "pc" as const,
    characterName: "Test",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text" as const,
        locked: false,
      },
      { key: "A", label: "A", type: "text" as const, locked: false },
      { key: "B", label: "B", type: "text" as const, locked: false },
    ],
    sections: [
      { key: "X", title: "X" },
      { key: "Y", title: "Y" },
    ],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "X", parentKey: null },
      { kind: "section" as const, key: "Y", parentKey: null },
      { kind: "field" as const, key: "A", parentKey: null },
      { kind: "field" as const, key: "B", parentKey: null },
    ],
    values: { character_name: "Test", A: "A", B: "B" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeConfirmedDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2" as const,
    draftId: "draft.unified.confirmed",
    sessionId: "session.unified.confirmed",
    baseVersion: 1,
    version: 1,
    mode: "pc" as const,
    characterName: "Test",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text" as const,
        locked: false,
      },
      { key: "A", label: "A", type: "text" as const, locked: false },
    ],
    sections: [],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "field" as const, key: "A", parentKey: null },
    ],
    values: { character_name: "Test", A: "A" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  };
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DraftError).code;
  }
  return "none";
}
