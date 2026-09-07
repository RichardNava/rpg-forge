# Phase 14.1 Production Contracts

**Status:** Implemented
**Date:** 2026-09-07

## Scope

Phase 14.1 introduces two framework-independent, serializable domain contracts:

- `@repo/rules-context` for normalized RPG rules analysis;
- `@repo/character-sheet-schema` for renderer-neutral player and NPC character-sheet specifications.

These packages are production domain contracts, not product features. They do
not create routes, UI, Workers, AI providers, R2 buckets, D1 tables, PDF
renderers, uploads, persistence, or generation workflows.

The Phase 14.0 contents in `spikes/phase-14/` remain isolated technical
evidence. The production packages do not import spike code or promote spike
schemas into product contracts.

## Canonical Schemas

ADR-054 establishes Zod 4 strict runtime schemas as the single source of truth.
Each package exports its canonical root schema and derives TypeScript types and
JSON Schema from it:

```text
Zod strict schema
    -> z.infer<typeof Schema>
    -> z.toJSONSchema(Schema)
```

Structural parsing and semantic validation remain separate. Consumers first
parse untrusted data with the root Zod schema, then call the exported domain
validator for uniqueness, referential-integrity, workflow, and graph checks.
This keeps validation deterministic and avoids a parallel AI-specific schema.

```text
Structural schema parse
    ↓
Domain graph validation
    ↓
RulesContext provenance validation when sourceMap is nonempty
```

## RulesContext

`RulesContextSchema` represents a normalized rule-analysis result with:

- metadata-only source variants for presets, temporary rulebook references, and chat;
- explicit source authority order;
- character intent kept separate from user-authored rule overrides;
- normalized rules with citation provenance and optional JSON values;
- explicit conflicts, user-recorded resolutions, and workflow status.

`validateRulesContextDomain()` requires every active source to appear exactly
once in `authorityOrder`. Authority order establishes precedence only; it never
automatically resolves a conflict. Citations must reference known sources and
respect known uploaded-rulebook page bounds. Unresolved conflicts cannot be
reported as ready, and resolved conflicts must retain an explicit resolution.

The contract stores source metadata only. It does not store document bytes,
extracted text, embeddings, vectors, or a user source library.
`uploaded-rulebook.temporary` is literal `true`; future upload integrations
must derive source integrity, ownership, and lifecycle metadata server-side.
Optional structured values are bounded JSON: at most eight nested containers,
128 array items or object properties per container, and 10,000 characters per
string.

## CharacterSheetSpec

`CharacterSheetSpecSchema` represents player and NPC sheets as a deterministic
page, section, and field graph. It includes:

- stable metadata and a `rulesContextId` link;
- bounded page and section layout intent;
- discriminated field variants for text, numbers, choices, ratings, resources,
  lists, tables, calculated values, and image slots;
- separate field values, theme intent, and rule/citation provenance;
- a safe Formula AST with literals, field references, arithmetic, min/max,
  rounding, and structured comparisons.

`validateCharacterSheetSpecDomain()` ensures every section belongs to one page,
every field belongs to one section, references resolve, layout columns fit,
playable NPC-required fields have values, and calculated-field references do
not form cycles. Field values must match their field variant, including choice
membership, numeric/rating bounds, list/table limits, and opaque image asset
references. Calculated and resource fields do not accept direct values.

An empty `sourceMap` can validate without RulesContext. A nonempty source map
requires a parsed RulesContext; otherwise validation returns
`PROVENANCE_CONTEXT_REQUIRED` and cannot report valid. When supplied, the
validator verifies the context ID, source-map rule/citation references,
uploaded-rulebook page bounds, and that every source-map citation belongs to
one of the referenced normalized rules. Citation membership uses a per-call
canonical citation index rather than repeated scans through every rule.

Formula AST validation does not evaluate expressions. The contract contains no
formula strings, executable code, HTML, CSS, SVG, PDF bytes, or image bytes.
Formula nesting is capped at eight operations to prevent recursive validation
from exhausting the runtime stack.

## Versioning And Dependencies

Both root payloads use `schemaVersion: "1"`. A future incompatible version must
add a new canonical schema and explicit migration at the persistence or
integration boundary. No migration framework is introduced before one is
needed.

The dependency direction is intentionally one-way:

```text
@repo/character-sheet-schema -> @repo/rules-context
```

`@repo/rules-context` has no application, infrastructure, renderer, or AI
dependency. `@repo/character-sheet-schema` consumes only stable RulesContext
identifiers, citations, JSON values, and optional parsed context data for
cross-contract validation.

## Verification

Each package has focused strict-parse, domain-validation, JSON-Schema, and
regression tests. Repository-level quality gates remain the verification
standard before integration.

## References

- [ADR-054: Zod 4 canonical schema](../adr/054-zod4-canonical-schema.md)
- [Phase 14.0 technical spikes](../spikes/phase-14/README.md)
