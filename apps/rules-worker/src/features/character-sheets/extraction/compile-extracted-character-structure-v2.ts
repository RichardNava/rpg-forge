import {
  initialDraftVersionV2,
  type CharacterSheetDraftV2,
  type DraftField,
  type DraftValue,
} from "@repo/character-sheet-draft";
import {
  ExtractedCharacterStructureSchema,
  type ExtractedCharacterNode,
  type ExtractedCharacterStructure,
} from "./extracted-character-structure.js";

/**
 * V2 registry/placement element types, DERIVED from the canonical draft type
 * rather than imported. `DraftSectionV2` and `DraftPlacement` are deliberately
 * private to the draft package, so deriving keeps the public surface unchanged:
 * a producer cannot accidentally widen the package API just to compile.
 */
type DraftSectionV2 = CharacterSheetDraftV2["sections"][number];
type DraftPlacement = CharacterSheetDraftV2["structure"][number];

/**
 * 4E2 — DIRECT V2 draft producer.
 *
 * This is the V2 counterpart of `compileExtractedCharacterStructure`. The V1
 * producer is left exactly as it is and remains the one wired into
 * `character-sheet-handler.ts`; nothing in this module is reachable from the
 * live runtime yet. The runtime switch is 4E3.
 *
 * ## Direct production, not migrate-after-V1
 *
 * The producer emits the canonical V2 shape on the FIRST pass. It never builds a
 * V1 draft and never calls `parseCanonicalCharacterSheetDraft` or
 * `migrateCharacterSheetDraftV1ToV2`. This matters structurally, not just
 * stylistically:
 *
 * - V1 represents hierarchy with `sections[].fieldKeys` and `sections[].parentKey`.
 *   V2 DROPS both and makes the flat `structure[]` placement array the only
 *   structural authority. Producing V1 first would mean inventing the V1 nesting
 *   only to throw it away, and it would let V1's nesting rules silently become
 *   V2's structural truth.
 * - A V1 intermediate would also make "is this draft canonical?" a two-hop
 *   question. Here the producer's own output is the single canonical artifact.
 *
 * ## Canonical preorder is produced, not repaired
 *
 * V2 requires `structure[]` to be in contiguous-subtree preorder: a section, then
 * its own fields, then its child sections. The walk below emits exactly that
 * order while descending the extracted tree, so `validateDraftV2`'s preorder
 * check passes on the producer's first attempt. The producer does not sort or
 * normalize afterwards; if the emitted order were wrong the gate would reject it
 * rather than quietly fix it.
 *
 * ## Gate
 *
 * `initialDraftVersionV2` owns validation: it assigns `version`/`baseVersion` and
 * runs `validateDraftV2` on the composed candidate as a GATE, rejecting invalid
 * output instead of repairing it. This producer therefore does not call
 * `validateDraftV2` a second time — one owner, one decision.
 *
 * ## Reference semantics
 *
 * The producer is pure. `ExtractedCharacterStructureSchema.parse` reads the input
 * and returns its own copy, every output collection is freshly built, and key
 * uniqueness is tracked in a call-local `Set`. The caller's structure object and
 * its nodes are never mutated, and two calls with equal input yield independent
 * outputs.
 */
export function compileExtractedCharacterStructureV2(input: {
  structure: ExtractedCharacterStructure;
  sessionId: string;
  sourceSheetId: string | null;
}): CharacterSheetDraftV2 {
  const structure = ExtractedCharacterStructureSchema.parse(input.structure);
  const fields: DraftField[] = [];
  const sections: DraftSectionV2[] = [];
  const structurePlacements: DraftPlacement[] = [];
  const values: Record<string, DraftValue> = {};
  const used = new Set<string>();

  const visit = (
    nodes: readonly ExtractedCharacterNode[],
    parentKey: string | null,
  ): void => {
    for (const node of nodes) {
      if (node.kind === "section") {
        const key = uniqueKey(node.label, used);
        // V2 sections are content-registry entries only: key and title. The
        // parent relationship lives in structure[], never in the section.
        sections.push({ key, title: node.label });
        structurePlacements.push({ kind: "section", key, parentKey });
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
      structurePlacements.push({ kind: "field", key, parentKey });
      // An observed value is kept only when it is actually type-compatible, so
      // a misread cell cannot poison a canonical draft.
      if (node.value !== undefined && valueMatches(type, node.value)) {
        if (key === "character_name" && typeof node.value !== "string") {
          // V2 requires `characterName` to mirror `values.character_name`. The
          // domain owns this invariant: `set_value` rejects a non-string
          // character_name, and `set_field_type`/`remove_field` drop the value
          // and null the mirror when the field stops being textual. An observed
          // character_name read as a number/bool/list follows the same rule, so
          // the producer satisfies the mirror BY CONSTRUCTION instead of
          // relying on the gate to catch it.
          continue;
        }
        values[key] = node.value;
      }
    }
  };

  visit(structure.nodes, null);

  if (fields.length === 0) {
    // Parity with the V1 producer, which throws the same plain Error with the
    // same message. The cutover must not change observable error behavior, so
    // this is intentionally NOT a DraftError. Revisiting the error taxonomy for
    // both producers is a separate decision, not something 4E2 may decide alone.
    throw new Error("Observed structure contains no editable fields.");
  }

  const nameValue = values["character_name"];

  return initialDraftVersionV2({
    schemaVersion: "2",
    draftId: crypto.randomUUID(),
    sessionId: input.sessionId,
    mode: "pc",
    // Mirrors an observed textual character_name, else null — the only two
    // states canonical V2 permits.
    characterName: typeof nameValue === "string" ? nameValue : null,
    rulesContextId: null,
    fields,
    sections,
    structure: structurePlacements,
    values,
    source: { sourceSheetId: input.sourceSheetId, sourceRunId: null },
    confirmed: false,
  });
}

/**
 * Derives a draft key from an observed label: accent-folded, lowercased,
 * reduced to the draft-key alphabet, then de-duplicated with a numeric suffix.
 * Truncation stays under `MAX_DRAFT_FIELD_KEY_CHARS` (128).
 */
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
