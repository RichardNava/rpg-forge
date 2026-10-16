# ADR-064 — Character Sheet AI Authoring Authority

**Status:** Accepted
**Date:** 2026-10-16

## Context

Phase 14.12 limits NPC generation to deterministic bounded numerics and owns
presentation AI; richer instruction-driven mechanics and AI character creation
were deferred to 14.14. The implementation must let user instructions orient
NPC values and let AI propose new sheets without ever giving the model
authority over Draft content, identity, structure, or persistence.

## Decision

### 1. Authority order is User > Draft > AI

For existing Drafts, AI proposes values for eligible blank Fields only. It
may not alter explicit values (including `false`, `0`, `""`), Field
identity/labels/types, Section hierarchy, `structure[]`, layout, Portrait
Slot geometry, or Draft mode. Assignments land in derived
`FinalResolvedValuesV1`, never in the Draft.

For AI-assisted creation, the model emits a proposal with local ids only.
Application code owns sessionId, draftId, schemaVersion, version/baseVersion,
`confirmed=false`, canonical keys, layout materialization, source metadata,
and persistence.

### 2. Content instructions are separate from presentation instructions

`npcInstructions` (values authority, ≤5000 chars, whitespace→null) is a new
optional final-generation option. The 14.12 `instructions` field keeps its
presentation-only semantics. PC requests with non-null `npcInstructions` are
rejected; the contract stays `schemaVersion: "1"` (additive, no V2).

### 3. Eligibility is blank-only and type-bounded

`deriveNpcAuthoringContext` is the single eligibility authority: blank means
absent-or-null; label fields are never eligible; numbers require both min and
max. Semantic validation rejects unknown keys, explicit-value keys, and
out-of-contract values; at most one bounded provider-output repair is
allowed.

### 4. Resolution priority is explicit > AI > threat/default

`resolveFinalValues` copies explicit values, applies validated AI
assignments (defensively skipping conflicts), then runs the existing
deterministic threat fallback on still-blank bounded numerics. Null
instructions reproduce 14.12 behavior exactly with no model call. Style never
enters content resolution. Authoring AI that is unavailable or invalid while
instructions are present fails the run — instructions are never silently
ignored.

### 5. Creation and authoring are separate ports sharing one explicit model

`NpcValueAuthoringPort` and `AiDraftCreationPort` have different schemas,
prompts, and authorities. Both Cloudflare adapters take explicitly injected
`Ai` + `SHEET_AUTHORING_MODEL` and fail closed when unconfigured. The
proposal→Draft compiler is deterministic and application-owned; its output
must pass `validateDraftV2`. AI creation uses the canonical draft-creation
path, creates no generation runs, and never confirms.

## Alternatives considered

- **Reusing the legacy Spec pipeline as proposal machinery** — rejected: it
  targets `CharacterSheetSpec` (calculations/rulebooks), not Draft V2
  registries; adapting it would be a rewrite. Only threat/bias schemas and
  canonical bounds are reused.
- **V2 final-generation contract for one optional field** — rejected: the
  addition is backward-compatible (absent/optional), so no version bump.
- **Silent threat fallback when authoring AI fails** — rejected: it would
  violate the authority order by ignoring the user's instructions.
- **Model-emitted Draft snapshots** — rejected: the model must never control
  persistence authority.
- **Persistent chat for NPC authoring** — rejected for 14.14: the bounded
  instruction field satisfies the requirement with no chat infrastructure.

## Consequences

- NPC authors can orient blanks with plain language; explicit content is
  untouchable by construction, not by prompt politeness.
- New characters can start from AI proposals yet remain ordinary editable
  Drafts in the single existing Workshop.
- Content generation is provably style-independent; presentation AI is
  untouched.
- Missing AI bindings/models fail closed on both new flows; automated tests
  use fakes and consume no inference quota.
- 14.15 owns MVP hardening; no chat, RAG, or new styles are introduced.
