import { describe, expect, it } from "vitest";
import {
  applyDraftMutationV2,
  DraftError,
  finalizeDraftV2,
  initialDraftVersionV2,
  parseCanonicalCharacterSheetDraft,
  parseDraftMutationV2,
  rerollLockedDraftValuesV2,
  SheetDraftConfirmRequestV2Schema,
  SheetDraftCreateRequestV2Schema,
  SheetDraftMutationRequestV2Schema,
  SheetDraftRerollRequestV2Schema,
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
  type CharacterSheetDraftV2,
  type SheetDraftConfirmRequestV2,
  type SheetDraftCreateRequestV2,
  type SheetDraftMutationRequestV2,
  type SheetDraftRerollRequestV2,
  type SheetDraftRerollResponseV2,
  type SheetDraftSnapshotResponseV2,
} from "./index";

/**
 * 4D3 PUBLIC TRANSPORT BOUNDARY SUITE.
 *
 * This file deliberately imports EVERY V2 transport and V2 domain API from the
 * package root (`./index`) and never deep-imports `draft-transport-v2`,
 * `draft-mutation-v2`, `draft-reroll-v2`, `draft-finalize-v2` or
 * `draft-canonical`. That restriction is the point: it proves the reviewed
 * package root alone is sufficient for the 4E runtime cutover.
 *
 * It is an INTEGRATION suite. It re-proves the public composition the 4E
 * Worker/Web layers will perform — envelope parse, domain call, response
 * validation — rather than repeating the 47 transport-shape assertions of 4D1,
 * which stay in `draft-transport-v2.test.ts`.
 *
 * It deliberately simulates NOTHING about persistence. There is no D1 head, no
 * R2 snapshot, no claim, no commit and no HTTP status here. The frozen Worker
 * policy for those (the `expectedVersion === head.currentVersion` precondition,
 * the mandatory D1 claim barrier, and the semantic no-op bypass) is specified in
 * `docs/architecture/phase-14.7/character-sheet-v2-transport-contract.md`.
 */

/** A canonical editable V2 draft, built through the public creation boundary. */
function makePublicV2Draft(overrides: Partial<CharacterSheetDraftV2> = {}) {
  return initialDraftVersionV2({
    schemaVersion: "2",
    draftId: "draft.public",
    sessionId: "session.public",
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
  });
}

/**
 * A valid historical V1 draft. It is legitimate STORED data that V2 must keep
 * reading, and it must never be accepted directly as a transport response.
 *
 * Note that V1 Sections carry an explicit `fieldKeys` array, which V2 replaces
 * with the canonical `structure[]` preorder. The migration derives that
 * structure from the V1 ownership, so this fixture also proves the historical
 * read path is a real migration rather than a schemaVersion relabel.
 */
function makeHistoricalV1Draft() {
  return {
    schemaVersion: "1",
    draftId: "draft.public",
    sessionId: "session.public",
    baseVersion: 1,
    version: 3,
    mode: "pc" as const,
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      { key: "strength", label: "Strength", type: "number", locked: true },
    ],
    sections: [
      { key: "attributes", title: "Attributes", fieldKeys: ["strength"] },
    ],
    values: { character_name: "Aria", strength: 12 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

describe("4D3 public boundary — transport values and types", () => {
  it("1. all six V2 transport schemas are available from the package root", () => {
    for (const schema of [
      SheetDraftCreateRequestV2Schema,
      SheetDraftSnapshotResponseV2Schema,
      SheetDraftMutationRequestV2Schema,
      SheetDraftRerollRequestV2Schema,
      SheetDraftRerollResponseV2Schema,
      SheetDraftConfirmRequestV2Schema,
    ]) {
      expect(typeof schema.safeParse).toBe("function");
    }
  });

  it("2. all six V2 transport types are usable without `any`", () => {
    const draft = makePublicV2Draft();
    const create: SheetDraftCreateRequestV2 = draft;
    const snapshot: SheetDraftSnapshotResponseV2 = create;
    const mutation: SheetDraftMutationRequestV2 = {
      expectedVersion: 1,
      mutation: { op: "set_value", key: "character_name", value: "Aria Stone" },
    };
    const reroll: SheetDraftRerollRequestV2 = {
      expectedVersion: 1,
      seed: "seed-public",
    };
    const rerollResponse: SheetDraftRerollResponseV2 = {
      draft: snapshot,
      rerolledKeys: ["strength"],
    };
    const confirm: SheetDraftConfirmRequestV2 = { expectedVersion: 1 };

    expect(create.version).toBe(1);
    expect(mutation.expectedVersion).toBe(1);
    expect(reroll.seed).toBe("seed-public");
    expect(rerollResponse.rerolledKeys).toEqual(["strength"]);
    expect(confirm.expectedVersion).toBe(1);
    expect(snapshot.schemaVersion).toBe("2");
  });
});

describe("4D3 public boundary — create contract", () => {
  it("3. the public create schema accepts a canonical V2 snapshot", () => {
    const draft = makePublicV2Draft();
    const parsed = SheetDraftCreateRequestV2Schema.safeParse(draft);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(draft);
  });

  it("4. the public create schema composes with the V2 creation lifecycle", () => {
    // The public create request IS the canonical V2 snapshot, so it composes
    // with `initialDraftVersionV2` without any transport-owned conversion.
    const initial = initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.created",
      sessionId: "session.public",
      mode: "pc",
      characterName: null,
      rulesContextId: null,
      fields: [
        { key: "character_name", label: "Name", type: "text", locked: false },
      ],
      sections: [],
      structure: [{ kind: "field", key: "character_name", parentKey: null }],
      values: {},
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
    });

    const request: SheetDraftCreateRequestV2 = initial;
    const response = SheetDraftSnapshotResponseV2Schema.parse(request);

    expect(response.baseVersion).toBe(1);
    expect(response.version).toBe(1);
    // The Worker create policy "version === 1" is NOT a transport-schema
    // concern, so it is asserted here as lifecycle behavior, not as schema
    // behavior.
    expect(response.version).toBe(1);
  });

  it("5. the public create schema rejects a direct V1 snapshot", () => {
    expect(
      SheetDraftCreateRequestV2Schema.safeParse(makeHistoricalV1Draft())
        .success,
    ).toBe(false);
  });
});

describe("4D3 public boundary — mutation composition", () => {
  it("6. envelope parse, mutation parse, apply and snapshot-response parse compose", () => {
    const draft = makePublicV2Draft();
    const version = draft.version;

    const envelope = SheetDraftMutationRequestV2Schema.parse({
      expectedVersion: version,
      mutation: { op: "set_value", key: "character_name", value: "Aria Stone" },
    });
    const mutation = parseDraftMutationV2(envelope.mutation);
    const result = applyDraftMutationV2(
      draft,
      mutation,
      envelope.expectedVersion,
    );
    const response: SheetDraftSnapshotResponseV2 =
      SheetDraftSnapshotResponseV2Schema.parse(result);

    expect(response.schemaVersion).toBe("2");
    expect(response.values.character_name).toBe("Aria Stone");
  });

  it("7. expectedVersion stays outside DraftMutationV2", () => {
    const envelope = SheetDraftMutationRequestV2Schema.parse({
      expectedVersion: 1,
      mutation: { op: "set_value", key: "character_name", value: "Aria Stone" },
    });

    expect("expectedVersion" in envelope.mutation).toBe(false);
    // A precondition smuggled INSIDE the mutation is rejected by the strict
    // mutation union.
    expect(
      SheetDraftMutationRequestV2Schema.safeParse({
        expectedVersion: 1,
        mutation: {
          op: "set_value",
          key: "strength",
          value: "Aria Stone",
          expectedVersion: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("8. a real mutation increments the version exactly once and preserves baseVersion", () => {
    const draft = makePublicV2Draft();
    const baseVersion = draft.baseVersion;
    const version = draft.version;

    const mutation = parseDraftMutationV2({
      op: "set_value",
      key: "character_name",
      value: "Aria Stone",
    });
    const result = applyDraftMutationV2(draft, mutation, version);

    expect(result.version).toBe(version + 1);
    expect(result.baseVersion).toBe(baseVersion);
  });

  it("9. a semantic no-op returns the exact input reference at the same version", () => {
    const draft = makePublicV2Draft();
    // `character_name` already holds "Aria", so this set_value is a semantic no-op.
    const mutation = parseDraftMutationV2({
      op: "set_value",
      key: "character_name",
      value: "Aria",
    });
    const result = applyDraftMutationV2(draft, mutation, draft.version);

    // EXACT reference: the domain no-op creates no version at all. The frozen
    // Worker policy (return this snapshot with no D1 claim and no R2 write) is
    // specified in the transport contract document; nothing is simulated here.
    expect(result).toBe(draft);
    expect(result.version).toBe(draft.version);
  });

  it("10. a stale expectedVersion produces DraftError version_conflict", () => {
    const draft = makePublicV2Draft();
    const envelope = SheetDraftMutationRequestV2Schema.parse({
      expectedVersion: draft.version + 1,
      mutation: { op: "set_value", key: "character_name", value: "Aria Stone" },
    });
    const mutation = parseDraftMutationV2(envelope.mutation);

    // Both envelope parse and mutation parse SUCCEED: staleness is a
    // concurrency outcome, not a malformed request. The domain half of the
    // frozen Worker mapping is what raises it.
    let thrown: unknown;
    try {
      applyDraftMutationV2(draft, mutation, envelope.expectedVersion);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DraftError);
    if (thrown instanceof DraftError) {
      expect(thrown.code).toBe("version_conflict");
    }
  });

  it("17. a mutation envelope with an extra top-level key is rejected", () => {
    expect(
      SheetDraftMutationRequestV2Schema.safeParse({
        expectedVersion: 1,
        mutation: {
          op: "set_value",
          key: "character_name",
          value: "Aria Stone",
        },
        debug: true,
      }).success,
    ).toBe(false);
  });
});

describe("4D3 public boundary — reroll composition", () => {
  it("11. the reroll envelope composes with the domain reroll and the response schema", () => {
    const draft = makePublicV2Draft();
    const version = draft.version;

    const request: SheetDraftRerollRequestV2 =
      SheetDraftRerollRequestV2Schema.parse({
        expectedVersion: version,
        seed: "seed-public",
      });
    // The precondition is compared by the Worker against D1 head.currentVersion;
    // the test proves only that the client-supplied value matches the draft it
    // is acting on, because no D1 head exists in this suite.
    expect(request.expectedVersion).toBe(version);

    // `expectedVersion` is deliberately NOT a domain reroll parameter.
    const result = rerollLockedDraftValuesV2(draft, request.seed);

    const response: SheetDraftRerollResponseV2 =
      SheetDraftRerollResponseV2Schema.parse({
        draft: result.draft,
        rerolledKeys: result.rerolledKeys,
      });

    expect(response.draft.schemaVersion).toBe("2");
  });

  it("12. an accepted reroll increments the version exactly once", () => {
    const draft = makePublicV2Draft();
    const result = rerollLockedDraftValuesV2(draft, "seed-public");

    expect(result.draft.version).toBe(draft.version + 1);
    expect(result.draft.baseVersion).toBe(draft.baseVersion);
    // `strength` is locked but has no draw grammar (number without min/max), and
    // `character_name` is an unlocked text field, so NO Field is drawable here.
    // This is the "zero eligible Fields still creates N+1" case.
    expect(result.rerolledKeys).toEqual([]);
  });

  it("18. a reroll envelope missing expectedVersion is rejected", () => {
    expect(
      SheetDraftRerollRequestV2Schema.safeParse({ seed: "seed-public" })
        .success,
    ).toBe(false);
  });
});

describe("4D3 public boundary — confirm composition", () => {
  it("13. the confirm envelope composes with finalize and the raw snapshot schema", () => {
    const draft = makePublicV2Draft();
    const version = draft.version;

    const request: SheetDraftConfirmRequestV2 =
      SheetDraftConfirmRequestV2Schema.parse({ expectedVersion: version });
    expect(request.expectedVersion).toBe(version);

    const confirmed = finalizeDraftV2(draft);

    // The confirm response is the RAW snapshot: validated directly with the
    // snapshot schema, never with a `{ draft: ... }` wrapper.
    const response: SheetDraftSnapshotResponseV2 =
      SheetDraftSnapshotResponseV2Schema.parse(confirmed);

    expect(response.confirmed).toBe(true);
    expect(response.version).toBe(version + 1);
  });

  it("14. the confirmed result is a raw snapshot, not a wrapper", () => {
    const draft = makePublicV2Draft();
    const confirmed = finalizeDraftV2(draft);

    expect("draft" in confirmed).toBe(false);
    expect(confirmed.schemaVersion).toBe("2");
    expect(confirmed.confirmed).toBe(true);
    // A `{ draft: ... }` envelope would fail the strict snapshot schema.
    expect(
      SheetDraftSnapshotResponseV2Schema.safeParse({ draft: confirmed })
        .success,
    ).toBe(false);
  });

  it("16. the snapshot response schema accepts a confirmed snapshot", () => {
    const confirmed = finalizeDraftV2(makePublicV2Draft());
    const response = SheetDraftSnapshotResponseV2Schema.safeParse(confirmed);

    // Transport response validity is independent of editability.
    expect(response.success).toBe(true);
    expect(response.success && response.data.confirmed).toBe(true);
  });

  it("19. an empty confirm object is rejected", () => {
    expect(SheetDraftConfirmRequestV2Schema.safeParse({}).success).toBe(false);
  });
});

describe("4D3 public boundary — historical V1 response policy", () => {
  it("15. a historical V1 snapshot canonicalizes and then satisfies the response schema", () => {
    const historical = makeHistoricalV1Draft();
    const canonical = parseCanonicalCharacterSheetDraft(historical);

    const response = SheetDraftSnapshotResponseV2Schema.safeParse(canonical);

    expect(canonical.schemaVersion).toBe("2");
    expect(response.success).toBe(true);
  });

  it("15b. canonicalization preserves the stored version, so history is continuous", () => {
    const historical = makeHistoricalV1Draft();
    const canonical = parseCanonicalCharacterSheetDraft(historical);

    // Reading historical V1 must not renumber the snapshot: the next
    // state-changing write is what moves it to V2 at N+1.
    expect(canonical.version).toBe(historical.version);
    expect(canonical.baseVersion).toBe(historical.baseVersion);
  });

  it("16b. a raw historical V1 snapshot is rejected by the response schema", () => {
    expect(
      SheetDraftSnapshotResponseV2Schema.safeParse(makeHistoricalV1Draft())
        .success,
    ).toBe(false);
  });
});

/**
 * Compile-time public/private surface checks.
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

type CreateSchemaIsPublic = ExpectTrue<
  IsPublic<"SheetDraftCreateRequestV2Schema">
>;
type SnapshotSchemaIsPublic = ExpectTrue<
  IsPublic<"SheetDraftSnapshotResponseV2Schema">
>;
type MutationSchemaIsPublic = ExpectTrue<
  IsPublic<"SheetDraftMutationRequestV2Schema">
>;
type RerollRequestSchemaIsPublic = ExpectTrue<
  IsPublic<"SheetDraftRerollRequestV2Schema">
>;
type RerollResponseSchemaIsPublic = ExpectTrue<
  IsPublic<"SheetDraftRerollResponseV2Schema">
>;
type ConfirmSchemaIsPublic = ExpectTrue<
  IsPublic<"SheetDraftConfirmRequestV2Schema">
>;

type ExpectedVersionIsPrivate = ExpectFalse<
  IsPublic<"DraftExpectedVersionSchema">
>;
type RerolledKeyIsPrivate = ExpectFalse<IsPublic<"RerolledDraftKeySchema">>;

// Previously-reviewed 4A/4B/4C privacy decisions must survive 4D3 unchanged.
type BumpIsPrivate = ExpectFalse<IsPublic<"bumpDraftVersionV2">>;
type ContentPrimitiveIsPrivate = ExpectFalse<
  IsPublic<"applyDraftContentMutationWithExpectedVersionV2">
>;
type FieldRegistryPrimitiveIsPrivate = ExpectFalse<
  IsPublic<"applyDraftFieldRegistryMutationWithExpectedVersionV2">
>;
type SectionRegistryPrimitiveIsPrivate = ExpectFalse<
  IsPublic<"applyDraftSectionRegistryMutationWithExpectedVersionV2">
>;
type StructuralIndexIsPrivate = ExpectFalse<
  IsPublic<"buildDraftStructuralIndex">
>;

describe("4D3 public boundary — compile-time public surface", () => {
  it("20. the six transport schemas ARE public", () => {
    const createIsPublic: CreateSchemaIsPublic = true;
    const snapshotIsPublic: SnapshotSchemaIsPublic = true;
    const mutationIsPublic: MutationSchemaIsPublic = true;
    const rerollRequestIsPublic: RerollRequestSchemaIsPublic = true;
    const rerollResponseIsPublic: RerollResponseSchemaIsPublic = true;
    const confirmIsPublic: ConfirmSchemaIsPublic = true;

    expect(createIsPublic).toBe(true);
    expect(snapshotIsPublic).toBe(true);
    expect(mutationIsPublic).toBe(true);
    expect(rerollRequestIsPublic).toBe(true);
    expect(rerollResponseIsPublic).toBe(true);
    expect(confirmIsPublic).toBe(true);
  });

  it("3b. the two private transport helpers are NOT public", () => {
    const isPublic: ExpectedVersionIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("3c. RerolledDraftKeySchema is NOT public", () => {
    const isPublic: RerolledKeyIsPrivate = false;
    expect(isPublic).toBe(false);
  });

  it("20b. the 4A/4B/4C private decisions are preserved", () => {
    const bump: BumpIsPrivate = false;
    const content: ContentPrimitiveIsPrivate = false;
    const fieldRegistry: FieldRegistryPrimitiveIsPrivate = false;
    const sectionRegistry: SectionRegistryPrimitiveIsPrivate = false;
    const structuralIndex: StructuralIndexIsPrivate = false;

    expect(bump).toBe(false);
    expect(content).toBe(false);
    expect(fieldRegistry).toBe(false);
    expect(sectionRegistry).toBe(false);
    expect(structuralIndex).toBe(false);
  });
});
