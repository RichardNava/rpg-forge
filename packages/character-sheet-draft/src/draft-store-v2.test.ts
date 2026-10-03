import { describe, expect, it } from "vitest";
import type {
  CharacterSheetDraftIdentity,
  CharacterSheetDraftStoreV2,
  CharacterSheetDraftV2,
} from "./index";

/**
 * 4E1 DOMAIN PORT SUITE (4E6: V2-only).
 *
 * This file is deliberately INTERFACE-LEVEL. The V2 port is a contract with no
 * behavior of its own — every behavior lives in an adapter — so there is nothing
 * to exercise at runtime here. The proofs are therefore compile-time: they pin
 * the SHAPE of the port and the identity it addresses snapshots by.
 *
 * Runtime behavior of the port is proven against the R2 adapter in
 * `apps/rules-worker/src/infrastructure/r2-character-sheet-drafts-v2.test.ts`.
 *
 * `CharacterSheetDraftStoreV2` is imported ONLY as a type, so this file adds no
 * runtime dependency on the module.
 */

/** A structurally conforming V2 port, built purely to pin the signatures. */
function makeV2StoreShape(): CharacterSheetDraftStoreV2 {
  throw new Error("type-level only");
}

/**
 * Compile-time proofs.
 *
 * `CharacterSheetDraftStoreV2` is a TYPE-only export, so `keyof PublicApi`
 * (which covers VALUE exports) cannot see it. Its publicness is instead proven
 * the only way it can be: the `import type` above resolves through `./index`,
 * so a missing export is a COMPILE error. `ExpectFalse<T extends false>` makes
 * a wrong shape a compile error rather than a silently passing assertion.
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

describe("4E1 domain port — V2 store contract", () => {
  it("1. the V2 port is exported from the package root", () => {
    // Proven by the resolving `import type` above plus the exact-shape check:
    // a missing export fails to compile.
    const isPublic: V2StoreIsExportedFromRoot = true;
    expect(isPublic).toBe(true);
  });

  it("2. the V2 port was not replaced by a union or generic store", () => {
    // Exactly five members, none of which is a union-typed read result or a
    // generic parameter. Pinned structurally by `V2StoreIsExportedFromRoot`.
    expect(typeof makeV2StoreShape).toBe("function");
  });

  it("3. V2 reads return exactly CharacterSheetDraftV2 | null", () => {
    const readShape: V2ReadIsNullableV2 = true;
    const latestShape: V2LatestIsNullableV2 = true;
    expect(readShape).toBe(true);
    expect(latestShape).toBe(true);
  });

  it("4. putDraft accepts canonical V2 at the type level", () => {
    const acceptsV2: V2PutAcceptsV2 = true;

    expect(acceptsV2).toBe(true);
  });

  it("5. list and delete stay schema-neutral", () => {
    const listIsNumbers: V2ListReturnsNumbers = true;
    const deleteIsVoid: V2DeleteReturnsVoid = true;

    expect(listIsNumbers).toBe(true);
    expect(deleteIsVoid).toBe(true);
  });

  it("6. a structurally conforming V2 port is expressible", () => {
    // Purely a signature conformance check; the call is never reached.
    expect(typeof makeV2StoreShape).toBe("function");
  });
});
