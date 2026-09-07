# @repo/rules-context

Framework-independent production contract for normalized RPG rule analysis.

## Canonical schema

`RulesContextSchema` is the single source of truth. Exported TypeScript types
are inferred with `z.infer<typeof RulesContextSchema>`; no separate domain
interfaces mirror the schema.

The private recursive JSON helper type exists only to type the Zod schema
factory. It is not a public contract; exported `JsonValue` remains schema-derived.

The root contract has `schemaVersion: "1"` and contains metadata-only rule sources,
user-configurable authority order, character intent, rule overrides,
normalized rules with citations, conflicts, and workflow status.

`structuredValue` accepts bounded JSON only: eight nested containers, 128 array
items or object properties per container, and strings up to 10,000 characters.
Rulebook metadata is descriptive and always temporary in this version; future
upload integrations must derive integrity, ownership, and lifecycle metadata
server-side.

## Validation

1. Parse untrusted input with `RulesContextSchema.safeParse()`.
2. Call `validateRulesContextDomain()` after parsing to check source IDs,
   authority completeness, citation provenance, conflict references, and status
   invariants.

Every active source appears exactly once in `authorityOrder`. Authority order
does not resolve conflicts by itself: unresolved conflicts remain explicit
until a user-recorded resolution exists.

Citation page ranges are rejected structurally. Domain validation additionally
checks source existence and uploaded-rulebook page bounds.

`characterIntent` expresses a requested outcome and is deliberately separate
from authority-bearing `ruleOverrides`.

## JSON Schema

Call `getRulesContextJsonSchema()` to derive JSON Schema with native Zod 4
`z.toJSONSchema()`. No generated schema artifacts are committed.

## Versioning

The root `schemaVersion` is the literal `"1"`. Future versions can add a new
canonical schema and explicit migration logic when persisted contracts require
it; this package does not provide a migration framework today.
