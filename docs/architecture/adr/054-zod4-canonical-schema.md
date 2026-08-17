# ADR-054 — Zod 4 as canonical runtime and JSON Schema source

**Status:** Accepted
**Date:** 17/08/2026

## Context

RPG Forge needs a single schema ecosystem for runtime validation and Workers AI structured output. Phase 14 evaluated three candidates (Zod 4, Valibot, ArkType) with equal runtime validation and equivalent JSON Schema output. The choice depends on ecosystem fit, not raw performance.

## Decision

```text
SCHEMA_ECOSYSTEM = Zod 4
SCHEMA_SOURCE_OF_TRUTH = z.strictObject() runtime schemas
JSON_SCHEMA_DERIVATION = z.toJSONSchema()
AI_OUTPUT_VALIDATION = response_format.json_schema → JSON → Zod safeParse()
INVARIANT_ENFORCEMENT = explicit post-structural checks (uniqueness, referential integrity)
```

### One canonical schema per domain type

`RulesContext` and `CharacterSheetSpec` have exactly ONE canonical Zod 4 runtime schema. The same schema is used for:

- Client-side form validation (React Hook Form)
- Server-side input validation
- Workers AI structured output generation via `z.toJSONSchema()`
- Generated output validation via `safeParse()`

### Structured output pipeline

```text
Zod 4 schema
    ↓
z.toJSONSchema() → JSON Schema object
    ↓
Workers AI response_format.json_schema constraint
    ↓
Model returns structured JSON
    ↓
Zod 4 safeParse() runtime validation
    ↓
Domain/business invariants enforced via superRefine() or post-parse checks
```

### Invariant enforcement

Structural validation is separate from semantic/business invariants:

- **Structural**: Zod `strictObject()` rejects undeclared keys; type, length, and range constraints catch malformed data.
- **Uniqueness/referential**: `superRefine()` checks duplicate IDs, orphan references, and cross-field consistency.
- **Semantic/security**: Prompt-injection resistance is measured independently. A structurally valid object containing malicious text as a legitimate rule is `SECURITY = FAIL`.

### No dual schemas

Do not maintain separate AI-specific schemas unless a future verified platform limitation makes this unavoidable. The canonical Zod schema is the single source for both runtime and AI contexts.

## Rejected alternatives

### Valibot

- Excellent bundle characteristics (2.2 KB gzipped vs Zod 63 KB).
- `@valibot/to-json-schema` is a separate package and throws on `v.trim()` transformations.
- Maintaining dual schemas (one with `trim()`, one without) for JSON Schema generation introduces unnecessary complexity.
- No demonstrated functional advantage for RPG Forge's schema complexity.

### ArkType

- Technically viable with fastest valid-input performance.
- String syntax (`"1<=string<=80"`) has a steeper learning curve.
- Smaller ecosystem and community than Zod.
- No demonstrated architectural advantage sufficient to justify a different schema ecosystem.

### Bundle size

Valibot's 29× gzipped size advantage is real but not material for this workload. RPG Forge's schemas are small; the absolute difference is ~60 KB. Validation performance differences (1.7–50 µs/op) are below any practical bottleneck.

## Consequences

- All new domain schemas use `z.strictObject()` from Zod 4.
- `z.toJSONSchema()` is the sole JSON Schema derivation path.
- Workers AI structured output uses `response_format.json_schema` with the derived schema.
- Generated output is validated with `z.safeParse()`; rejected output triggers retry.
- Business/uniqueness invariants live in `superRefine()` or post-parse validators, not in separate schema copies.
- ADR-010 (React Hook Form + Zod 4) is reinforced: the same schemas serve client and server.

## Related ADRs

- ADR-005 — AI provider abstraction
- ADR-010 — Forms validation (React Hook Form + Zod 4)
- ADR-012 — Workers AI binding