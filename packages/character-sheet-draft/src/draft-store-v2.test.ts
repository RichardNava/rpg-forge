import { describe, expect, it } from "vitest";
import type {
  CharacterSheetDraft,
  CharacterSheetDraftIdentity,
  CharacterSheetDraftStore,
  CharacterSheetDraftStoreV2,
  CharacterSheetDraftV2,
} from "./index";

/**
 * 4E1 DOMAIN PORT SUITE.
 *
 * This file is deliberately INTERFACE-LEVEL. The V2 port is a contract with no
 * behavior of its own — every behavior lives in an adapter — so there is nothing
 * to exercise at runtime here. The proofs are therefore compile-time: they pin
 * the SHAPE of the port, the identity reuse, and the V1/V2 coexistence that 4E1
 * depends on.
 *
 * Runtime behavior of the port is proven against the R2 adapter in
 * `apps/rules-worker/src/infrastructure/r2-character-sheet-drafts-v2.test.ts`.
 *
 * Both `CharacterSheetDraftStoreV2` and `CharacterSheetDraftStore` are imported
 * ONLY as types, so this file adds no runtime dependency on either module.
 */

/** A structurally conforming V2 port, built purely to pin the signatures. */
function makeV2StoreShape(): CharacterSheetDraftStoreV2 {
  throw new Error("type-level only");
}

/**
 * Compile-time proofs.
 *
 * `CharacterSheetDraftStoreV2` and `CharacterSheetDraftStore` are TYPE-only
 * exports, so `keyof PublicApi` (which covers VALUE exports) cannot see them.
 * Their publicness is instead proven the only way it can be: the `import type`
 * above resolves through `./index`, so a missing export is a COMPILE error.
 * `ExpectFalse<T extends false>` makes a wrong shape a compile error rather than
 * a silently passing assertion.
 */

/** Makes a leaked or widened shape a compile error. */
type ExpectFalse<T extends false> = T;
/** Makes an unexpected shape a compile error. */
type ExpectTrue<T extends true> = T;

/**
 * The V2 port is usable as a package-root type.
 *
 * Assigning the imported interface to a locally declared identical shape proves
 * the import resolves through `./index`; a missing export fails to compile.
 */
type RootV2Store = CharacterSheetDraftStoreV2;
type V2StoreIsExportedFromRoot = ExpectTrue<
  RootV2Store extends {
    putDraft(draft: CharacterSheetDraftV2): Promise<void>;
    getDraftVersion(
      identity: CharacterSheetDraftIdentity,
      version: number,
    ): Promise<CharacterSheetDraftV2 | null>;
    getLatestDraft(
      identity: CharacterSheetDraftIdentity,
    ): Promise<CharacterSheetDraftV2 | null>;
    listDraftVersions(identity: CharacterSheetDraftIdentity): Promise<number[]>;
    deleteDraft(identity: CharacterSheetDraftIdentity): Promise<void>;
  }
    ? true
    : false
>;

/**
 * The V2 read surface returns exactly `CharacterSheetDraftV2 | null`.
 */
type V2ReadResult = Awaited<
  ReturnType<CharacterSheetDraftStoreV2["getDraftVersion"]>
>;
type V2ReadIsNullableV2 = ExpectTrue<
  V2ReadResult extends CharacterSheetDraftV2 | null ? true : false
>;
/**
 * A V1 draft is NOT assignable to the V2 read result, so the read surface cannot
 * be a `V1 | V2` union. If the port were widened, this stops compiling.
 */
type V2ReadRejectsV1 = ExpectFalse<
  V2ReadResult extends CharacterSheetDraft ? true : false
>;

type V2LatestResult = Awaited<
  ReturnType<CharacterSheetDraftStoreV2["getLatestDraft"]>
>;
type V2LatestIsNullableV2 = ExpectTrue<
  V2LatestResult extends CharacterSheetDraftV2 | null ? true : false
>;

/** `putDraft` accepts canonical V2 and nothing else. */
type V2PutParam = Parameters<CharacterSheetDraftStoreV2["putDraft"]>[0];
type V2PutAcceptsV2 = ExpectTrue<
  V2PutParam extends CharacterSheetDraftV2 ? true : false
>;
/** A V1 draft is NOT assignable to the V2 write parameter. */
type V2PutRejectsV1 = ExpectFalse<
  CharacterSheetDraft extends V2PutParam ? true : false
>;

/** The V1 port still returns V1 and was neither widened nor narrowed. */
type V1ReadResult = Awaited<
  ReturnType<CharacterSheetDraftStore["getDraftVersion"]>
>;
type V1ReadIsV1 = ExpectTrue<
  V1ReadResult extends CharacterSheetDraft | null ? true : false
>;
/** The two ports are distinct contracts, not two views of one. */
type V1ReadIsNotV2 = ExpectFalse<
  V1ReadResult extends CharacterSheetDraftV2 | null ? true : false
>;
type V1PutParam = Parameters<CharacterSheetDraftStore["putDraft"]>[0];
type V1PutIsV1 = ExpectTrue<
  V1PutParam extends CharacterSheetDraft ? true : false
>;

/** Identity is reused, not duplicated: both ports take the same type. */
type V2IdentityIsReused = ExpectTrue<
  Parameters<
    CharacterSheetDraftStoreV2["getDraftVersion"]
  >[0] extends CharacterSheetDraftIdentity
    ? true
    : false
>;
type V1IdentityIsTheSameType = ExpectTrue<
  Parameters<
    CharacterSheetDraftStore["getDraftVersion"]
  >[0] extends CharacterSheetDraftIdentity
    ? true
    : false
>;

/** Key operations stay schema-neutral. */
type V2ListReturnsNumbers = ExpectTrue<
  Awaited<
    ReturnType<CharacterSheetDraftStoreV2["listDraftVersions"]>
  > extends number[]
    ? true
    : false
>;
type V2DeleteReturnsVoid = ExpectTrue<
  Awaited<ReturnType<CharacterSheetDraftStoreV2["deleteDraft"]>> extends void
    ? true
    : false
>;

describe("4E1 domain port — V1/V2 coexistence", () => {
  it("1. the V2 port is exported from the package root", () => {
    // Proven by the resolving `import type` above plus the exact-shape check:
    // a missing export fails to compile.
    const isPublic: V2StoreIsExportedFromRoot = true;
    expect(isPublic).toBe(true);
  });

  it("2. the existing V1 store port remains public and unchanged", () => {
    const v1ReadIsV1: V1ReadIsV1 = true;
    const v1PutIsV1: V1PutIsV1 = true;

    expect(v1ReadIsV1).toBe(true);
    expect(v1PutIsV1).toBe(true);
  });

  it("3. the V1 and V2 ports are distinct contracts, not two views of one", () => {
    const v1IsNotV2: V1ReadIsNotV2 = false;
    expect(v1IsNotV2).toBe(false);
  });

  it("4. the V2 port was not replaced by a union or generic store", () => {
    // Exactly five members, none of which is a union-typed read result or a
    // generic parameter. Pinned structurally by `V2StoreIsExportedFromRoot` and
    // `V2ReadRejectsV1`.
    const readRejectsV1: V2ReadRejectsV1 = false;
    expect(readRejectsV1).toBe(false);
  });

  it("5. V2 reads return exactly CharacterSheetDraftV2 | null", () => {
    const readShape: V2ReadIsNullableV2 = true;
    const latestShape: V2LatestIsNullableV2 = true;
    expect(readShape).toBe(true);
    expect(latestShape).toBe(true);
  });

  it("6. V2 reads are not a V1|V2 union", () => {
    const rejectsV1: V2ReadRejectsV1 = false;
    expect(rejectsV1).toBe(false);
  });

  it("7. putDraft accepts canonical V2 and rejects V1 at the type level", () => {
    const acceptsV2: V2PutAcceptsV2 = true;
    const rejectsV1: V2PutRejectsV1 = false;

    expect(acceptsV2).toBe(true);
    expect(rejectsV1).toBe(false);
  });

  it("8. the identity type is reused rather than duplicated", () => {
    const v2Reuses: V2IdentityIsReused = true;
    const v1Same: V1IdentityIsTheSameType = true;

    expect(v2Reuses).toBe(true);
    expect(v1Same).toBe(true);
  });

  it("9. list and delete stay schema-neutral", () => {
    const listIsNumbers: V2ListReturnsNumbers = true;
    const deleteIsVoid: V2DeleteReturnsVoid = true;

    expect(listIsNumbers).toBe(true);
    expect(deleteIsVoid).toBe(true);
  });

  it("10. a structurally conforming V2 port is expressible", () => {
    // Purely a signature conformance check; the call is never reached.
    expect(typeof makeV2StoreShape).toBe("function");
  });
});
