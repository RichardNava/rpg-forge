import { describe, expect, it } from "vitest";
import { applyDraftMutation } from "./mutation-api";
import { rerollLockedDraftValues } from "./reroll";
import { makeDraft } from "./draft-fixture";
import { assertDraftEditable, finalizeDraft } from "./finalize";
import type { DraftError } from "./errors";

describe("draft finalization (terminal confirmation)", () => {
  it("bumps the version deterministically and marks the draft confirmed", () => {
    const draft = makeDraft();
    const confirmed = finalizeDraft(draft);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.version).toBe(draft.version + 1);
    expect(confirmed.baseVersion).toBe(draft.baseVersion);
    expect(confirmed.fields).toEqual(draft.fields);
    expect(confirmed.values).toEqual(draft.values);
  });

  it("is deterministic: the same draft yields the same confirmed snapshot", () => {
    const a = finalizeDraft(makeDraft());
    const b = finalizeDraft(makeDraft());
    expect(a).toEqual(b);
  });

  it("rejects finalizing an already-confirmed draft", () => {
    const confirmed = finalizeDraft(makeDraft());
    try {
      finalizeDraft(confirmed);
      expect.unreachable("finalizeDraft must reject an already-confirmed draft");
    } catch (error) {
      expect((error as DraftError).code).toBe("draft_confirmed");
    }
  });

  it("assertDraftEditable rejects a confirmed draft and allows an editable one", () => {
    const confirmed = finalizeDraft(makeDraft());
    expect(() => assertDraftEditable(confirmed)).toThrowError(
      expect.objectContaining({ code: "draft_confirmed" }),
    );
    expect(() => assertDraftEditable(makeDraft())).not.toThrow();
  });

  it("rejects drafting/mutating a confirmed draft", () => {
    const confirmed = finalizeDraft(makeDraft());
    expect(() =>
      applyDraftMutation(confirmed, {
        op: "set_value",
        key: "character_name",
        value: "Someone Else",
      }),
    ).toThrowError(expect.objectContaining({ code: "draft_confirmed" }));
  });

  it("rejects rerolling a confirmed draft", () => {
    const confirmed = finalizeDraft(makeDraft());
    expect(() => rerollLockedDraftValues(confirmed, "seed")).toThrowError(
      expect.objectContaining({ code: "draft_confirmed" }),
    );
  });
});
