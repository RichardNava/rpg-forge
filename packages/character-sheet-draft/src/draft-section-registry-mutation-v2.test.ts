import { describe, expect, it } from "vitest";
import {
  applyDraftSectionRegistryMutationWithExpectedVersionV2,
  parseDraftSectionRegistryMutationV2,
  type DraftSectionRegistryMutationV2,
} from "./draft-section-registry-mutation-v2";
import { MAX_DRAFT_SECTIONS } from "./draft-schema";
import {
  validateDraftV2,
  type CharacterSheetDraftV2,
  type DraftPlacement,
} from "./draft-schema-v2";
import { DraftError } from "./errors";

function makeRichContentDraft(): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
    draftId: "draft.sections",
    sessionId: "session.sections",
    baseVersion: 1,
    version: 4,
    mode: "pc",
    characterName: "Aria",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Name",
        type: "text",
        locked: false,
      },
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: false,
      },
      {
        key: "veteran",
        label: "Veteran",
        type: "checkbox",
        locked: false,
      },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow"],
        locked: false,
      },
      { key: "loot", label: "Loot", type: "list", locked: false },
      { key: "secret", label: "Secret", type: "text", locked: true },
      { key: "curse", label: "Curse", type: "text", locked: true },
      { key: "quirk", label: "Quirk", type: "text", locked: false },
    ],
    sections: [
      { key: "core", title: "Core" },
      { key: "attributes", title: "Attributes" },
      { key: "equipment", title: "Equipment" },
    ],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "section", key: "attributes", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "attributes" },
      { kind: "field", key: "notes", parentKey: "core" },
      { kind: "field", key: "veteran", parentKey: null },
      { kind: "section", key: "equipment", parentKey: null },
      { kind: "field", key: "weapon", parentKey: "equipment" },
      { kind: "field", key: "loot", parentKey: "equipment" },
      { kind: "field", key: "secret", parentKey: null },
      { kind: "field", key: "curse", parentKey: null },
      { kind: "field", key: "quirk", parentKey: null },
    ],
    values: {
      character_name: "Aria",
      notes: "A note",
      strength: 12,
      veteran: true,
      weapon: "sword",
      loot: ["coin", "ring"],
      secret: "hidden",
    },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function makeConfirmedRichContentDraft(): CharacterSheetDraftV2 {
  const draft = makeRichContentDraft();
  return validateDraftV2({ ...draft, confirmed: true });
}

function makeMaxSectionsDraft(): CharacterSheetDraftV2 {
  const sections = Array.from({ length: MAX_DRAFT_SECTIONS }, (_, index) => ({
    key: `sec_${index}`,
    title: `Section ${index}`,
  }));
  const structure: DraftPlacement[] = sections.map((section) => ({
    kind: "section" as const,
    key: section.key,
    parentKey: null,
  }));
  structure.push({ kind: "field", key: "only", parentKey: null });
  return {
    schemaVersion: "2",
    draftId: "draft.maxsec",
    sessionId: "session.maxsec",
    baseVersion: 1,
    version: 4,
    mode: "pc",
    characterName: null,
    rulesContextId: null,
    fields: [{ key: "only", label: "Only", type: "text", locked: false }],
    sections,
    structure,
    values: {},
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

function apply(
  draft: CharacterSheetDraftV2,
  mutation: DraftSectionRegistryMutationV2,
  expectedVersion = draft.version,
): CharacterSheetDraftV2 {
  return applyDraftSectionRegistryMutationWithExpectedVersionV2(
    draft,
    mutation,
    expectedVersion,
  );
}

function expectDraftCode(fn: () => unknown, code: DraftError["code"]): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DraftError);
  if (thrown instanceof DraftError) {
    expect(thrown.code).toBe(code);
  }
}

describe("draft-section-registry-mutation-v2 schema / parser", () => {
  it("parses a valid add_section", () => {
    const parsed = parseDraftSectionRegistryMutationV2({
      op: "add_section",
      section: { key: "background", title: "Background" },
    });
    expect(parsed.op).toBe("add_section");
  });

  it("parses a valid rename_section", () => {
    const parsed = parseDraftSectionRegistryMutationV2({
      op: "rename_section",
      key: "core",
      title: "Core Rules",
    });
    expect(parsed.op).toBe("rename_section");
  });

  it("accepts valid keys using the approved safe syntax", () => {
    const parsed = parseDraftSectionRegistryMutationV2({
      op: "add_section",
      section: { key: "background.plot:main", title: "Background" },
    });
    expect(parsed.op === "add_section" && parsed.section.key).toBe(
      "background.plot:main",
    );
  });

  it("rejects an unknown op", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "reparent_section",
          key: "core",
          parentKey: null,
        }),
      "invalid_mutation",
    );
  });

  it("rejects an add_section without a section", () => {
    expectDraftCode(
      () => parseDraftSectionRegistryMutationV2({ op: "add_section" }),
      "invalid_mutation",
    );
  });

  it("rejects a malformed Section", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background", title: 42 },
        }),
      "invalid_mutation",
    );
  });

  it("rejects a Section missing its key", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { title: "Background" },
        }),
      "invalid_mutation",
    );
  });

  it("rejects a Section missing its title", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background" },
        }),
      "invalid_mutation",
    );
  });

  it("rejects an invalid key syntax", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "-bad", title: "Bad" },
        }),
      "invalid_mutation",
    );
  });

  it("rejects a blank or whitespace title", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background", title: "   " },
        }),
      "invalid_mutation",
    );
  });

  it("rejects an overlong title", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background", title: "x".repeat(257) },
        }),
      "invalid_mutation",
    );
  });

  it("rejects parentKey inside an added section", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: {
            key: "background",
            title: "Background",
            parentKey: "core",
          },
        }),
      "invalid_mutation",
    );
  });

  it("rejects fieldKeys inside an added section", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background", title: "Background", fieldKeys: [] },
        }),
      "invalid_mutation",
    );
  });

  it("rejects a destination inside an add payload", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background", title: "Background" },
          destination: { parentKey: null },
        }),
      "invalid_mutation",
    );
  });

  it("rejects an extra add top-level property", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background", title: "Background" },
          version: 4,
        }),
      "invalid_mutation",
    );
  });

  it("rejects an extra rename top-level property", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "rename_section",
          key: "core",
          title: "Core",
          parentKey: null,
        }),
      "invalid_mutation",
    );
  });

  it("rejects expectedVersion inside an add payload", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background", title: "Background" },
          expectedVersion: 4,
        }),
      "invalid_mutation",
    );
  });

  it("rejects expectedVersion inside a rename payload", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "rename_section",
          key: "core",
          title: "Core",
          expectedVersion: 4,
        }),
      "invalid_mutation",
    );
  });

  it("surfaces parser failure as invalid_mutation", () => {
    expectDraftCode(
      () =>
        parseDraftSectionRegistryMutationV2({
          op: "add_section",
          section: { key: "background" },
        }),
      "invalid_mutation",
    );
  });

  it("does not mutate valid parser input", () => {
    const input = {
      op: "add_section",
      section: { key: "background", title: "Background" },
    };
    const snapshot = JSON.stringify(input);
    parseDraftSectionRegistryMutationV2(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not mutate rejected parser input", () => {
    const input = {
      op: "add_section",
      section: { key: "background", title: "Background" },
      expectedVersion: 4,
    };
    const snapshot = JSON.stringify(input);
    expectDraftCode(
      () => parseDraftSectionRegistryMutationV2(input),
      "invalid_mutation",
    );
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("draft-section-registry-mutation-v2 add_section", () => {
  const addMutation: DraftSectionRegistryMutationV2 = {
    op: "add_section",
    section: {
      key: "background",
      title: "Background",
    },
  };

  it("adds a Section to the registry", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.sections.some((entry) => entry.key === "background")).toBe(
      true,
    );
  });

  it("appends the new Section as the last registry entry", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.sections[result.sections.length - 1]).toEqual({
      key: "background",
      title: "Background",
    });
  });

  it("creates exactly one new Section placement", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    const placements = result.structure.filter(
      (placement) =>
        placement.kind === "section" && placement.key === "background",
    );
    expect(placements).toHaveLength(1);
  });

  it("creates a placement with kind section", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    const placement = result.structure.find(
      (entry) => entry.kind === "section" && entry.key === "background",
    );
    expect(placement?.kind).toBe("section");
  });

  it("creates a placement with a null parentKey", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    const placement = result.structure.find(
      (entry) => entry.kind === "section" && entry.key === "background",
    );
    expect(placement?.parentKey).toBeNull();
  });

  it("appends the new placement as the final structure entry", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.structure[result.structure.length - 1]).toEqual({
      kind: "section",
      key: "background",
      parentKey: null,
    });
  });

  it("keeps the existing structure order unchanged", () => {
    const draft = makeRichContentDraft();
    const before = JSON.stringify(draft.structure);
    const result = apply(draft, addMutation);
    expect(
      JSON.stringify(result.structure.slice(0, draft.structure.length)),
    ).toBe(before);
  });

  it("preserves existing placement objects by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    draft.structure.forEach((placement, index) => {
      expect(result.structure[index]).toBe(placement);
    });
  });

  it("preserves fields by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.fields).toBe(draft.fields);
  });

  it("preserves values by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.values).toBe(draft.values);
  });

  it("preserves existing Section objects by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    draft.sections.forEach((section, index) => {
      expect(result.sections[index]).toBe(section);
    });
  });

  it("preserves characterName", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.characterName).toBe(draft.characterName);
  });

  it("preserves source", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.source).toBe(draft.source);
  });

  it("produces a valid V2 draft", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("increments the version exactly once", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.version).toBe(draft.version + 1);
  });

  it("preserves baseVersion", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, addMutation);
    expect(result.baseVersion).toBe(draft.baseVersion);
  });

  it("does not mutate the input draft", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(draft);
    apply(draft, addMutation);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("does not mutate the mutation object", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(addMutation);
    apply(draft, addMutation);
    expect(JSON.stringify(addMutation)).toBe(snapshot);
  });

  it("rejects a duplicate Section key", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "core", title: "Another Core" },
        }),
      "invalid_mutation",
    );
  });

  it("rejects an identical duplicate Section", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "core", title: "Core" },
        }),
      "invalid_mutation",
    );
  });

  it("rejects a Section key colliding with a Field", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "strength", title: "Strength Section" },
        }),
      "invalid_mutation",
    );
  });

  it("rejects when the draft is at MAX_DRAFT_SECTIONS", () => {
    const draft = makeMaxSectionsDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "overflow", title: "Overflow" },
        }),
      "surface_out_of_bounds",
    );
  });
});

describe("draft-section-registry-mutation-v2 rename_section", () => {
  it("changes the target title", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    const renamed = result.sections.find((entry) => entry.key === "core");
    expect(renamed?.title).toBe("Core Playbook");
  });

  it("keeps the Section key unchanged", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.sections.some((entry) => entry.key === "core")).toBe(true);
  });

  it("replaces only the target Section object", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    const original = draft.sections.find((entry) => entry.key === "core");
    const replaced = result.sections.find((entry) => entry.key === "core");
    expect(replaced).not.toBe(original);
    expect(result.sections).toHaveLength(draft.sections.length);
  });

  it("keeps untouched Section objects by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    draft.sections.forEach((section) => {
      if (section.key === "core") return;
      expect(result.sections.some((entry) => entry === section)).toBe(true);
    });
  });

  it("preserves structure by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.structure).toBe(draft.structure);
  });

  it("preserves fields by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.fields).toBe(draft.fields);
  });

  it("preserves values by reference", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.values).toBe(draft.values);
  });

  it("preserves characterName", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.characterName).toBe(draft.characterName);
  });

  it("preserves source", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.source).toBe(draft.source);
  });

  it("keeps hierarchy and parent relationships unchanged", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.structure).toBe(draft.structure);
  });

  it("produces a valid V2 draft", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("increments the version exactly once", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.version).toBe(draft.version + 1);
  });

  it("preserves baseVersion", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(result.baseVersion).toBe(draft.baseVersion);
  });

  it("returns the exact original reference for a same-title rename", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core",
    });
    expect(result).toBe(draft);
  });

  it("does not bump the version for a same-title rename", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core",
    });
    expect(result.version).toBe(draft.version);
  });

  it("rejects an unknown Section", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "rename_section",
          key: "ghost",
          title: "Ghost",
        }),
      "invalid_mutation",
    );
  });

  it("does not mutate the input draft", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(draft);
    apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("does not mutate the mutation object", () => {
    const draft = makeRichContentDraft();
    const mutation: DraftSectionRegistryMutationV2 = {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    };
    const snapshot = JSON.stringify(mutation);
    apply(draft, mutation);
    expect(JSON.stringify(mutation)).toBe(snapshot);
  });
});

describe("draft-section-registry-mutation-v2 concurrency precedence", () => {
  const addMutation: DraftSectionRegistryMutationV2 = {
    op: "add_section",
    section: {
      key: "background",
      title: "Background",
    },
  };
  const renameMutation: DraftSectionRegistryMutationV2 = {
    op: "rename_section",
    key: "core",
    title: "Core Playbook",
  };

  it("rejects a lower expectedVersion with version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () => apply(draft, addMutation, draft.version - 1),
      "version_conflict",
    );
  });

  it("rejects a higher expectedVersion with version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () => apply(draft, addMutation, draft.version + 1),
      "version_conflict",
    );
  });

  it("stale + confirmed add resolves to version_conflict", () => {
    const draft = makeConfirmedRichContentDraft();
    expectDraftCode(
      () => apply(draft, addMutation, draft.version - 1),
      "version_conflict",
    );
  });

  it("stale + duplicate Section resolves to version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(
          draft,
          {
            op: "add_section",
            section: { key: "core", title: "Core" },
          },
          draft.version - 1,
        ),
      "version_conflict",
    );
  });

  it("stale + Field collision resolves to version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(
          draft,
          {
            op: "add_section",
            section: { key: "strength", title: "Strength Section" },
          },
          draft.version - 1,
        ),
      "version_conflict",
    );
  });

  it("stale + max Sections resolves to version_conflict", () => {
    const draft = makeMaxSectionsDraft();
    expectDraftCode(
      () =>
        apply(
          draft,
          {
            op: "add_section",
            section: { key: "overflow", title: "Overflow" },
          },
          draft.version - 1,
        ),
      "version_conflict",
    );
  });

  it("stale + unknown rename resolves to version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(
          draft,
          { op: "rename_section", key: "ghost", title: "Ghost" },
          draft.version - 1,
        ),
      "version_conflict",
    );
  });

  it("stale + same-title rename resolves to version_conflict", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(
          draft,
          { op: "rename_section", key: "core", title: "Core" },
          draft.version - 1,
        ),
      "version_conflict",
    );
  });

  it("matching version + confirmed add resolves to draft_confirmed", () => {
    const draft = makeConfirmedRichContentDraft();
    expectDraftCode(() => apply(draft, addMutation), "draft_confirmed");
  });

  it("matching version + confirmed rename resolves to draft_confirmed", () => {
    const draft = makeConfirmedRichContentDraft();
    expectDraftCode(() => apply(draft, renameMutation), "draft_confirmed");
  });

  it("matching version + same-title confirmed rename is draft_confirmed", () => {
    const draft = makeConfirmedRichContentDraft();
    expectDraftCode(
      () => apply(draft, { op: "rename_section", key: "core", title: "Core" }),
      "draft_confirmed",
    );
  });

  it("matching version + duplicate Section resolves to invalid_mutation", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "attributes", title: "Attributes" },
        }),
      "invalid_mutation",
    );
  });

  it("matching version + Field collision resolves to invalid_mutation", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "weapon", title: "Weapon Section" },
        }),
      "invalid_mutation",
    );
  });

  it("matching version + unknown rename resolves to invalid_mutation", () => {
    const draft = makeRichContentDraft();
    expectDraftCode(
      () =>
        apply(draft, { op: "rename_section", key: "ghost", title: "Ghost" }),
      "invalid_mutation",
    );
  });

  it("matching version + max Sections resolves to surface_out_of_bounds", () => {
    const draft = makeMaxSectionsDraft();
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "overflow", title: "Overflow" },
        }),
      "surface_out_of_bounds",
    );
  });

  it("leaves the input unchanged after rejected cases", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(draft);
    expectDraftCode(
      () => apply(draft, addMutation, draft.version - 1),
      "version_conflict",
    );
    expectDraftCode(
      () =>
        apply(draft, {
          op: "add_section",
          section: { key: "core", title: "Core" },
        }),
      "invalid_mutation",
    );
    expectDraftCode(
      () =>
        apply(draft, { op: "rename_section", key: "ghost", title: "Ghost" }),
      "invalid_mutation",
    );
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});

describe("draft-section-registry-mutation-v2 structural guarantees", () => {
  it("keeps all previous structure entries in the same order on add", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_section",
      section: { key: "background", title: "Background" },
    });
    expect(
      JSON.stringify(result.structure.slice(0, draft.structure.length)),
    ).toBe(JSON.stringify(draft.structure));
  });

  it("keeps all existing parentKey values unchanged on add", () => {
    const draft = makeRichContentDraft();
    const parentsBefore = draft.structure.map(
      (placement) => placement.parentKey,
    );
    const result = apply(draft, {
      op: "add_section",
      section: { key: "background", title: "Background" },
    });
    expect(
      result.structure
        .slice(0, draft.structure.length)
        .map((placement) => placement.parentKey),
    ).toEqual(parentsBefore);
  });

  it("keeps Section subtree contiguity valid after add", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_section",
      section: { key: "background", title: "Background" },
    });
    expect(() => validateDraftV2(result)).not.toThrow();
  });

  it("creates only one new placement on add", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_section",
      section: { key: "background", title: "Background" },
    });
    expect(result.structure).toHaveLength(draft.structure.length + 1);
  });

  it("makes the new Section a Root, last placement", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "add_section",
      section: { key: "background", title: "Background" },
    });
    const last = result.structure[result.structure.length - 1];
    expect(last).toEqual({
      kind: "section",
      key: "background",
      parentKey: null,
    });
  });

  it("does not change any Field placement on add", () => {
    const draft = makeRichContentDraft();
    const fieldPlacementsBefore = draft.structure.filter(
      (placement) => placement.kind === "field",
    );
    const result = apply(draft, {
      op: "add_section",
      section: { key: "background", title: "Background" },
    });
    expect(result.structure.filter((p) => p.kind === "field")).toEqual(
      fieldPlacementsBefore,
    );
  });

  it("keeps structure identical by reference on rename", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "equipment",
      title: "Gear",
    });
    expect(result.structure).toBe(draft.structure);
  });

  it("keeps the structure deep snapshot unchanged on rename", () => {
    const draft = makeRichContentDraft();
    const snapshot = JSON.stringify(draft.structure);
    const result = apply(draft, {
      op: "rename_section",
      key: "equipment",
      title: "Gear",
    });
    expect(JSON.stringify(result.structure)).toBe(snapshot);
  });

  it("keeps Section placement key and parent unchanged on rename", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "equipment",
      title: "Gear",
    });
    const placement = result.structure.find(
      (entry) => entry.kind === "section" && entry.key === "equipment",
    );
    expect(placement).toEqual({
      kind: "section",
      key: "equipment",
      parentKey: null,
    });
  });

  it("keeps the nested subtree identical on rename", () => {
    const draft = makeRichContentDraft();
    const result = apply(draft, {
      op: "rename_section",
      key: "core",
      title: "Core Playbook",
    });
    const subtree = draft.structure.filter(
      (placement) => placement.parentKey === "core" || placement.key === "core",
    );
    expect(
      result.structure.filter(
        (placement) =>
          placement.parentKey === "core" || placement.key === "core",
      ),
    ).toEqual(subtree);
  });
});
