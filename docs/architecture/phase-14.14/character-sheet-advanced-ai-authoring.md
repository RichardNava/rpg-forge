# Phase 14.14 — Advanced AI Authoring

**Status:** COMPLETED
**Date:** 2026-10-16
**Decision record:** `docs/architecture/adr/064-character-sheet-ai-authoring-authority.md`
**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)

## Purpose

Phase 14.14 implements two distinct advanced authoring capabilities under one
frozen rule:

**User > Draft > AI.**

A. **NPC instruction-driven blank resolution** — bounded `npcInstructions`
orient AI-generated values for eligible blank NPC fields during final
generation. Explicit values always win; threat/default generation runs only
where instructions do not specify enough.

B. **AI-assisted character creation** — a separate entry flow ("Generate
Character with AI") where the model proposes an editable sheet and
application code compiles it into an ordinary unconfirmed Draft V2 entering
the normal Workshop.

Neither flow mutates a Draft with AI output. The existing "Generate Final
Sheet with AI" action is unchanged: confirmed Draft → resolved values →
visual presentation → final PDF.

Phase 14.14 does NOT own new visual styles, portrait redesign, persistent
chat, RAG/lore, map/campaign generation, La Mesa, or broad hardening (14.15).

## What 14.14 delivered [COMPLETED]

```
Final generation contract (additive, still schemaVersion "1")
  -> options.npcInstructions: string(<=5000) | null (optional)
  -> PC + non-null npcInstructions rejected (schema + builder)
  -> NPC + null valid; NPC + instructions valid; whitespace normalizes null
  -> presentation `instructions` semantics unchanged and independent
  -> portrait contract untouched; seed stays single/top-level

NpcValueAuthoringPlanV1 (provider-independent, values ONLY)
  -> { schemaVersion: "1", assignments: [{ key, value: DraftValue }] }
  -> strict; max 192 assignments; no duplicate keys
  -> no labels/definitions/structure/layout/threat/mode/style/portrait

Eligible blank-field policy (one canonical function)
  -> blank = absent or null; explicit false/0/"" never eligible
  -> eligible: text, textarea, choice, list, date, checkbox,
     number ONLY with min+max; label NEVER; unbounded numbers stay blank
  -> choice must be a declared option; numbers finite within min/max;
     dates YYYY-MM-DD real calendar; lists within item/count bounds

Bounded authoring context (no tokens, paths, style, portrait, PDF)
  -> mode/threat, blank descriptors (key/label/type/min/max/options),
     read-only explicit context (UNTRUSTED: assignments for those keys
     are rejected)

NpcValueAuthoringPort (narrow, style-free)
  -> generateAssignments({ blanks, explicit, npcInstructions, threat, seed })
  -> trusted system prompt: fill listed blanks only; explicit immutable;
     instructions outrank threat; no new fields/structure; JSON only

Two validation layers
  -> structural schema, then Draft-aware semantic validation
  -> unknown/explicit-value/invalid keys and values REJECT the plan
  -> one bounded repair attempt for provider output; no retry loop

Final value priority (resolveFinalValues, Draft never mutated)
  -> explicit user values
     -> validated AI assignments (defensively skipped on conflict)
     -> threat/default deterministic fallback (still-blank bounded numbers)
     -> remaining blanks stay blank
  -> null npcInstructions preserves 14.12 behavior exactly (no model call)

Cloudflare NPC adapter (sheet-npc-authoring.ts)
  -> Ai + explicit SHEET_AUTHORING_MODEL injected; temperature 0;
     max 4096 tokens; json_schema output; one repair; nothing persisted/logged

Orchestrator integration
  -> load -> request -> PENDING run -> optional authoring AI
     -> validated assignments -> fallback -> resolved values
     -> presentation AI (separate port/prompt) -> renderer -> R2 -> READY
  -> authoring unavailable/invalid with instructions present -> FAILED,
     no PDF, never silent threat fallback

AI-assisted creation (separate flow, no runs, no confirm)
  -> AiDraftCreationRequestV1 { schemaVersion, mode, prompt<=5000 }
  -> AiDraftProposalV1: local ids only; sections/fields/structure/values;
     no slots, no persistence authority, strict bounds (counts/depth/
     types/options/values), cycles/unknown-parents/duplicates rejected
  -> compileAiProposalToDraftV2: app owns keys (deduped), schemaVersion 2,
     version/baseVersion 1, confirmed=false, source nulls, character_name
     mirror (literal character_name key always exists), layoutless;
     validateDraftV2 must pass
  -> AiDraftCreationPort (separate from authoring port) + trusted prompt
  -> POST .../drafts/generate-ai: auth -> sheet-ai-draft:<ip> rate limit
     -> validate -> proposal -> validate -> compile -> canonical createDraftV2
     -> 201 unconfirmed Draft; ordinary GET/PATCH/Undo/layout/portrait/
     confirm/final-generation lifecycle afterwards
  -> Cloudflare adapter (sheet-ai-draft-creation.ts) shares
     SHEET_AUTHORING_MODEL; fail closed when unconfigured

Renderer (generated character name)
  -> final PDF title prefers resolved character_name (valid non-blank
     string) -> draft.characterName -> "Character Sheet"; Draft unmutated

Web
  -> landing "Generate Character with AI" enabled with dialog (PC/NPC +
     description + idle/generating/error); success loads the canonical
     Draft into the existing Workshop; no auto-confirm, no final-gen call
  -> post-confirm NPC-only "NPC generation instructions (optional)" field,
     visually separate from presentation instructions; PC never sends it
  -> store: npcInstructions plumbed; aiDraft idle/generating/error state;
     local backend deterministic fakes exercising real validation/compiler
```

## Contract summary

- **Explicit values always win** — `false`, `0`, `""` are explicit; AI
  assignments target blanks only and are rejected (plan) or skipped
  (defensive resolution) on conflict.
- **npcInstructions > threat > default** — instructions orient AI values;
  threat/default fill only still-blank bounded numerics afterwards.
- **Null instructions preserve 14.12** — no authoring-model call, identical
  resolved output for identical inputs.
- **Content AI and presentation AI are different authorities** — separate
  ports, prompts, models paths (`SHEET_AUTHORING_MODEL` vs
  `SHEET_PRESENTATION_MODEL`); visual style never affects content.
- **AI-created characters begin as unconfirmed editable Draft V2** — the
  model emits proposals, never persisted authority; the compiler is
  application-owned; mode comes from the request.
- **Generate Character with AI ≠ Generate Final Sheet with AI** — creation
  ends in the Workshop; final generation ends in a PDF.
- **No persistent chat history** — the bounded instruction field satisfies
  14.14 authoring; no chat tables, transcripts, or streaming loops.
- **Portrait remains 14.13 architecture** — no Slot generation from AI flows.
- **Rate limits** — `sheet-final-generation:<ip>` covers in-generation NPC
  authoring (one consumption); `sheet-ai-draft:<ip>` is dedicated to AI
  draft creation.
- **14.15 is hardening only.**

## Legacy pipeline audit (§24)

`authoring.ts` / `generate.ts` / `unified-generation.ts` /
`final-construction.ts` target the pre-Draft `CharacterSheetSpec` pipeline
(calculations, tables, rulebook refs). Reused where semantically direct:
`NPCThreatLevelSchema`, `THREAT_BIAS` + window, canonical Draft bounds.
The Spec machinery was deliberately NOT adapted into proposal authority —
that would be a rewrite, and final authority stays `CharacterSheetDraftV2`.

## Test coverage

**Domain (`@repo/character-sheet-generation`, 513 tests):** PC rejection,
null/whitespace normalization, explicit false/0/string preservation,
eligibility matrix (label never, unbounded number never), choice/number/
date/checkbox/list validation, unknown/duplicate/explicit-key rejection,
adversarial extra-property rejection, repair-once policy at adapter level,
priority A–F (explicit beats AI, AI beats threat, fallback fills, text
lands, unbounded stays blank, null preserves 14.12); proposal bounds
(prompt/mode/counts/depth/types/options/values/cycles/parents), compiler
determinism (keys, order, hierarchy, values, mirror, mode, confirmed=false,
v1, no slot, validateDraftV2 passes).

**Renderer (`@repo/character-sheet-pdf-renderer`):** resolved
character_name wins the final title without Draft mutation.

**Worker (`rules-worker`, node):** NPC+instructions calls authoring once
with style-free input; null skips it; PC rejected pre-model-call; AI-vs-
plain byte inequality proves assignments reach the render; conflicting
assignment → FAILED; unavailable/invalid AI → FAILED with no PDF (never
silent fallback); presentation separation; cross-style authoring-input
equality; generate-ai route (201 canonical draft, ordinary lifecycle,
401/400/503/500/429 paths, no run created, rate-limit key asserted).

**Worker (workerd):** generate-ai auth + request-validation gates against
real D1 (no model reachable — quota-safe).

**Web (unit/RTL/API):** dialog (mode/prompt-required/submit/error),
landing enabled + distinct from final generation, local end-to-end AI flow
(editable, unconfirmed, no final-gen call), NPC-instructions visibility
(NPC-only; PC-hidden), store plumbing (NPC carries, PC nulls; aiDraft
states), client (mode+prompt, no Draft), proxy whitelist, local-backend
fakes (compiler round-trip, deterministic fill + READY).

## Related documents

- ADR-064 — Character Sheet AI Authoring Authority
- `docs/features/character-sheets.md` (ACTIVE product behavior)
- ADR-063 — Character Sheet Portrait Authority (Phase 14.13)
- ADR-062 — Character Sheet AI Presentation Authority (Phase 14.12)
- ADR-061 — Canonical Final Generation Contract (Phase 14.11)
