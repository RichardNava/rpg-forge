import { describe, expect, it } from "vitest";
import {
  CharacterSheetGenerationRequestSchema,
  NPCGenerationRequestSchema,
  PCGenerationRequestSchema,
} from "./authoring.js";
import {
  normalizeGuiSource,
  NormalizedGuiSourceSchema,
} from "./gui-normalization.js";
import { CanonicalFieldKeySchema } from "./source-resolution.js";

function parsePc(body: Record<string, unknown>) {
  return PCGenerationRequestSchema.parse(body);
}

function parseNpc(body: Record<string, unknown>) {
  return NPCGenerationRequestSchema.parse(body);
}

describe("normalizeGuiSource", () => {
  it("normalizes a PC request deterministically with GUI provenance only", () => {
    const request = parsePc({
      mode: "pc",
      characterName: "Arya",
      mechanicalFields: [
        { label: "Strength", initialValue: 14 },
        { label: "Vigor" },
      ],
      identityTraits: [{ label: "Race", value: "Dwarf" }],
    });

    const normalized = normalizeGuiSource(request);

    expect(normalized.characterName).toBe("Arya");
    expect(normalized.fields).toHaveLength(3);
    const [strength, vigor, race] = normalized.fields;
    expect(strength).toMatchObject({
      canonicalKey: "strength",
      label: "Strength",
      category: "mechanical",
      explicitValue: 14,
      provenance: { origins: ["gui"] },
    });
    expect(vigor).toMatchObject({
      canonicalKey: "vigor",
      label: "Vigor",
      category: "mechanical",
      explicitValue: null,
      provenance: { origins: ["gui"] },
    });
    expect(race).toMatchObject({
      canonicalKey: "race",
      label: "Race",
      category: "identity",
      explicitValue: "Dwarf",
      provenance: { origins: ["gui"] },
    });
  });

  it("keeps a blank PC mechanical value blank without inventing a number", () => {
    const omitted = normalizeGuiSource(
      parsePc({ mode: "pc", mechanicalFields: [{ label: "Hit Points" }] }),
    );
    expect(omitted.fields[0]?.explicitValue).toBeNull();

    const explicitNull = normalizeGuiSource(
      parsePc({
        mode: "pc",
        mechanicalFields: [{ label: "Hit Points", initialValue: null }],
      }),
    );
    expect(explicitNull.fields[0]?.explicitValue).toBeNull();
  });

  it("preserves the authoritative GUI display label exactly", () => {
    const normalized = normalizeGuiSource(
      parsePc({
        mode: "pc",
        mechanicalFields: [{ label: "  Armor Class  ", initialValue: 15 }],
      }),
    );
    expect(normalized.fields[0]).toMatchObject({
      canonicalKey: "armor_class",
      label: "  Armor Class  ",
    });
  });

  it("preserves an NPC range and never assigns an explicit value", () => {
    const normalized = normalizeGuiSource(
      parseNpc({
        mode: "npc",
        disposition: "enemy",
        threat: "boss",
        mechanicalFields: [{ label: "Strength", min: 3, max: 18 }],
      }),
    );

    const strength = normalized.fields[0];
    expect(strength).toMatchObject({
      canonicalKey: "strength",
      label: "Strength",
      category: "mechanical",
      permittedValueRange: { min: 3, max: 18 },
    });
    expect(strength).not.toHaveProperty("explicitValue");
    expect(normalized.npc).toEqual({ disposition: "enemy", threat: "boss" });
  });

  it("preserves a min == max NPC range as a fixed constraint", () => {
    const normalized = normalizeGuiSource(
      parseNpc({
        mode: "npc",
        disposition: "ally",
        mechanicalFields: [{ label: "Fixed", min: 7, max: 7 }],
      }),
    );
    expect(normalized.fields[0]?.permittedValueRange).toEqual({
      min: 7,
      max: 7,
    });
    expect(normalized.fields[0]).not.toHaveProperty("explicitValue");
    expect(normalized.npc).toEqual({ disposition: "ally", threat: null });
  });

  it("keeps mechanical and identity categories distinct even for the same label", () => {
    const normalized = normalizeGuiSource(
      parsePc({
        mode: "pc",
        mechanicalFields: [{ label: "Strength", initialValue: 14 }],
        identityTraits: [{ label: "Strength", value: "Of the mountain" }],
      }),
    );
    const [mechanical, identity] = normalized.fields;
    expect(mechanical?.category).toBe("mechanical");
    expect(mechanical?.explicitValue).toBe(14);
    expect(identity?.category).toBe("identity");
    expect(identity?.explicitValue).toBe("Of the mountain");
  });

  it("preserves explicit characterName in both PC and NPC", () => {
    const pc = normalizeGuiSource(
      parsePc({ mode: "pc", characterName: "Gruk the Reaver" }),
    );
    const npc = normalizeGuiSource(
      parseNpc({
        mode: "npc",
        disposition: "enemy",
        threat: "weak",
        characterName: "Gruk",
      }),
    );
    expect(pc.characterName).toBe("Gruk the Reaver");
    expect(npc.characterName).toBe("Gruk");
  });

  it("keeps a blank or omitted characterName as open intent in both PC and NPC", () => {
    const pcOmitted = normalizeGuiSource(parsePc({ mode: "pc" }));
    const pcBlank = normalizeGuiSource(
      parsePc({ mode: "pc", characterName: "   " }),
    );
    const npcOmitted = normalizeGuiSource(
      parseNpc({ mode: "npc", disposition: "enemy", threat: "weak" }),
    );
    const npcBlank = normalizeGuiSource(
      parseNpc({
        mode: "npc",
        disposition: "enemy",
        threat: "weak",
        characterName: "",
      }),
    );
    expect(pcOmitted.characterName).toBeNull();
    expect(pcBlank.characterName).toBeNull();
    expect(npcOmitted.characterName).toBeNull();
    expect(npcBlank.characterName).toBeNull();
  });

  it("preserves raw request state without interpreting it", () => {
    const normalized = normalizeGuiSource(
      parsePc({
        mode: "pc",
        contextInstructions: "Name the character Gruk.",
        outputLocale: "en-US",
        visualStyle: "classic",
        history: "A veteran explorer.",
        portrait: { kind: "url", url: "https://example.com/portrait.png" },
      }),
    );
    expect(normalized.contextInstructions).toBe("Name the character Gruk.");
    expect(normalized.outputLocale).toBe("en-US");
    expect(normalized.visualStyle).toBe("classic");
    expect(normalized.history).toBe("A veteran explorer.");
    expect(normalized.portrait).toEqual({
      kind: "url",
      url: "https://example.com/portrait.png",
    });
  });

  it("always yields canonical keys for every normalized field", () => {
    const normalized = normalizeGuiSource(
      parsePc({
        mode: "pc",
        mechanicalFields: [{ label: "戦闘 Value", initialValue: 7 }],
        identityTraits: [
          { label: "Сила", value: "Foes fall." },
          { label: "魔法 Power", value: "Secret arts." },
        ],
      }),
    );
    for (const field of normalized.fields) {
      expect(
        CanonicalFieldKeySchema.safeParse(field.canonicalKey).success,
      ).toBe(true);
    }
  });

  it("produces a schema-valid normalized GUI source (GUI-only domain support)", () => {
    const request = CharacterSheetGenerationRequestSchema.parse({
      mode: "pc",
      mechanicalFields: [
        { label: "Strength", initialValue: 14 },
        { label: "Vigor" },
      ],
      identityTraits: [
        { label: "Race", value: "Dwarf" },
        { label: "Homeland", value: null },
      ],
    });

    const normalized = normalizeGuiSource(request);
    expect(NormalizedGuiSourceSchema.safeParse(normalized).success).toBe(true);
    expect(normalized.fields).toHaveLength(4);
    expect(normalized.fields.map((field) => field.canonicalKey)).toEqual([
      "strength",
      "vigor",
      "race",
      "homeland",
    ]);
  });
});
