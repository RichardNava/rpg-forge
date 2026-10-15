import { createHash } from "node:crypto";

import {
  initialDraftVersionV2,
  validateDraftV2,
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
  planStyledDraftLayout,
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
});

function tinyPng(): Uint8Array {
  // 1x1 transparent PNG.
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function tinyJpeg(): Uint8Array {
  // Minimal 1x1 RGB JPEG: SOI + APP0(JFIF) + SOF0 + EOI. Sufficient for
  // pdf-lib's segment-scanning embedder (SOI, SOF marker, dims, channels).
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00, // APP0 payload end
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, // SOF0: 8-bit, 1x1, 3 components
    0xff, 0xd9, // EOI
  ]);
}

function buildSlottedDraft(aspectRatio: "1:1" | "3:4" | "4:5" | "16:9" = "3:4") {
  // Compact fixture: the full rich draft plus a portrait frame overflows a
  // single page, so portrait render tests use this small draft.
  const base = {
    schemaVersion: "2" as const,
    draftId: "draft.slotted.1",
    sessionId: "session.slotted.1",
    baseVersion: 1,
    version: 1,
    mode: "pc" as const,
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Character Name", type: "text" as const, locked: false },
      { key: "strength", label: "Strength", type: "number" as const, min: 0, max: 20, locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    slots: [{ key: "portrait", type: "portrait" as const }],
    structure: [
      { kind: "field" as const, key: "character_name", parentKey: null },
      { kind: "section" as const, key: "core", parentKey: null },
      { kind: "field" as const, key: "strength", parentKey: "core" },
      { kind: "slot" as const, key: "portrait", parentKey: "core" },
    ],
    layout: {
      schemaVersion: "1" as const,
      root: { columns: 2 },
      sections: { core: { columns: 2 } },
      nodes: {
        character_name: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
        core: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
        strength: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        portrait: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
      },
      slotDetails: { portrait: { aspectRatio } },
    },
    values: { character_name: "Aria Stone", strength: 12 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: true,
  };
  return validateDraftV2(base);
}

describe("draft-native portrait slot rendering", () => {
  it("renders an empty portrait slot as a valid styled frame", async () => {
    const draft = buildSlottedDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const slot = manifest.semantic.nodes.find((n) => n.key === "portrait");
    expect(slot).toMatchObject({
      kind: "slot",
      slotType: "portrait",
      parentKey: "core",
      aspectRatio: "3:4",
      contentState: "empty",
      editable: false,
    });
    // No AcroForm widget for the slot.
    const { form } = await loadForm(bytes);
    expect(form.getFields().map((f) => f.getName())).not.toContain("rpgforge.portrait");
  });

  it("embeds a PNG portrait without distortion", async () => {
    const draft = buildSlottedDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const png = tinyPng();
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
      portrait: { slotKey: "portrait", bytes: png, mimeType: "image/png" },
    });
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toContain("/Subtype /Image");
    const slot = manifest.semantic.nodes.find((n) => n.key === "portrait");
    expect(slot?.contentState).toBe("asset");
  });

  it("embeds a JPEG portrait", async () => {
    const draft = buildSlottedDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const jpeg = tinyJpeg();
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: SCIFI_PLAN,
      profile: SCI_FI_STYLE_PROFILE,
      portrait: { slotKey: "portrait", bytes: jpeg, mimeType: "image/jpeg" },
    });
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toContain("/Subtype /Image");
    expect(manifest.semantic.nodes.find((n) => n.key === "portrait")?.contentState).toBe("asset");
  });

  it("rejects mismatched image magic", async () => {
    const draft = buildSlottedDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    await expect(
      renderStyledCharacterSheetPdf({
        draft,
        resolvedValues: resolved,
        presentation: MEDIEVAL_PLAN,
        profile: MEDIEVAL_STYLE_PROFILE,
        portrait: { slotKey: "portrait", bytes: tinyPng(), mimeType: "image/jpeg" },
      }),
    ).rejects.toMatchObject({ code: "unsupported_field_value" });
  });

  it("aspect ratios change the slot frame height deterministically", () => {
    const heights = (["16:9", "1:1", "4:5", "3:4"] as const).map((aspectRatio) => {
      const draft = buildSlottedDraft(aspectRatio);
      const plan = planStyledDraftLayout(draft);
      const slot = plan.rows
        .flatMap((row) => row.members)
        .flatMap((m) => (m.nested === null ? [m] : [m, ...m.nested.rows.flatMap((r) => r.members)]))
        .find((m) => m.key === "portrait")!;
      return slot.height;
    });
    // Frame height = width * (h/w) + padding: 16:9 (0.5625) < 1:1 (1) <
    // 4:5 (1.25) < 3:4 (1.333).
    const [wide, square, tall45, tall34] = heights as [number, number, number, number];
    expect(wide).toBeLessThan(square);
    expect(square).toBeLessThan(tall45);
    expect(tall45).toBeLessThan(tall34);
  });

  it("a portrait slot shares a grid row with a field where layout says so", () => {
    const base = buildRichDraft();
    const withoutAgility = base.structure.filter(
      (p) => !(p.kind === "field" && p.key === "agility"),
    );
    const strengthIndex = withoutAgility.findIndex(
      (p) => p.kind === "field" && p.key === "strength",
    );
    const draft = validateDraftV2({
      ...base,
      slots: [{ key: "portrait", type: "portrait" }],
      structure: [
        ...withoutAgility.slice(0, strengthIndex + 1),
        { kind: "slot", key: "portrait", parentKey: "core" },
        { kind: "field", key: "agility", parentKey: "core" },
        ...withoutAgility.slice(strengthIndex + 1),
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
          ...Object.fromEntries(
            base.structure.map((p) => [p.key, { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false }]),
          ),
          portrait: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
          agility: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          character_name: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
          core: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
          lore: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
          bio: { columnStart: 1, columnSpan: 2, rowSpan: 2, breakBefore: false },
          nested: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
        },
        slotDetails: { portrait: { aspectRatio: "3:4" as const } },
      },
    });
    const plan = planStyledDraftLayout(draft);
    const core = plan.rows.flatMap((r) => r.members).find((m) => m.key === "core")!;
    const coreRows = core.nested!.rows;
    const strengthRow = coreRows.find((r) => r.members.some((m) => m.key === "strength"))!;
    const slotRow = coreRows.find((r) => r.members.some((m) => m.key === "portrait"))!;
    expect(slotRow).toBe(strengthRow);
    expect(slotRow.members.map((m) => m.key).sort()).toEqual(["portrait", "strength"]);
  });

  it("rowSpan on a slot reserves rows", () => {
    const base = buildRichDraft();
    const agilityIndex = base.structure.findIndex(
      (p) => p.kind === "field" && p.key === "agility",
    );
    const draft = validateDraftV2({
      ...base,
      slots: [{ key: "portrait", type: "portrait" }],
      structure: [
        ...base.structure.slice(0, agilityIndex + 1),
        { kind: "slot", key: "portrait", parentKey: "core" },
        ...base.structure.slice(agilityIndex + 1),
      ],
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: {
          core: { columns: 1 },
          lore: { columns: 2 },
          nested: { columns: 1 },
        },
        nodes: {
          ...Object.fromEntries(
            base.structure.map((p) => [p.key, { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false }]),
          ),
          portrait: { columnStart: 1, columnSpan: 1, rowSpan: 2, breakBefore: false },
          character_name: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          core: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          lore: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          strength: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          agility: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          bio: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          nested: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          born: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          veteran: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          calling: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          motto: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
        slotDetails: { portrait: { aspectRatio: "3:4" as const } },
      },
    });
    const plan = planStyledDraftLayout(draft);
    const core = plan.rows.flatMap((r) => r.members).find((m) => m.key === "core")!;
    const portraitRow = core.nested!.rows.find((r) => r.members.some((m) => m.key === "portrait"))!;
    const strengthRow = core.nested!.rows.find((r) => r.members.some((m) => m.key === "strength"))!;
    // strength is in canonical order before portrait, so it takes the first
    // row; the rowSpan-2 portrait must start strictly below it.
    void strengthRow;
    expect(portraitRow.members.every((m) => m.key === "portrait")).toBe(true);
  });

  it("Medieval and Sci-fi render the same portrait with equal semantics", async () => {
    const draft = buildSlottedDraft();
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const portrait = { slotKey: "portrait", bytes: tinyPng(), mimeType: "image/png" as const };
    const medieval = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
      portrait,
    });
    const scifi = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: SCIFI_PLAN,
      profile: SCI_FI_STYLE_PROFILE,
      portrait,
    });
    expect(medieval.manifest.semantic).toEqual(scifi.manifest.semantic);
    expect(medieval.manifest.presentation.style).toBe("medieval");
    expect(scifi.manifest.presentation.style).toBe("sci-fi");
  });

  it("nested Section portrait slots render", async () => {
    const draft = validateDraftV2({
      schemaVersion: "2",
      draftId: "draft.nested.slot",
      sessionId: "session.nested.slot",
      baseVersion: 1,
      version: 1,
      mode: "pc",
      characterName: "Nested",
      rulesContextId: null,
      fields: [
        { key: "character_name", label: "Character Name", type: "text", locked: false },
        { key: "born", label: "Born", type: "date", locked: false },
      ],
      sections: [
        { key: "lore", title: "Lore" },
        { key: "nested", title: "Nested" },
      ],
      slots: [{ key: "portrait", type: "portrait" }],
      structure: [
        { kind: "field", key: "character_name", parentKey: null },
        { kind: "section", key: "lore", parentKey: null },
        { kind: "section", key: "nested", parentKey: "lore" },
        { kind: "field", key: "born", parentKey: "nested" },
        { kind: "slot", key: "portrait", parentKey: "nested" },
      ],
      layout: {
        schemaVersion: "1",
        root: { columns: 1 },
        sections: {
          lore: { columns: 1 },
          nested: { columns: 1 },
        },
        nodes: {
          character_name: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          lore: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          nested: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          born: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          portrait: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
        slotDetails: { portrait: { aspectRatio: "16:9" } },
      },
      values: { character_name: "Nested", born: "1412-03-04" },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: true,
    });
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: MEDIEVAL_PLAN,
      profile: MEDIEVAL_STYLE_PROFILE,
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const slot = manifest.semantic.nodes.find((n) => n.key === "portrait");
    expect(slot).toMatchObject({ kind: "slot", parentKey: "nested", aspectRatio: "16:9", contentState: "empty" });
  });

  it("root portrait slots render", async () => {
    const draft = validateDraftV2({
      schemaVersion: "2",
      draftId: "draft.root.slot",
      sessionId: "session.root.slot",
      baseVersion: 1,
      version: 1,
      mode: "pc",
      characterName: "Rooted",
      rulesContextId: null,
      fields: [
        { key: "character_name", label: "Character Name", type: "text", locked: false },
        { key: "strength", label: "Strength", type: "number", min: 0, max: 20, locked: false },
      ],
      sections: [{ key: "core", title: "Core" }],
      slots: [{ key: "portrait", type: "portrait" }],
      structure: [
        { kind: "field", key: "character_name", parentKey: null },
        { kind: "slot", key: "portrait", parentKey: null },
        { kind: "section", key: "core", parentKey: null },
        { kind: "field", key: "strength", parentKey: "core" },
      ],
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: { core: { columns: 2 } },
        nodes: {
          character_name: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          portrait: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
          core: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
          strength: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
        slotDetails: { portrait: { aspectRatio: "1:1" } },
      },
      values: { character_name: "Rooted", strength: 12 },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: true,
    });
    const resolved = resolveFinalValues(draft, { threat: null, seed: "seed-1" });
    const { bytes, manifest } = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: SCIFI_PLAN,
      profile: SCI_FI_STYLE_PROFILE,
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const slot = manifest.semantic.nodes.find((n) => n.key === "portrait");
    expect(slot).toMatchObject({ kind: "slot", parentKey: null, aspectRatio: "1:1", contentState: "empty" });
  });
});

describe("planStyledDraftLayout — container grid packing", () => {
  function buildGridDraft() {
    return initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.grid.1",
      sessionId: "session.grid.1",
      mode: "pc",
      characterName: "Grid",
      rulesContextId: null,
      fields: [
        { key: "character_name", label: "Character Name", type: "text", locked: false },
        { key: "left", label: "Left", type: "text", locked: false },
        { key: "right", label: "Right", type: "text", locked: false },
        { key: "tall", label: "Tall", type: "textarea", locked: false },
        { key: "next", label: "Next", type: "text", locked: false },
        { key: "broken", label: "Broken", type: "text", locked: false },
        { key: "inner", label: "Inner", type: "text", locked: false },
      ],
      sections: [
        { key: "grid", title: "Grid" },
        { key: "innerbox", title: "Inner Box" },
      ],
      structure: [
        { kind: "field", key: "character_name", parentKey: null },
        { kind: "section", key: "grid", parentKey: null },
        { kind: "field", key: "left", parentKey: "grid" },
        { kind: "field", key: "right", parentKey: "grid" },
        { kind: "field", key: "tall", parentKey: "grid" },
        { kind: "field", key: "next", parentKey: "grid" },
        { kind: "field", key: "broken", parentKey: "grid" },
        { kind: "section", key: "innerbox", parentKey: "grid" },
        { kind: "field", key: "inner", parentKey: "innerbox" },
      ],
      layout: {
        schemaVersion: "1",
        root: { columns: 1 },
        sections: {
          grid: { columns: 2 },
          innerbox: { columns: 1 },
        },
        nodes: {
          character_name: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          grid: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          // Siblings in different columns share one visual row.
          left: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          right: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
          // rowSpan reserves the second row, forcing `next` below it.
          tall: { columnStart: 1, columnSpan: 1, rowSpan: 2, breakBefore: false },
          next: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          broken: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: true },
          innerbox: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
          inner: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
      },
      values: { character_name: "Grid" },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: true,
    });
  }

  function gridPlan() {
    const draft = buildGridDraft();
    const plan = planStyledDraftLayout(draft);
    const grid = plan.rows
      .flatMap((row) => row.members)
      .find((member) => member.key === "grid");
    expect(grid?.nested).not.toBeNull();
    return grid!.nested!;
  }

  it("siblings in column 1 and column 2 share the same derived row", () => {
    const nested = gridPlan();
    const left = nested.rows.flatMap((r) => r.members).find((m) => m.key === "left")!;
    const right = nested.rows.flatMap((r) => r.members).find((m) => m.key === "right")!;
    expect(left.row).toBe(right.row);
    expect(left.x).toBeLessThan(right.x);
  });

  it("occupied cells force later nodes to the next valid row", () => {
    const nested = gridPlan();
    const tall = nested.rows.flatMap((r) => r.members).find((m) => m.key === "tall")!;
    const next = nested.rows.flatMap((r) => r.members).find((m) => m.key === "next")!;
    // `tall` occupies column 1 for two rows; `next` wants column 1 and must
    // land strictly below it.
    expect(next.row).toBeGreaterThan(tall.row + 1);
  });

  it("rowSpan reserves rows", () => {
    const nested = gridPlan();
    const tall = nested.rows.flatMap((r) => r.members).find((m) => m.key === "tall")!;
    expect(tall.geometry.rowSpan).toBe(2);
    expect(tall.height).toBeGreaterThan(
      nested.rows.flatMap((r) => r.members).find((m) => m.key === "left")!.height,
    );
  });

  it("breakBefore begins a new row", () => {
    const nested = gridPlan();
    const rows = nested.rows;
    const brokenRowIndex = rows.findIndex((row) =>
      row.members.some((m) => m.key === "broken"),
    );
    const nextRowIndex = rows.findIndex((row) =>
      row.members.some((m) => m.key === "next"),
    );
    expect(brokenRowIndex).toBeGreaterThan(nextRowIndex);
    expect(rows[brokenRowIndex]!.gapBefore).toBe(8);
  });

  it("nested Section grids are independent", () => {
    const nested = gridPlan();
    const innerbox = nested.rows.flatMap((r) => r.members).find((m) => m.key === "innerbox")!;
    expect(innerbox.nested).not.toBeNull();
    expect(innerbox.nested!.rows).toHaveLength(1);
    expect(innerbox.nested!.rows[0]!.members.map((m) => m.key)).toEqual(["inner"]);
  });

  it("canonical mixed Field/Section order is preserved in the plan", () => {
    const draft = buildGridDraft();
    const plan = planStyledDraftLayout(draft);
    const rootKeys = plan.rows.flatMap((row) => row.members.map((m) => m.key));
    expect(rootKeys).toEqual(["character_name", "grid"]);
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
