import {
  initialDraftVersion,
  type CharacterSheetDraft,
  type DraftField,
  type DraftSection,
  type DraftValue,
} from "@repo/character-sheet-draft";
import {
  ExtractedCharacterStructureSchema,
  type ExtractedCharacterNode,
  type ExtractedCharacterStructure,
} from "./extracted-character-structure.js";

export function compileExtractedCharacterStructure(input: {
  structure: ExtractedCharacterStructure;
  sessionId: string;
  sourceSheetId: string | null;
}): CharacterSheetDraft {
  const structure = ExtractedCharacterStructureSchema.parse(input.structure);
  const fields: DraftField[] = [];
  const sections: DraftSection[] = [];
  const values: Record<string, DraftValue> = {};
  const used = new Set<string>();
  const visit = (
    nodes: readonly ExtractedCharacterNode[],
    parentKey?: string,
  ) => {
    for (const node of nodes) {
      if (node.kind === "section") {
        const key = uniqueKey(node.label, used);
        sections.push({
          key,
          title: node.label,
          ...(parentKey === undefined ? {} : { parentKey }),
          fieldKeys: [],
        });
        visit(node.children, key);
        continue;
      }
      const key = uniqueKey(node.label, used);
      const type =
        node.control.kind === "rating" ? "number" : node.control.kind;
      const field: DraftField = {
        key,
        label: node.label,
        type,
        locked: false,
        ...(type === "number" && node.control.constraints?.min !== undefined
          ? { min: node.control.constraints.min }
          : {}),
        ...(type === "number" && node.control.constraints?.max !== undefined
          ? { max: node.control.constraints.max }
          : {}),
        ...(type === "choice" && node.control.constraints?.options !== undefined
          ? { options: node.control.constraints.options }
          : {}),
      };
      fields.push(field);
      if (parentKey !== undefined)
        sections
          .find((section) => section.key === parentKey)
          ?.fieldKeys.push(key);
      if (node.value !== undefined && valueMatches(type, node.value))
        values[key] = node.value;
    }
  };
  visit(structure.nodes);
  if (fields.length === 0)
    throw new Error("Observed structure contains no editable fields.");
  return initialDraftVersion({
    schemaVersion: "1",
    draftId: crypto.randomUUID(),
    sessionId: input.sessionId,
    mode: "pc",
    characterName: null,
    rulesContextId: null,
    fields,
    values,
    ...(sections.length === 0 ? {} : { sections }),
    source: { sourceSheetId: input.sourceSheetId, sourceRunId: null },
    confirmed: false,
  });
}

function uniqueKey(label: string, used: Set<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field";
  let key = base.slice(0, 120);
  let suffix = 2;
  while (used.has(key))
    key = `${base.slice(0, 120 - String(suffix).length)}_${suffix++}`;
  used.add(key);
  return key;
}

function valueMatches(
  type: DraftField["type"],
  value: unknown,
): value is DraftValue {
  return (
    (type === "number" && typeof value === "number") ||
    ((type === "text" || type === "textarea" || type === "choice") &&
      typeof value === "string") ||
    (type === "checkbox" && typeof value === "boolean") ||
    (type === "list" &&
      Array.isArray(value) &&
      value.every((item) => typeof item === "string"))
  );
}
