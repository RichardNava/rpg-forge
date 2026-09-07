# @repo/character-sheet-schema

Framework-independent production contract for deterministic character-sheet
rendering inputs. It represents player and NPC sheets with one canonical Zod 4
schema.

## Canonical schema

`CharacterSheetSpecSchema` is the single source of truth. Exported TypeScript
types are inferred from Zod schemas rather than mirrored in handwritten
interfaces.

Private recursive Formula AST helper types exist only to type the Zod schema
factory. They are not public contracts; exported Formula types remain
schema-derived.

The `schemaVersion: "1"` contract contains renderer-neutral page, section, and field
graphs; independent field values; a bounded theme; provenance; and a safe
formula AST. It contains no PDF bytes, images, CSS, HTML, SVG, or executable
formula strings.

Field values are bounded JSON and are checked against their field variant:
choice membership, numeric/rating ranges, list/table limits, and opaque image
asset references. Calculated and resource fields do not accept direct values.

## Validation

```text
Structural schema parse
    ↓
Domain graph validation
    ↓
RulesContext provenance validation when sourceMap is nonempty
```

1. Parse untrusted input with `CharacterSheetSpecSchema.safeParse()`.
2. Call `validateCharacterSheetSpecDomain()` to check graph references,
   orphaned or duplicated references, layout bounds, NPC-required values, and
   formula references/cycles.
3. Supply a parsed `RulesContext` whenever `sourceMap` contains provenance.
   Omitting it produces `PROVENANCE_CONTEXT_REQUIRED`, so the result cannot be
   valid. Sheets with an empty `sourceMap` may validate without RulesContext.

Context-aware provenance validation checks rule IDs, source IDs, page bounds,
and citation membership through indexes built once per validation call.

Every section appears exactly once in a page, and every field appears exactly
once in a section. This keeps layout deterministic for a future renderer.

## Formula AST

`FormulaSchema` supports literals, field references, arithmetic, min/max,
rounding, and structured conditional comparisons. It is validated only; no
formula evaluator exists in this package. Formula nesting is limited to eight
operations so malformed input cannot exhaust the validation stack.

## JSON Schema and versioning

`getCharacterSheetSpecJsonSchema()` derives JSON Schema through native Zod 4
`z.toJSONSchema()`. No generated artifacts are committed.

The root `schemaVersion` is the literal `"1"`. Future persisted contract changes can
introduce explicit schemas and migrations when needed; no migration framework
exists today.
