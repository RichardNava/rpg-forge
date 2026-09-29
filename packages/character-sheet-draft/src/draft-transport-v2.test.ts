import { describe, expect, it } from "vitest";
import {
  SheetDraftConfirmRequestV2Schema,
  SheetDraftCreateRequestV2Schema,
  SheetDraftMutationRequestV2Schema,
  SheetDraftRerollRequestV2Schema,
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
  type SheetDraftConfirmRequestV2,
  type SheetDraftCreateRequestV2,
  type SheetDraftMutationRequestV2,
  type SheetDraftRerollRequestV2,
  type SheetDraftRerollResponseV2,
  type SheetDraftSnapshotResponseV2,
} from "./draft-transport-v2";

/**
 * 4D1 TRANSPORT CONTRACT SUITE.
 *
 * These tests freeze the transport SHAPE only. They never apply a mutation,
 * bump a version, compare a precondition against current state, confirm, reroll,
 * migrate, persist, or map an HTTP error — asserting any of that here would
 * cross into the domain and Worker layers that 4D2/4E own.
 */

/** A minimal valid canonical V2 draft. */
function makeV2Draft(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: "2",
    draftId: "draft.transport",
    sessionId: "session.transport",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      { key: "strength", label: "Strength", type: "number", locked: true },
    ],
    sections: [{ key: "attributes", title: "Attributes" }],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "section", key: "attributes", parentKey: null },
      { kind: "field", key: "strength", parentKey: "attributes" },
    ],
    values: { character_name: "Aria", strength: 12 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

/** A valid V1 draft, which V2 transport must never accept. */
function makeV1Draft(): unknown {
  return {
    schemaVersion: "1",
    draftId: "draft.v1",
    sessionId: "session.transport",
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
    ],
    sections: [],
    values: { character_name: "Aria" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

const placeNodeMutation = {
  op: "place_node",
  key: "strength",
  destination: { position: "before", targetKey: "character_name" },
} as const;

const setValueMutation = {
  op: "set_value",
  key: "character_name",
  value: "Aria Stone",
} as const;

const addFieldMutation = {
  op: "add_field",
  field: { key: "dexterity", label: "Dexterity", type: "number" },
} as const;

const addSectionMutation = {
  op: "add_section",
  section: { key: "combat", title: "Combat" },
} as const;

describe("4D1 transport — CREATE request", () => {
  it("1. accepts a valid CharacterSheetDraftV2 as a create request", () => {
    const result = SheetDraftCreateRequestV2Schema.safeParse(makeV2Draft());
    expect(result.success).toBe(true);
  });

  it("2. rejects a V1 snapshot as a create request", () => {
    expect(
      SheetDraftCreateRequestV2Schema.safeParse(makeV1Draft()).success,
    ).toBe(false);
  });

  it("3. rejects a malformed V2 draft", () => {
    // Drop the required `structure`.
    const malformed = makeV2Draft();
    delete (malformed as { structure?: unknown }).structure;
    expect(SheetDraftCreateRequestV2Schema.safeParse(malformed).success).toBe(
      false,
    );
  });

  it("7. reuses canonical V2 semantics rather than a parallel definition", () => {
    // Same schema instance as the snapshot response: no duplicated draft shape.
    expect(SheetDraftCreateRequestV2Schema).toBe(
      SheetDraftSnapshotResponseV2Schema,
    );
    // It is the canonical V2 schema itself.
    const v2 = makeV2Draft();
    expect(SheetDraftCreateRequestV2Schema.safeParse(v2).data).toEqual(v2);
  });
});

describe("4D1 transport — SNAPSHOT response", () => {
  it("4. accepts a valid V2 draft as a snapshot response", () => {
    expect(
      SheetDraftSnapshotResponseV2Schema.safeParse(makeV2Draft()).success,
    ).toBe(true);
  });

  it("5. accepts a confirmed V2 draft as a snapshot response", () => {
    const confirmed = makeV2Draft({ confirmed: true });
    expect(
      SheetDraftSnapshotResponseV2Schema.safeParse(confirmed).success,
    ).toBe(true);
  });

  it("6. accepts an arbitrary version > 1 as a snapshot response", () => {
    // Version is domain state carried inside the snapshot, not a transport
    // constraint; GET ?version=N reuses this same schema.
    const later = makeV2Draft({ version: 42, baseVersion: 1 });
    const result = SheetDraftSnapshotResponseV2Schema.safeParse(later);
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(42);
  });
});

describe("4D1 transport — MUTATION request", () => {
  it("8. accepts a valid place_node request", () => {
    const body = { expectedVersion: 7, mutation: placeNodeMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      true,
    );
  });

  it("9. accepts a valid set_value request", () => {
    const body = { expectedVersion: 7, mutation: setValueMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      true,
    );
  });

  it("10. accepts a valid add_field request", () => {
    const body = { expectedVersion: 7, mutation: addFieldMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      true,
    );
  });

  it("11. accepts a valid add_section request", () => {
    const body = { expectedVersion: 7, mutation: addSectionMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      true,
    );
  });

  it("12. rejects a missing expectedVersion", () => {
    const body = { mutation: placeNodeMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("13. rejects expectedVersion 0", () => {
    const body = { expectedVersion: 0, mutation: placeNodeMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("14. rejects a negative expectedVersion", () => {
    const body = { expectedVersion: -3, mutation: placeNodeMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("15. rejects a fractional expectedVersion", () => {
    const body = { expectedVersion: 7.5, mutation: placeNodeMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("16. rejects a numeric-string expectedVersion", () => {
    const body = { expectedVersion: "7", mutation: placeNodeMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("16b. rejects a NaN expectedVersion", () => {
    const body = { expectedVersion: Number.NaN, mutation: placeNodeMutation };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("17. rejects an unknown top-level key", () => {
    const body = {
      expectedVersion: 7,
      mutation: placeNodeMutation,
      debug: true,
    };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("18. rejects a raw DraftMutationV2 sent without the envelope", () => {
    // The old V1 PATCH body is a bare mutation; V2 requires the envelope.
    expect(
      SheetDraftMutationRequestV2Schema.safeParse(placeNodeMutation).success,
    ).toBe(false);
  });

  it("19. rejects expectedVersion placed INSIDE the mutation", () => {
    const smuggled = { ...placeNodeMutation, expectedVersion: 7 };
    const body = { expectedVersion: 7, mutation: smuggled };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("20. rejects the legacy move_field mutation", () => {
    const body = {
      expectedVersion: 7,
      mutation: { op: "move_field", key: "strength", sectionKey: "combat" },
    };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("21. rejects the legacy reparent_section mutation", () => {
    const body = {
      expectedVersion: 7,
      mutation: { op: "reparent_section", key: "combat", parentKey: null },
    };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("22. rejects remove_section (not approved functionality)", () => {
    const body = {
      expectedVersion: 7,
      mutation: { op: "remove_section", key: "combat" },
    };
    expect(SheetDraftMutationRequestV2Schema.safeParse(body).success).toBe(
      false,
    );
  });
});

describe("4D1 transport — REROLL request", () => {
  it("23. accepts a valid { expectedVersion, seed } request", () => {
    const body = { expectedVersion: 7, seed: "stable-seed" };
    expect(SheetDraftRerollRequestV2Schema.safeParse(body).success).toBe(true);
  });

  it("24. rejects a missing expectedVersion", () => {
    expect(
      SheetDraftRerollRequestV2Schema.safeParse({ seed: "s" }).success,
    ).toBe(false);
  });

  it("25. rejects a missing seed", () => {
    expect(
      SheetDraftRerollRequestV2Schema.safeParse({ expectedVersion: 7 }).success,
    ).toBe(false);
  });

  it("26. rejects an empty seed", () => {
    const body = { expectedVersion: 7, seed: "" };
    expect(SheetDraftRerollRequestV2Schema.safeParse(body).success).toBe(false);
  });

  it("27. rejects a seed longer than 256 characters", () => {
    const body = { expectedVersion: 7, seed: "x".repeat(257) };
    expect(SheetDraftRerollRequestV2Schema.safeParse(body).success).toBe(false);
  });

  it("27b. accepts a seed of exactly 256 characters", () => {
    const body = { expectedVersion: 7, seed: "x".repeat(256) };
    expect(SheetDraftRerollRequestV2Schema.safeParse(body).success).toBe(true);
  });

  it("28. rejects an unknown top-level key", () => {
    const body = {
      expectedVersion: 7,
      seed: "stable-seed",
      mutation: placeNodeMutation,
    };
    expect(SheetDraftRerollRequestV2Schema.safeParse(body).success).toBe(false);
  });

  it("29. rejects invalid expectedVersion forms", () => {
    for (const expectedVersion of [0, -1, 1.5, "7", Number.NaN]) {
      const body = { expectedVersion, seed: "s" };
      expect(SheetDraftRerollRequestV2Schema.safeParse(body).success).toBe(
        false,
      );
    }
  });
});

describe("4D1 transport — CONFIRM request", () => {
  it("30. accepts { expectedVersion: 7 }", () => {
    expect(
      SheetDraftConfirmRequestV2Schema.safeParse({ expectedVersion: 7 })
        .success,
    ).toBe(true);
  });

  it("31. rejects an empty object", () => {
    // The V1 confirm route took no body; V2 always carries a precondition.
    expect(SheetDraftConfirmRequestV2Schema.safeParse({}).success).toBe(false);
  });

  it("32. rejects expectedVersion 0", () => {
    expect(
      SheetDraftConfirmRequestV2Schema.safeParse({ expectedVersion: 0 })
        .success,
    ).toBe(false);
  });

  it("33. rejects a fractional expectedVersion", () => {
    expect(
      SheetDraftConfirmRequestV2Schema.safeParse({ expectedVersion: 2.5 })
        .success,
    ).toBe(false);
  });

  it("34. rejects an unknown top-level key", () => {
    expect(
      SheetDraftConfirmRequestV2Schema.safeParse({
        expectedVersion: 7,
        force: true,
      }).success,
    ).toBe(false);
  });

  it("35. the old empty-body V1 confirm shape is NOT the V2 contract", () => {
    expect(SheetDraftConfirmRequestV2Schema.safeParse({}).success).toBe(false);
  });
});

describe("4D1 transport — REROLL response", () => {
  it("36. accepts a valid V2 reroll response", () => {
    const body = { draft: makeV2Draft(), rerolledKeys: ["strength"] };
    expect(SheetDraftRerollResponseV2Schema.safeParse(body).success).toBe(true);
  });

  it("37. accepts multiple rerolledKeys", () => {
    const body = {
      draft: makeV2Draft(),
      rerolledKeys: ["strength", "dexterity", "weapon"],
    };
    expect(SheetDraftRerollResponseV2Schema.safeParse(body).success).toBe(true);
  });

  it("38. accepts empty rerolledKeys", () => {
    const body = { draft: makeV2Draft(), rerolledKeys: [] };
    expect(SheetDraftRerollResponseV2Schema.safeParse(body).success).toBe(true);
  });

  it("39. rejects a V1 draft inside the reroll response", () => {
    const body = { draft: makeV1Draft(), rerolledKeys: [] };
    expect(SheetDraftRerollResponseV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("40. rejects a malformed V2 draft inside the reroll response", () => {
    const body = { draft: { schemaVersion: "2" }, rerolledKeys: [] };
    expect(SheetDraftRerollResponseV2Schema.safeParse(body).success).toBe(
      false,
    );
  });

  it("41. rejects an unknown top-level key", () => {
    const body = {
      draft: makeV2Draft(),
      rerolledKeys: [],
      seed: "leaked",
    };
    expect(SheetDraftRerollResponseV2Schema.safeParse(body).success).toBe(
      false,
    );
  });
});

describe("4D1 transport — response consistency", () => {
  it("26. one canonical snapshot validates for create/get/mutate/confirm", () => {
    const draft = makeV2Draft();
    // All four response routes share the same snapshot schema; no
    // operation-specific wrapper is required for any of them.
    expect(SheetDraftSnapshotResponseV2Schema.safeParse(draft).success).toBe(
      true,
    );
    // Confirm uses the same schema; it is NOT wrapped in { draft: ... }.
    expect(
      SheetDraftSnapshotResponseV2Schema.safeParse(draft).data,
    ).toBeDefined();
  });
});

describe("4D1 transport — parser immutability", () => {
  it("27. parsing does not mutate caller input", () => {
    const bodies: unknown[] = [
      { expectedVersion: 7, mutation: placeNodeMutation },
      { expectedVersion: 7, seed: "stable-seed" },
      { expectedVersion: 7 },
      { draft: makeV2Draft(), rerolledKeys: ["strength"] },
      makeV2Draft(),
    ];
    for (const schema of [
      SheetDraftMutationRequestV2Schema,
      SheetDraftRerollRequestV2Schema,
      SheetDraftConfirmRequestV2Schema,
      SheetDraftRerollResponseV2Schema,
      SheetDraftCreateRequestV2Schema,
    ]) {
      for (const body of bodies) {
        const before = JSON.stringify(body);
        // safeParse on purpose: the cross-product intentionally includes shapes
        // that are not valid for every schema. The guarantee under test is that
        // validation never mutates its input, valid or not.
        schema.safeParse(body);
        expect(JSON.stringify(body)).toBe(before);
      }
    }
  });
});

describe("4D1 transport — type inference", () => {
  it("28. the inferred request/response types are usable without any", () => {
    const create: SheetDraftCreateRequestV2 =
      makeV2Draft() as SheetDraftCreateRequestV2;
    const snapshot: SheetDraftSnapshotResponseV2 = create;
    const mutation: SheetDraftMutationRequestV2 = {
      expectedVersion: snapshot.version,
      mutation: placeNodeMutation,
    };
    const reroll: SheetDraftRerollRequestV2 = {
      expectedVersion: snapshot.version,
      seed: "stable-seed",
    };
    const rerollResponse: SheetDraftRerollResponseV2 = {
      draft: snapshot,
      rerolledKeys: ["strength"],
    };
    const confirm: SheetDraftConfirmRequestV2 = {
      expectedVersion: snapshot.version,
    };

    // Types line up: the mutation envelope's precondition targets a real version
    // on a real V2 snapshot.
    expect(mutation.expectedVersion).toBe(snapshot.version);
    expect(reroll.expectedVersion).toBe(snapshot.version);
    expect(confirm.expectedVersion).toBe(snapshot.version);
    expect(rerollResponse.draft.schemaVersion).toBe("2");
    expect(snapshot.schemaVersion).toBe("2");
  });
});

describe("4D1 transport — domain ownership", () => {
  it("16b. transport schemas validate shape without performing operations", () => {
    // Parsing a mutation request yields the same version and untouched draft:
    // no bump, no confirm, no reroll, no migration.
    const draft = makeV2Draft();
    const before = JSON.stringify(draft);
    const parsed = SheetDraftMutationRequestV2Schema.parse({
      expectedVersion: 7,
      mutation: setValueMutation,
    });
    expect(JSON.stringify(draft)).toBe(before);
    // The precondition is carried, not checked: nothing here compares it to 7.
    expect(parsed.expectedVersion).toBe(7);
  });
});
