import { createHash } from "node:crypto";

import {
  initialDraftVersionV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import {
  MEDIEVAL_STYLE_PROFILE,
  SCI_FI_STYLE_PROFILE,
  resolveFinalValues,
  type FinalPresentationPlanV1,
} from "@repo/character-sheet-generation";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { CharacterSheetPdfRenderError } from "./errors.js";
import {
  renderStyledCharacterSheetPdf,
  type StyledDraftPdfManifest,
} from "./draft-renderer.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadForm(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return { document, form: document.getForm() };
}

const MEDIEVAL_PLAN: FinalPresentationPlanV1 = {
  schemaVersion: "1",
  style: "medieval",
  variant: "standard",
  ornamentDensity: "light",
  contrast: "medium",
  sectionEmphasis: "standard",
  fieldEmphasis: "standard",
};

const SCIFI_PLAN: FinalPresentationPlanV1 = {
  schemaVersion: "1",
  style: "sci-fi",
  variant: "compact",
  ornamentDensity: "medium",
  contrast: "high",
  sectionEmphasis: "pronounced",
  fieldEmphasis: "standard",
};

function buildRichDraft(): CharacterSheetDraftV2 {
  return initialDraftVersionV2({
    schemaVersion: "2",
    draftId: "draft.styled.1",
    sessionId: "session.styled.1",
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Character Name", type: "text", locked: false },
      { key: "strength", label: "Strength", type: "number", min: 0, max: 20, locked: false },
      { key: "agility", label: "Agility", type: "number", min: 1, max: 20, locked: false },
      { key: "born", label: "Born", type: "date", locked: false },
      { key: "bio", label: "Biography", type: "textarea", locked: false },
      { key: "veteran", label: "Veteran", type: "checkbox", locked: false },
      { key: "calling", label: "Calling", type: "choice", options: ["ranger", "sage", "scout"], locked: false },
      { key: "motto", label: "Motto", type: "label", locked: false },
    ],
    sections: [
      { key: "core", title: "Core" },
      { key: "lore", title: "Lore" },
      { key: "nested", title: "Nested" },
    ],
    structure: [
      // Mixed root order: field, section, field, section (canonical preorder:
      // each subtree is contiguous).
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "section", key: "core", parentKey: null },
      // Core container: mixed field order with grid geometry.
      { kind: "field", key: "strength", parentKey: "core" },
      { kind: "field", key: "agility", parentKey: "core" },
      { kind: "field", key: "motto", parentKey: null },
      { kind: "section", key: "lore", parentKey: null },
      // Nested section inside lore (Section inside Section).
      { kind: "section", key: "nested", parentKey: "lore" },
      { kind: "field", key: "born", parentKey: "nested" },
      { kind: "field", key: "bio", parentKey: "lore" },
      { kind: "field", key: "veteran", parentKey: "lore" },
      { kind: "field", key: "calling", parentKey: "lore" },
    ],
    layout: {
      schemaVersion: "1",
      root: { columns: 2 },
      sections: {
        core: { columns: 2 },
        lore: { columns: 2 },
        nested: { columns: 1 },
      },
      nodes: {
        character_name: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
        core: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: true },
        motto: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        lore: { columnStart: 2, columnSpan: 1, rowSpan: 2, breakBefore: false },
        strength: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        agility: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
        nested: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: true },
        born: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        bio: { columnStart: 1, columnSpan: 2, rowSpan: 2, breakBefore: false },
        veteran: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: true },
        calling: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
      },
    },
    values: {
      character_name: "Aria Stone",
      strength: 0,
      veteran: false,
      calling: "ranger",
      born: "1412-03-04",
    },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  });
}

function buildNpcDraft() {
  return initialDraftVersionV2({
    schemaVersion: "2",
    draftId: "draft.styled.npc",
    sessionId: "session.styled.npc",
    mode: "npc",
    characterName: "Goblin",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Character Name", type: "text", locked: false },
      { key: "hp", label: "HP", type: "number", min: 10, max: 20, locked: false },
      { key: "notes", label: "Notes", type: "textarea", locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "hp", parentKey: "core" },
      { kind: "field", key: "notes", parentKey: "core" },
    ],
    layout: {
      schemaVersion: "1",
      root: { columns: 1 },
      sections: { core: { columns: 1 } },
      nodes: {
        core: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        character_name: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        hp: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        notes: { columnStart: 1, columnSpan: 1, rowSpan: 2, breakBefore: false },
      },
    },
    values: { character_name: "Goblin" },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  });
}

describe("draft-native styled renderer", () => {
  it("renders a valid medieval PDF from a confirmed draft", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1_000);
    expect(manifest.schemaVersion).toBe("1");
    expect(manifest.draftId).toBe("draft.styled.1");
    expect(manifest.draftVersion).toBe(1);
    expect(manifest.presentation.style).toBe("medieval");
    const { document } = await loadForm(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe("Aria Stone");
  });

  it("renders a valid sci-fi PDF from the same draft", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: SCIFI_PLAN,
      profile: SCI_FI_STYLE_PROFILE,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(manifest.presentation.style).toBe("sci-fi");
    const { document } = await loadForm(bytes);
    expect(document.getPageCount()).toBe(1);
  });

  it("produces byte-distinct PDFs with equal semantic manifests across styles", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const medieval = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    const scifi = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: SCIFI_PLAN,
      profile: SCI_FI_STYLE_PROFILE,
    });
    expect(sha256(medieval.bytes)).not.toBe(sha256(scifi.bytes));
    expect(medieval.manifest.semantic).toEqual(scifi.manifest.semantic);
    expect(medieval.manifest.presentation.style).toBe("medieval");
    expect(scifi.manifest.presentation.style).toBe("sci-fi");
  });

  it("preserves recursive structure, mixed order, and grid geometry in the manifest", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    const byKey = new Map(manifest.semantic.nodes.map((n) => [n.key, n]));
    // Nested section preserved.
    expect(byKey.get("nested")?.parentKey).toBe("lore");
    expect(byKey.get("nested")?.kind).toBe("section");
    // Root mixed order preserved (canonical preorder).
    const rootOrder = manifest.semantic.nodes
      .filter((n) => n.parentKey === null)
      .sort((a, b) => a.canonicalOrder - b.canonicalOrder)
      .map((n) => n.key);
    expect(rootOrder).toEqual(["character_name", "core", "motto", "lore"]);
    // Geometry preserved.
    expect(byKey.get("character_name")?.layout.columnSpan).toBe(2);
    expect(byKey.get("lore")?.layout.columnStart).toBe(2);
    expect(byKey.get("lore")?.layout.rowSpan).toBe(2);
    expect(byKey.get("bio")?.layout.columnSpan).toBe(2);
    expect(byKey.get("bio")?.layout.rowSpan).toBe(2);
    expect(byKey.get("veteran")?.layout.breakBefore).toBe(true);
    expect(byKey.get("core")?.containerColumns).toBe(2);
    expect(byKey.get("strength")?.containerColumns).toBe(2);
    expect(byKey.get("born")?.containerColumns).toBe(1);
  });

  it("preserves explicit false, 0, text, date, and choice values", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    const { form } = await loadForm(bytes);
    expect(form.getTextField("rpgforge.strength").getText()).toBe("0");
    // Choice uses dropdown (not a text field).
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(loaded.getForm().getDropdown("rpgforge.calling").getSelected()).toEqual(["ranger"]);
    expect(loaded.getForm().getCheckBox("rpgforge.veteran").isChecked()).toBe(false);
    expect(form.getTextField("rpgforge.born").getText()).toBe("1412-03-04");
    const byKey = new Map(manifest.semantic.nodes.map((n) => [n.key, n]));
    expect(byKey.get("strength")?.valueState).toBe("explicit");
    expect(byKey.get("veteran")?.valueState).toBe("explicit");
    expect(byKey.get("calling")?.valueState).toBe("explicit");
  });

  it("leaves PC blanks blank and editable, labels static without widgets", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    const { form } = await loadForm(bytes);
    expect(form.getTextField("rpgforge.agility").getText()).toBeUndefined();
    expect(form.getTextField("rpgforge.bio").getText()).toBeUndefined();
    const names = form.getFields().map((f) => f.getName());
    expect(names).not.toContain("rpgforge.motto");
    const byKey = new Map(manifest.semantic.nodes.map((n) => [n.key, n]));
    expect(byKey.get("agility")?.valueState).toBe("blank");
    expect(byKey.get("agility")?.editable).toBe(true);
    expect(byKey.get("motto")?.valueState).toBe("blank");
    expect(byKey.get("motto")?.editable).toBe(false);
  });

  it("resolves NPC bounded numeric blanks deterministically and identically across styles", async () => {
    const draft = buildNpcDraft();
    const threat = "medium" as const;
    const seed = "npc-seed-1";
    const resolved = resolveFinalValues(draft, { threat, seed });
    expect(resolved.values.hp).toBeGreaterThanOrEqual(10);
    expect(resolved.values.hp).toBeLessThanOrEqual(20);
    expect(resolved.generatedKeys).toContain("hp");
    const medieval = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    const scifi = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: { values: { ...resolved.values }, generatedKeys: [...resolved.generatedKeys] },
      presentation: SCIFI_PLAN,
      profile: SCI_FI_STYLE_PROFILE,
    });
    const byKeyMedieval = new Map(medieval.manifest.semantic.nodes.map((n) => [n.key, n]));
    const byKeySciFi = new Map(scifi.manifest.semantic.nodes.map((n) => [n.key, n]));
    expect(byKeyMedieval.get("hp")?.valueState).toBe("generated");
    expect(byKeySciFi.get("hp")?.valueState).toBe("generated");
    expect(byKeyMedieval.get("notes")?.valueState).toBe("blank");
    // Same resolved values => same semantic nodes across styles.
    expect(medieval.manifest.semantic).toEqual(scifi.manifest.semantic);
    const { form } = await loadForm(medieval.bytes);
    expect(form.getTextField("rpgforge.hp").getText()).toBe(String(resolved.values.hp));
    expect(form.getTextField("rpgforge.notes").getText()).toBeUndefined();
  });

  it("does not call the flat CharacterSheetSpec projection", () => {
    expect(renderStyledCharacterSheetPdf.toString()).not.toContain("projectDraftV2ToSpec");
  });

  it("contains no raster artwork", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: SCIFI_PLAN,
      profile: SCI_FI_STYLE_PROFILE,
    });
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).not.toContain("/Subtype/Image");
    expect(raw).not.toContain("/Subtype /Image");
  });

  it("fails closed on overflow instead of flattening layout", async () => {
    const base = buildRichDraft();
    const manyFields = Array.from({ length: 60 }, (_, i) => ({
      key: `extra_${i}`,
      label: `Extra ${i}`,
      type: "text" as const,
      locked: false,
    }));
    const draft = {
      ...base,
      fields: [...base.fields, ...manyFields],
      structure: [
        ...base.structure,
        ...manyFields.map((f) => ({ kind: "field" as const, key: f.key, parentKey: null })),
      ],
      layout: {
        schemaVersion: "1" as const,
        root: { columns: 1 },
        sections: {
          core: { columns: 1 },
          lore: { columns: 1 },
          nested: { columns: 1 },
        },
        nodes: {
          ...Object.fromEntries(
            [...base.fields, ...manyFields].map((f) => [f.key, { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false }]),
          ),
          core: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          lore: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          nested: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
      },
      values: { ...base.values },
    } as unknown as CharacterSheetDraftV2;
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    await expect(
      renderStyledCharacterSheetPdf({
        draft,
        resolvedValues: resolved,
        presentation: MEDIEVAL_PLAN,
        profile: MEDIEVAL_STYLE_PROFILE,
      }),
    ).rejects.toMatchObject({ code: "layout_overflow" });
  });

  it("rejects an unsupported presentation style", async () => {
    const draft = buildRichDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    await expect(
      renderStyledCharacterSheetPdf({
        draft,
        resolvedValues: resolved,
        presentation: {
          schemaVersion: "1",
          style: "fantasy",
          variant: "standard",
          ornamentDensity: "light",
          contrast: "medium",
          sectionEmphasis: "standard",
          fieldEmphasis: "standard",
        } as unknown as FinalPresentationPlanV1,
        profile: MEDIEVAL_STYLE_PROFILE,
      }),
    ).rejects.toBeInstanceOf(CharacterSheetPdfRenderError);
  });
});

export type { StyledDraftPdfManifest };
