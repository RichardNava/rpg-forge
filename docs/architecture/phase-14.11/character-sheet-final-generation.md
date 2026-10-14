# Phase 14.11 — Final Generation Contract

**Status:** COMPLETED
**Date:** 10/14/2026

## Summary

Phase 14.11 completes the Character Sheets MVP by defining the canonical final generation contract — the single request surface that carries a confirmed Draft plus presentation options to the generation endpoint. This is the boundary between the authoring surface (Canvas, Workshop, draft mutations) and the generation pipeline (AI text, AI image, PDF rendering).

## Deliverables

### 1. Canonical Final Generation Request (`FinalGenerationRequestV1`)

**Location:** `packages/character-sheet-generation/src/final-generation-contract.ts`

```typescript
{
  schemaVersion: "1",
  draft: CharacterSheetDraftV2,        // confirmed draft, threat stripped
  options: {
    threat?: "very-low" | "low" | "medium" | "elite" | "legendary",  // NPC only
    visualStyle?: "medieval" | "fantasy" | "gothic" | "steampunk" | "sci-fi" | "contemporary",
    instructions?: string | null,      // bounded, optional
    portrait: { kind: "none" },        // 14.11 boundary: none-only
  },
  seed: string                         // one required seed at top level
}
```

- `draft` carries the full confirmed Draft (content preserved exactly)
- `threat` is ONLY in `options` for NPC mode; stripped from Draft
- `visualStyle` references the strict enum from `authoring.ts`
- `portrait` is discriminated union; only `kind: "none"` valid in 14.11
- `seed` at top level is the single source of randomness (required, non-empty, max 64)

### 2. Factory Function: `buildFinalGenerationRequestV1(draft, options)`

- Validates preconditions:
  - `draft.confirmed === true` (throws otherwise)
  - PC draft + `options.threat` → throws ("PC draft cannot have threat")
  - NPC draft + no `options.threat` → throws ("NPC draft requires threat")
- Returns plain object matching `FinalGenerationRequestV1Schema`
- `options.threat` overrides any `draft.threat` (Draft threat is ignored)
- `portrait` defaults to `{ kind: "none" }`
- `instructions` defaults to `null`

### 3. Canonical 5-Level NPC Threat Schema

Replaces previous: `weak`, `ordinary`, `dangerous`, `elite`, `boss`

```
very-low → 0.15 bias
low      → 0.35 bias
medium   → 0.50 bias
elite    → 0.85 bias
legendary→ 0.95 bias
```

- Machine keys: `very-low`, `low`, `medium`, `elite`, `legendary`
- UI labels: Very low, Low, Medium, Elite, Legendary
- Bias windows: ±0.15 around tier bias, clamped to [0, 1]

**Updated files:**
- `packages/character-sheet-generation/src/authoring.ts` (NPCThreatLevelSchema)
- `packages/character-sheet-generation/src/final-construction.ts` (THREAT_BIAS)
- `packages/character-sheet-generation/src/final-generation-contract.ts` (ThreatLevelSchema)
- All test files migrated to new threat levels

### 4. `set_mode` Mutation (no `confirmClear`)

**Location:** `packages/character-sheet-draft/src/draft-mode-mutation-v2.ts`

```typescript
{ op: "set_mode", mode: "pc" | "npc" }
```

- Switches `Draft.mode` between `"pc"` and `"npc"`
- Preserves ALL content: fields, values, sections, structure, layout, characterName, rulesContextId, source
- No `confirmClear` — mode changes are non-destructive
- Version increments; baseVersion unchanged
- If mode unchanged, returns same draft (no-op)

**Integrated into:** `packages/character-sheet-draft/src/draft-mutation-v2.ts`

**Tests:** `packages/character-sheet-draft/src/draft-mode-mutation-v2.test.ts` (13 tests)

### 5. Workshop Identity: `Draft.mode` is Sole Authority

**Removed:** `WorkshopPreferences.characterType` (was `"pc" | "npc"`)

**Updated files:**
- `apps/web/src/features/character-sheets/state/sheet-workshop-types.ts`
- `apps/web/src/features/character-sheets/lib/workshop-preferences.ts`
- `apps/web/src/features/character-sheets/components/WorkshopIdentitySelector.tsx`
- `apps/web/src/features/character-sheets/components/CharacterWorkshopV2.tsx`
- `apps/web/src/features/character-sheets/state/sheet-store-v2.ts`
- `apps/web/src/features/character-sheets/state/sheet-store-v2-types.ts`

**Behavior:**
- `WorkshopIdentitySelector` receives `mode` from `draft.mode`
- Displays "Player Character" / "Non-Player Character" as read-only label
- Threat selector only shown when `mode === "npc"`
- `ThreatLevelPreference` updated to canonical 5-level

### 6. Blank Manual Draft Defaults to PC

**Updated:** `apps/web/src/features/character-sheets/lib/dev-fixture-v2.ts`

```typescript
createBlankDraftV2() → mode: "pc" (was "npc")
```

### 7. Web Adapter for Final Generation

**Location:** `apps/web/src/features/character-sheets/lib/final-generation-adapter.ts`

```typescript
buildFinalGenerationRequestFromDraft(draft, options)
assertFinalGenerationEligible(draft, threat)
```

- Thin wrapper over `buildFinalGenerationRequestV1`
- Validates eligibility via `assertFinalGenerationEligible(draft, threat)`
- No AI/PDF execution in 14.11; adapter prepares request for later phase

### 8. No AI/PDF in 14.11

- Final generation request contract only
- AI text, AI image, PDF rendering deferred to 14.12+

## Test Updates

All test files migrated to canonical 5-level threat schema:
- `packages/character-sheet-generation/src/authoring.test.ts`
- `packages/character-sheet-generation/src/final-construction.test.ts`
- `packages/character-sheet-generation/src/gui-normalization.test.ts`
- `packages/character-sheet-generation/src/gui-only-regression.test.ts`
- `packages/character-sheet-generation/src/instructions.test.ts`
- `packages/character-sheet-generation/src/source-resolution.test.ts`
- `packages/character-sheet-generation/src/template-service.test.ts`
- `packages/character-sheet-generation/src/unified.test.ts`
- `packages/character-sheet-generation/src/benchmark/phase-14.5-domain.test.ts`
- `apps/web/src/features/character-sheets/components/WorkshopIdentitySelector.test.tsx`

## Architecture Decision Records

- **ADR-061** — Canonical Final Generation Contract (Phase 14.11)
  - Location: `docs/architecture/adr/061-final-generation-contract.md`

## Verification

All tests pass:
- `packages/character-sheet-draft`: 1376 tests (33 files)
- `packages/character-sheet-generation`: 408 tests (21 files)
- `packages/character-sheet-schema`: 36 tests (1 file)
- `apps/web`: 182 tests (27 files)

TypeScript strict mode passes for all modified packages.

## Related Documents

- **Feature Spec:** `docs/features/character-sheets.md` (updated with ADR-061 reference)
- **ADR-060:** Server-Authoritative Character Sheet Undo (Phase 14.10)
- **ADR-058:** Spatial Draft Layout (Phase 14.8)
- **ADR-059:** Visual Canvas Direct Manipulation (Phase 14.9)
- **Phase 14.10:** `docs/architecture/phase-14.10/character-sheet-authoring-completeness.md`