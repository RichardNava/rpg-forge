import { describe, expect, it } from "vitest";
import {
  AiDraftCreationError,
  AiDraftCreationRequestV1Schema,
  AiDraftProposalV1Schema,
  compileAiProposalToDraftV2,
  validateAiDraftProposal,
  type AiDraftProposalV1,
} from "./ai-draft-creation.js";

function validProposal(): AiDraftProposalV1 {
  return {
    schemaVersion: "1",
    characterName: "Grom thePatient",
    sections: [{ id: "core", title: "Core", parentId: null }],
    fields: [
      { id: "character_name", label: "Character name", type: "text" },
      {
        id: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 10,
        value: 8,
      },
      {
        id: "homeland",
        label: "Homeland",
        type: "choice",
        options: ["North", "South"],
        value: "North",
      },
      { id: "bio", label: "Biography", type: "textarea" },
    ],
    structure: [
      { kind: "field", id: "character_name", parentId: null },
      { kind: "section", id: "core", parentId: null },
      { kind: "field", id: "strength", parentId: "core" },
      { kind: "field", id: "homeland", parentId: "core" },
      { kind: "field", id: "bio", parentId: "core" },
    ],
  };
}

describe("AiDraftCreationRequestV1", () => {
  it("requires a non-empty bounded prompt and preserves mode", () => {
    expect(
      AiDraftCreationRequestV1Schema.safeParse({
        schemaVersion: "1",
        mode: "npc",
        prompt: "A large clumsy orc.",
      }).success,
    ).toBe(true);
    expect(
      AiDraftCreationRequestV1Schema.safeParse({
        schemaVersion: "1",
        mode: "pc",
        prompt: "   ",
      }).success,
    ).toBe(false);
    expect(
      AiDraftCreationRequestV1Schema.safeParse({
        schemaVersion: "1",
        mode: "npc",
        prompt: "x".repeat(5001),
      }).success,
    ).toBe(false);
  });
});

describe("validateAiDraftProposal", () => {
  it("accepts a valid proposal", () => {
    expect(validateAiDraftProposal(validProposal()).characterName).toBe(
      "Grom thePatient",
    );
  });

  it("rejects invalid field types, duplicate ids, unknown parents, cycles", () => {
    const badType = validProposal();
    (badType.fields[1] as { type: string }).type = "image";
    expect(() => validateAiDraftProposal(badType)).toThrow(
      AiDraftCreationError,
    );

    const dup = validProposal();
    dup.fields.push({ id: "strength", label: "Again", type: "text" });
    dup.structure.push({ kind: "field", id: "strength", parentId: null });
    expect(() => validateAiDraftProposal(dup)).toThrow(/Duplicate/);

    const unknownParent = validProposal();
    unknownParent.sections.push({
      id: "deep",
      title: "Deep",
      parentId: "missing",
    });
    unknownParent.structure.push({
      kind: "section",
      id: "deep",
      parentId: null,
    });
    expect(() => validateAiDraftProposal(unknownParent)).toThrow(
      /unknown parent/,
    );

    const cycle = validProposal();
    cycle.sections.push(
      { id: "a", title: "A", parentId: "b" },
      { id: "b", title: "B", parentId: "a" },
    );
    cycle.structure.push(
      { kind: "section", id: "a", parentId: null },
      { kind: "section", id: "b", parentId: null },
    );
    expect(() => validateAiDraftProposal(cycle)).toThrow(/Cyclic/);
  });

  it("rejects invalid choice definitions, values, ranges, and extra props", () => {
    const badChoice = validProposal();
    badChoice.fields[2] = {
      id: "homeland",
      label: "Homeland",
      type: "choice",
      options: ["North"],
      value: "East",
    };
    expect(() => validateAiDraftProposal(badChoice)).toThrow(/declared option/);

    const missingOptions = validProposal();
    missingOptions.fields[2] = {
      id: "homeland",
      label: "Homeland",
      type: "choice",
    };
    expect(() => validateAiDraftProposal(missingOptions)).toThrow(
      /must declare options/,
    );

    const badRange = validProposal();
    badRange.fields[1] = {
      id: "strength",
      label: "Strength",
      type: "number",
      min: 10,
      max: 1,
    };
    expect(() => validateAiDraftProposal(badRange)).toThrow(
      /min cannot exceed/,
    );

    expect(
      AiDraftProposalV1Schema.safeParse({
        ...validProposal(),
        confirmed: true,
        draftId: "minted-by-model",
        portrait: { kind: "ai" },
      }).success,
    ).toBe(false);
  });

  it("rejects structure that skips or duplicates nodes", () => {
    const missing = validProposal();
    missing.structure = missing.structure.slice(0, 4);
    expect(() => validateAiDraftProposal(missing)).toThrow(/exactly once/);
  });

  it("rejects injection: mode change, confirmation, new authorities", () => {
    expect(
      AiDraftProposalV1Schema.safeParse({
        ...validProposal(),
        mode: "pc",
        version: 99,
        schemaVersion: "1",
      }).success,
    ).toBe(false);
  });
});

describe("compileAiProposalToDraftV2", () => {
  const ids = {
    sessionId: "22222222-2222-2222-2222-222222222222",
    draftId: "11111111-1111-1111-1111-111111111111",
  };

  it("compiles a canonical unconfirmed draft with app-owned authority", () => {
    const draft = compileAiProposalToDraftV2({
      proposal: validProposal(),
      ...ids,
      mode: "npc",
    });
    expect(draft.schemaVersion).toBe("2");
    expect(draft.draftId).toBe(ids.draftId);
    expect(draft.sessionId).toBe(ids.sessionId);
    expect(draft.mode).toBe("npc");
    expect(draft.confirmed).toBe(false);
    expect(draft.version).toBe(1);
    expect(draft.baseVersion).toBe(1);
    expect(draft.source).toEqual({ sourceSheetId: null, sourceRunId: null });
    expect(draft.slots ?? []).toEqual([]);
    expect(draft.layout).toBeUndefined();
  });

  it("preserves structure order, hierarchy, and type-safe values", () => {
    const draft = compileAiProposalToDraftV2({
      proposal: validProposal(),
      ...ids,
      mode: "npc",
    });
    expect(draft.structure.map((placement) => placement.key)).toEqual([
      "character_name",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    const coreKey = draft.sections[0]!.key;
    expect(
      draft.structure.filter((placement) => placement.parentKey === coreKey)
        .length,
    ).toBe(3);
    expect(draft.values["proposal_strength"]).toBe(8);
    expect(draft.values["proposal_homeland"]).toBe("North");
  });

  it("keeps the character_name mirror invariant from field or proposal name", () => {
    const withValue = compileAiProposalToDraftV2({
      proposal: {
        ...validProposal(),
        fields: validProposal().fields.map((field) =>
          field.id === "character_name"
            ? { ...field, value: "Field Name" }
            : field,
        ),
        characterName: "Proposal Name",
      },
      ...ids,
      mode: "pc",
    });
    expect(withValue.characterName).toBe("Field Name");
    expect(withValue.values["character_name"]).toBe("Field Name");

    const fromProposal = compileAiProposalToDraftV2({
      proposal: { ...validProposal(), characterName: "Proposal Name" },
      ...ids,
      mode: "pc",
    });
    expect(fromProposal.characterName).toBe("Proposal Name");
    expect(fromProposal.values["character_name"]).toBe("Proposal Name");
  });

  it("synthesizes a character_name field when the proposal has none", () => {
    const proposal = validProposal();
    proposal.fields = proposal.fields.filter(
      (field) => field.id !== "character_name",
    );
    proposal.structure = proposal.structure.filter(
      (placement) => placement.id !== "character_name",
    );
    const draft = compileAiProposalToDraftV2({ proposal, ...ids, mode: "pc" });
    expect(draft.fields.some((field) => field.key === "character_name")).toBe(
      true,
    );
    expect(draft.characterName).toBe("Grom thePatient");
  });

  it("deduplicates canonical keys from duplicate labels", () => {
    const proposal = validProposal();
    proposal.fields.push(
      { id: "strength_a", label: "Strength", type: "number", min: 1, max: 5 },
      { id: "strength_b", label: "Strength", type: "number", min: 1, max: 5 },
    );
    proposal.structure.push(
      { kind: "field", id: "strength_a", parentId: "core" },
      { kind: "field", id: "strength_b", parentId: "core" },
    );
    const draft = compileAiProposalToDraftV2({ proposal, ...ids, mode: "npc" });
    const keys = draft.fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("mode comes from the request, never the proposal", () => {
    const draft = compileAiProposalToDraftV2({
      proposal: validProposal(),
      ...ids,
      mode: "pc",
    });
    expect(draft.mode).toBe("pc");
  });
});
