# 05 — Schema Library Comparison

**Spike:** Phase 14.0
**Date:** 2026-08-17
**Status:** Complete — pending human architecture decision
**Decision required:** Which schema validation library for RPG Forge?

---

## Executive Summary

Three TypeScript schema validation libraries — **Zod 4**, **Valibot 1.4**, and **ArkType 2.2** — were evaluated against RPG Forge's two canonical schemas (`RuleAnalysisSpikeResult` and `CharacterSheetSpikeSpec`). All three produce **behaviorally equivalent** runtime validation and **logically equivalent** JSON Schema output. The choice depends on which dimensions matter most.

**Weighted scoring:**

| Rank | Library | Score |
| ---- | ------- | ----- |
| 1    | Valibot | 8.70  |
| 2    | Zod 4   | 8.30  |
| 3    | ArkType | 7.90  |

**Recommendation:** Zod 4 (default) or Valibot (if bundle size is critical).

---

## 1. Libraries Tested

| Library | Version | Install Size (node_modules) | Source Chars |
| ------- | ------- | --------------------------- | ------------ |
| Zod     | 4.4.3   | ~4,451 KB                   | 2,015        |
| Valibot | 1.4.2   | ~1,809 KB                   | 2,809        |
| ArkType | 2.2.3   | ~329 KB                     | 1,631        |

---

## 2. Runtime Validation Performance

Measured with 10,000 iterations on identical input.

### RuleAnalysisSpikeResult (valid input)

| Library | Time/op |
| ------- | ------- |
| ArkType | 1.67 µs |
| Valibot | 3.28 µs |
| Zod     | 5.02 µs |

### RuleAnalysisSpikeResult (invalid: page=1.5)

| Library | Time/op  |
| ------- | -------- |
| Valibot | 4.40 µs  |
| ArkType | 17.74 µs |
| Zod     | 44.47 µs |

### CharacterSheetSpikeSpec (valid input)

| Library | Time/op |
| ------- | ------- |
| ArkType | 2.92 µs |
| Valibot | 6.88 µs |
| Zod     | 9.07 µs |

### CharacterSheetSpikeSpec (invalid: bad accent)

| Library | Time/op  |
| ------- | -------- |
| Valibot | 7.29 µs  |
| ArkType | 22.00 µs |
| Zod     | 50.88 µs |

**Key finding:** ArkType is fastest for valid input; Valibot is fastest for invalid input. Zod 4 is slower than both but still under 100 µs/op — well within any practical budget.

---

## 3. Bundle Size (Production-Relevant)

Bundled with esbuild, format=esm, minified:

| Library | Raw      | Gzipped |
| ------- | -------- | ------- |
| Valibot | 6.7 KB   | 2.2 KB  |
| ArkType | 150.8 KB | 46.2 KB |
| Zod     | 320.7 KB | 63.4 KB |

**Key finding:** Valibot is **29x smaller** than Zod when gzipped. This is Valibot's primary differentiator — it was designed specifically for minimal bundle impact via tree-shaking.

For Cloudflare Workers (where cold start and bundle size matter), this is significant. For a pure client-side application, the difference is less critical since all libraries are already fast.

---

## 4. JSON Schema Generation

### Capability

| Library | API                          | Target Support             | trim() support           |
| ------- | ---------------------------- | -------------------------- | ------------------------ |
| Zod     | `z.toJSONSchema()` (native)  | draft-07, 2020-12, OpenAI  | N/A (no trim in schemas) |
| Valibot | `@valibot/to-json-schema`    | draft-07, 2019-09, 2020-12 | **Throws error**         |
| ArkType | `.toJsonSchema()` (built-in) | draft-07, 2019-09, 2020-12 | N/A (no trim in schemas) |

### Valibot Limitation: trim() Incompatibility

Valibot's `v.trim()` is a transformation action (normalizes input at runtime). `@valibot/to-json-schema` cannot convert transformation actions to JSON Schema and throws:

```
Error: The "trim" action cannot be converted to JSON Schema.
```

**Workaround:** Create separate Valibot schemas without `trim()` for JSON Schema generation. The runtime schemas keep `trim()` for input normalization.

**Impact:** Minor — requires maintaining two schema variants if JSON Schema generation is needed. In RPG Forge, `trim()` is a nice-to-have normalization, not a security boundary.

### Generated JSON Schema Equivalence

All three libraries produce logically equivalent JSON Schema for both schemas:

- Same `$schema` target (draft-07)
- Same `additionalProperties: false` for strict objects
- Same `minLength`/`maxLength`, `minItems`/`maxItems`, `type: "integer"` constraints
- Only differences: property ordering, `exclusiveMinimum: 0` vs `minimum: 1` (semantically identical for integers)

### Performance (1,000 iterations)

| Library | Time/op   |
| ------- | --------- |
| ArkType | 16.58 µs  |
| Valibot | 25.05 µs  |
| Zod     | 241.25 µs |

---

## 5. Constraint Coverage (All Constraints Verified at Runtime)

| Constraint                     | Zod                      | Valibot                         | ArkType                                    |
| ------------------------------ | ------------------------ | ------------------------------- | ------------------------------------------ |
| String min/max length          | ✅                       | ✅                              | ✅ `"1<=string<=80"`                       |
| Array min/max length           | ✅                       | ✅                              | ✅ `.atLeastLength().atMostLength()`       |
| Integer validation             | ✅ `.int()`              | ✅ `v.integer()`                | ✅ `"number.integer"` or `.divisibleBy(1)` |
| Numeric min/max                | ✅ `.positive().max(12)` | ✅ `v.minValue(1).maxValue(12)` | ✅ `.moreThan(0).atMost(12)`               |
| Regex/pattern                  | ✅ `.regex()`            | ✅ `v.regex()`                  | ✅ `"/^#[0-9A-Fa-f]{6}$/"`                 |
| Nullable                       | ✅ `.nullable()`         | ✅ `v.nullable()`               | ✅ `.or("null")`                           |
| Enum/literal union             | ✅ `.enum()`             | ✅ `v.picklist()`               | ✅ `'"blank"                               | "prefilled"'` |
| Strict objects (no extra keys) | ✅ `z.strictObject()`    | ✅ `v.strictObject()`           | ✅ `{ "+": "reject" }`                     |
| JSON Schema generation         | ✅ native                | ⚠️ requires package + no trim   | ✅ built-in                                |

---

## 6. Developer Experience Comparison

### Zod 4

**Pros:**

- Most familiar API in the ecosystem (40M+ weekly npm downloads)
- Fluent method chaining is highly discoverable
- `z.toJSONSchema()` is native — no extra packages
- `z.strictObject()` works out of the box
- Best TypeScript IDE support and autocomplete
- Extensive documentation and community resources

**Cons:**

- Largest bundle size (63.4 KB gzipped)
- Slowest validation for invalid input (44.47 µs/op)
- Zod 4 changed some APIs from Zod 3 (migration cost if switching from existing code)

### Valibot 1.4

**Pros:**

- Smallest bundle size by far (2.2 KB gzipped) — designed for tree-shaking
- Fastest invalid-input validation (4.40 µs/op)
- `v.strictObject()` is built-in
- Pipe-based API is flexible and composable
- Good Drizzle ORM integration

**Cons:**

- `trim()` breaks `@valibot/to-json-schema` — needs workaround
- Pipe-based syntax is verbose for complex schemas
- Smaller ecosystem than Zod
- `@valibot/to-json-schema` is a separate package (extra dependency)

### ArkType 2.2

**Pros:**

- Fastest valid-input validation (1.67 µs/op)
- Smallest node_modules footprint (329 KB)
- String syntax is very compact: `"1<=string<=80"` vs `z.string().min(1).max(80)`
- Built-in JSON Schema generation with target selection
- `{ "+": "reject" }` syntax for strict objects

**Cons:**

- Largest gzipped bundle (46.2 KB) — not as tree-shakeable as Valibot
- String syntax is less discoverable (need to know the grammar)
- Some APIs have non-obvious names (`.divisibleBy(1)` for integer check)
- Smallest community and ecosystem of the three
- `configure()` import from `"arktype/config"` for global settings

---

## 7. Strict Object Behavior

All three libraries support rejecting undeclared keys:

| Library | Mechanism                                                | Per-object | Global config                              |
| ------- | -------------------------------------------------------- | ---------- | ------------------------------------------ |
| Zod     | `z.strictObject({...})`                                  | ✅         | N/A                                        |
| Valibot | `v.strictObject({...})`                                  | ✅         | N/A                                        |
| ArkType | `{ "+": "reject", ... }` or `.onUndeclaredKey("reject")` | ✅         | `configure({ onUndeclaredKey: "reject" })` |

All emit `additionalProperties: false` in generated JSON Schema.

---

## 8. JSON Schema Artifacts

Six artifacts generated and stored in `schema-comparison/artifacts/`:

```
rule-analysis.zod.json
rule-analysis.valibot.json
rule-analysis.arktype.json
sheet-spec.zod.json
sheet-spec.valibot.json
sheet-spec.arktype.json
```

All are logically equivalent. Minor cosmetic differences (property ordering, `exclusiveMinimum` vs `minimum` for integers).

---

## 9. Testing

**67 schema-comparison tests** across all three libraries covering:

- Valid input acceptance
- Invalid input rejection (empty strings, out-of-range numbers, non-integers, too many items, invalid enums, undeclared keys, bad regex)
- Domain invariants (duplicate IDs, referential integrity)
- JSON Schema generation
- Cross-library behavioral parity

All 67 tests pass. Full vitest suite (80 tests total) passes.

---

## 10. Recommendation

### For RPG Forge MVP: **Zod 4**

**Rationale:**

- RPG Forge is a Cloudflare Workers application. Bundle size matters, but 63 KB gzipped is within acceptable limits for a worker.
- Zod 4's ecosystem maturity means more community resources, better IDE support, and lower onboarding friction.
- Native `z.toJSONSchema()` eliminates the need for a separate conversion package.
- The performance difference (5 µs vs 1.7 µs for valid input) is irrelevant at RPG Forge's scale — neither will ever be a bottleneck.
- Zod 4 is already in the project's `package.json`.

### If bundle size is the top priority: **Valibot**

**Rationale:**

- 2.2 KB gzipped is 29x smaller than Zod. For a worker where every KB affects cold start, this is substantial.
- Faster invalid-input handling (4.40 µs vs 44.47 µs).
- Trade-off: `trim()` + JSON Schema workaround needed.

### ArkType: Not recommended

**Rationale:**

- While fastest for valid input, it has the smallest ecosystem.
- String syntax, while compact, has a steeper learning curve.
- Bundle size (46 KB gzipped) is between Zod and Valibot — no clear advantage in either direction.

---

## 11. Files in This Spike

```
schema-comparison/
  schemas/
    zod.ts              — Zod schema definitions
    valibot.ts          — Valibot schema definitions
    arktype.ts          — ArkType schema definitions
  invariants/
    zod.ts              — Zod domain invariant checks
    valibot.ts          — Valibot domain invariant checks
    arktype.ts          — ArkType domain invariant checks
  json-schema/
    zod.ts              — Zod JSON Schema generation
    valibot.ts          — Valibot JSON Schema generation (without trim)
    arktype.ts          — ArkType JSON Schema generation
  artifacts/
    rule-analysis.*.json — Generated JSON Schema (3 files)
    sheet-spec.*.json    — Generated JSON Schema (3 files)
  tests/
    schema-comparison.test.ts — 67 tests
  benchmark.ts          — Performance benchmarks
  generate-artifacts.ts — Artifact generation script
  measure-bundles.ts    — Bundle size measurement
  scoring.ts            — Weighted evaluation scoring
```

---

## 12. Not Tested

- Workers AI structured output (requires Cloudflare API credentials — tested separately in existing `structured-ai/` benchmark)
- Serialization/deserialization speed
- Schema composition / intersection
- Custom error message formatting
- Migration effort from Zod 3 to Zod 4

SCHEMA SPIKE COMPLETE — PENDING HUMAN ARCHITECTURE DECISION
