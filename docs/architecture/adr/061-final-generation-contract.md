# ADR-061 — Canonical Final Generation Contract (Phase 14.11)

**Status:** Accepted
**Date:** 10/14/2026

## Context

Phase 14.11 completes the Character Sheets MVP by defining the canonical final generation contract — the single request surface that carries a confirmed Draft plus presentation options to the generation endpoint. This is the boundary between the authoring surface (Canvas, Workshop, draft mutations) and the generation pipeline (AI text, AI image, PDF rendering).

Key constraints from prior phases:
- Draft is server-authoritative; client holds optimistic preview only (14.9, 14.10)
- `Draft.mode` is the sole PC/NPC authority — no separate `characterType` in Workshop (14.11)
- Canonical 5-level NPC threat schema: `very-low`, `low`, `medium`, `elite`, `legendary` (14.11)
- Confirmed Draft required for final generation (no unconfirmed drafts)
- PC blanks stay blank; NPC blanks stay absent in request
- Visual style strict enum; portrait `none`-only boundary in 14.11
- One required seed; no AI/PDF execution in 14.11 (deferred to 14.12+)

## Decision

### 1. Canonical request contract: `FinalGenerationRequestV1`

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

### 2. `buildFinalGenerationRequestV1(draft, options)` factory

- Validates preconditions:
  - `draft.confirmed === true` (throws otherwise)
  - PC draft + `options.threat` → throws ("PC draft cannot have threat")
  - NPC draft + no `options.threat` → throws ("NPC draft requires threat")
- Returns plain object matching `FinalGenerationRequestV1Schema`
- `options.threat` overrides any `draft.threat` (Draft threat is ignored)
- `portrait` defaults to `{ kind: "none" }`
- `instructions` defaults to `null`

### 3. Canonical 5-level NPC threat schema

```
very-low → 0.15 bias
low      → 0.35 bias
medium   → 0.50 bias
elite    → 0.85 bias
legendary→ 0.95 bias
```

- Replaces previous 5-level: `weak`, `ordinary`, `dangerous`, `elite`, `boss`
- Machine keys are stable identifiers; UI labels are for display only
- Bias windows: ±0.15 around tier bias, clamped to [0, 1]

### 4. `set_mode` mutation (no `confirmClear`)

```typescript
{ op: "set_mode", mode: "pc" | "npc" }
```

- Switches `Draft.mode` between `"pc"` and `"npc"`
- Preserves ALL content: fields, values, sections, structure, layout, characterName, rulesContextId, source
- No `confirmClear` — mode changes are non-destructive
- Version increments; baseVersion unchanged
- If mode unchanged, returns same draft (no-op)

### 5. Workshop identity: `Draft.mode` is sole authority

- Removed `WorkshopPreferences.characterType` (was `"pc" | "npc"`)
- `WorkshopIdentitySelector` now receives `mode` from `draft.mode`
- Displays "Player Character" / "Non-Player Character" as read-only label
- Threat selector only shown when `mode === "npc"`
- `ThreatLevelPreference` updated to canonical 5-level

### 6. Blank manual draft defaults to PC

- `createBlankDraftV2()` now creates `mode: "pc"` (was `"npc"`)

### 7. Web adapter for final generation

- `buildFinalGenerationRequestFromDraft(draft, options)` in `@repo/web/features/character-sheets/lib/final-generation-adapter.ts`
- Thin wrapper over `buildFinalGenerationRequestV1`
- Validates eligibility via `assertFinalGenerationEligible(draft, threat)`
- No AI/PDF execution in 14.11; adapter prepares request for later phase

### 8. No AI/PDF in 14.11

- Final generation request contract only
- AI text, AI image, PDF rendering deferred to 14.12+

## Alternatives considered

- **Threat in Draft** — rejected: threat is presentation-coaching, not Draft content; belongs in options
- **`confirmClear` on mode switch** — rejected: mode changes must preserve all content; no data loss
- **Client-side final generation** — rejected: server-authoritative architecture; generation is server-side
- **Full portrait union in 14.11** — rejected: boundary is `none`-only; full union in 14.13

## Consequences

- Single canonical request surface for final generation
- Draft content never modified by generation (threat in options only)
- `set_mode` is non-destructive; Workshop reflects `Draft.mode` directly
- Threat vocabulary unified across authoring, generation, and construction
- Web adapter ready for 14.12 AI Final Presentation integration
- Blank manual drafts start as PC (matches typical user expectation)

## Non-goals

- No AI text generation in 14.11
- No AI image generation in 14.11
- No PDF rendering in 14.11
- No portrait upload/URL/AI in 14.11
- No visual style beyond strict enum in 14.11