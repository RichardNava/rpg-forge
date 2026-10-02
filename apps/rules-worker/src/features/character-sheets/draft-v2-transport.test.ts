/**
 * 4E3A-R — tests for the internal V2 request boundary.
 *
 * The module under test owns only the request-PARSE convention and the frozen
 * policy documentation. The schemas themselves are owned and tested by
 * `@repo/character-sheet-draft`; these tests verify the Worker façade imports and
 * re-exports that authority rather than forking it.
 */
import { describe, expect, it } from "vitest";
import * as draftPackage from "@repo/character-sheet-draft";
import {
  parseDraftV2ConfirmRequest,
  parseDraftV2MutationRequest,
  parseDraftV2RerollRequest,
  SheetDraftConfirmRequestV2Schema,
  SheetDraftCreateRequestV2Schema,
  SheetDraftMutationRequestV2Schema,
  SheetDraftRerollRequestV2Schema,
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
} from "./draft-v2-transport.js";

describe("draft-v2-transport contract authority", () => {
  it("re-exports the package schemas by identity, creating no second authority", () => {
    // The strongest available guard against contract drift: if the Worker ever
    // redefines or wraps a schema, reference identity breaks.
    expect(SheetDraftCreateRequestV2Schema).toBe(
      draftPackage.SheetDraftCreateRequestV2Schema,
    );
    expect(SheetDraftSnapshotResponseV2Schema).toBe(
      draftPackage.SheetDraftSnapshotResponseV2Schema,
    );
    expect(SheetDraftMutationRequestV2Schema).toBe(
      draftPackage.SheetDraftMutationRequestV2Schema,
    );
    expect(SheetDraftRerollRequestV2Schema).toBe(
      draftPackage.SheetDraftRerollRequestV2Schema,
    );
    expect(SheetDraftRerollResponseV2Schema).toBe(
      draftPackage.SheetDraftRerollResponseV2Schema,
    );
    expect(SheetDraftConfirmRequestV2Schema).toBe(
      draftPackage.SheetDraftConfirmRequestV2Schema,
    );
  });

  it("façades all six frozen schemas, including create", () => {
    // Guards the omission trap that 4E3A-R corrected: the façade previously
    // re-exported only five of six.
    expect(SheetDraftCreateRequestV2Schema).toBeDefined();
    expect(SheetDraftSnapshotResponseV2Schema).toBeDefined();
    expect(SheetDraftMutationRequestV2Schema).toBeDefined();
    expect(SheetDraftRerollRequestV2Schema).toBeDefined();
    expect(SheetDraftRerollResponseV2Schema).toBeDefined();
    expect(SheetDraftConfirmRequestV2Schema).toBeDefined();
  });
});

describe("draft-v2-transport parse convention", () => {
  it("accepts { expectedVersion, mutation }", () => {
    const outcome = parseDraftV2MutationRequest({
      expectedVersion: 2,
      mutation: { op: "set_value", key: "character_name", value: "Brun" },
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.value.expectedVersion).toBe(2);
    }
  });

  it("rejects a bare V2 mutation with no expectedVersion", () => {
    // expectedVersion is mandatory; there is no optional or inferred variant.
    expect(
      parseDraftV2MutationRequest({
        mutation: { op: "set_value", key: "character_name", value: "Brun" },
      }).kind,
    ).toBe("invalid");
  });

  it("rejects an unusable expectedVersion rather than coercing it", () => {
    for (const expectedVersion of [0, -1, 1.5, "2", null]) {
      expect(
        parseDraftV2MutationRequest({
          expectedVersion,
          mutation: { op: "set_value", key: "character_name", value: "Brun" },
        }).kind,
      ).toBe("invalid");
    }
  });

  it("rejects unknown envelope keys such as a smuggled seed", () => {
    expect(
      parseDraftV2MutationRequest({
        expectedVersion: 2,
        mutation: { op: "set_value", key: "character_name", value: "Brun" },
        seed: "sneaky",
      }).kind,
    ).toBe("invalid");
  });

  it("accepts { expectedVersion, seed } and keeps the V1 seed bounds", () => {
    expect(
      parseDraftV2RerollRequest({ expectedVersion: 3, seed: "seed" }).kind,
    ).toBe("ok");
    expect(
      parseDraftV2RerollRequest({ expectedVersion: 3, seed: "" }).kind,
    ).toBe("invalid");
    expect(
      parseDraftV2RerollRequest({ expectedVersion: 3, seed: "x".repeat(257) })
        .kind,
    ).toBe("invalid");
  });

  it("accepts { expectedVersion } for confirm and rejects an empty body", () => {
    const ok = parseDraftV2ConfirmRequest({ expectedVersion: 5 });
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") {
      expect(ok.value.expectedVersion).toBe(5);
    }
    // The live V1 confirm route takes no body; that is what V2 removes.
    expect(parseDraftV2ConfirmRequest({}).kind).toBe("invalid");
  });

  it("requires expectedVersion on reroll and confirm as well as mutate", () => {
    expect(parseDraftV2RerollRequest({ seed: "seed" }).kind).toBe("invalid");
    expect(parseDraftV2ConfirmRequest({}).kind).toBe("invalid");
  });

  it("reports parse failure as a value, never as a thrown domain error", () => {
    // A request-shape problem is a transport concern; domain failure still throws.
    const outcome = parseDraftV2MutationRequest({ nope: true });
    expect(outcome).toEqual({ kind: "invalid" });
  });
});
