# Phase 14.12 — AI Final Presentation

**Status:** COMPLETED
**Date:** 2026-10-14
**Decision record:** `docs/architecture/adr/062-character-sheet-ai-presentation-authority.md`
**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)

## Purpose

Phase 14.12 implements the real post-confirm flow: a confirmed Draft V2 plus
generation options produces an AI-planned, Draft-native styled PDF that the
user downloads as the final product. It owns final presentation generation,
the first two real visual styles (Medieval, Sci-fi), bounded AI presentation
choices, the final styled PDF, production Worker orchestration, and the Web
final-generation flow.

Phase 14.12 does NOT own portrait upload/URL/AI generation (14.13), AI
character creation or conversational NPC authoring (14.14), or arbitrary
user-generated styles.

## What 14.12 delivered [COMPLETED]

```
FinalGenerationRequestV1 (hardened, 14.11 preflight)
  -> draft: CharacterSheetDraftV2 (no z.any)
  -> schema-level confirmed + PC/NPC threat validation
  -> visualStyle required (canonical six-style enum)
  -> single top-level seed; no options.seed; no visualStyleIntent

PC/NPC authoring control (14.11 preflight)
  -> WorkshopIdentitySelector PC/NPC buttons invoke set_mode
  -> Draft.mode remains the only mode authority
  -> Web aliases shared ThreatLevel / CanonicalVisualStyle / PortraitConfig

FinalPresentationPlanV1 (bounded AI output)
  -> style: medieval | sci-fi
  -> variant / ornamentDensity / contrast / sectionEmphasis / fieldEmphasis
  -> all finite application-owned enums; no colors/fonts/CSS/coordinates

StyleProfileV1 (application authority)
  -> MEDIEVAL_STYLE_PROFILE (parchment, serif, bronze, double rules)
  -> SCI_FI_STYLE_PROFILE (navy/cyan, mono, angular panels, circuit motifs)
  -> forbiddenTransformations per style; allowedVariants standard/compact/ornate

FinalPresentationPort + Cloudflare adapter
  -> narrow provider-agnostic port (style, structural summary, instructions)
  -> sheet-final-presentation.ts (Workers AI, temperature 0, JSON schema,
     one bounded repair, no payload stored/logged)
  -> SHEET_PRESENTATION_MODEL config; fail closed when binding is missing

FinalResolvedValuesV1 (derived output, never Draft mutation)
  -> PC: explicit values preserved, blanks remain absent
  -> NPC: explicit preserved; blank bounded numerics generated deterministically
     from canonical threat bias + seed + field key
  -> style never affects values (resolver never receives style)

Draft-native styled PDF renderer
  -> renderStyledCharacterSheetPdf({ draft, resolvedValues, presentation, profile })
  -> draft.structure = hierarchy/order authority
  -> effective DraftLayoutV1 = geometry authority
  -> recursive sections, mixed ordering, columns/columnStart/columnSpan/
     rowSpan/breakBefore preserved; overflow fails closed
  -> Medieval and Sci-fi produce byte-distinct PDFs with deep-equal semantic
     manifests; presentation metadata differs
  -> old CharacterSheetSpec renderer remains as technical/compatibility path

Final run infrastructure (reused)
  -> existing sheet_generation_runs + SheetRunRepositoryPort (no new table)
  -> existing R2 key layout; putPdfBytes extension (no manufactured spec)
  -> synchronous PENDING -> READY / PENDING -> FAILED orchestration

HTTP surface
  -> POST .../drafts/:draftId/generate { expectedVersion, options, seed }
     (server loads authoritative Draft; Web never sends Draft authority)
  -> GET .../runs/:runId/pdf (session-scoped, READY-only, no-store,
     attachment disposition)
  -> dedicated sheet-final-generation:<ip> rate-limit key

Web final-generation flow
  -> post-confirm FINAL STYLE panel (Medieval / Sci-fi; others hidden)
  -> NPC threat selector when required; presentation-instructions textarea
     (max 5000, presentation-only guidance)
  -> Generate Final Sheet with AI (generating state, duplicate-submit guard)
  -> Download Final PDF on READY; stable per-Draft seed across style changes
  -> technical PDF demoted to secondary "Download technical PDF"
```

## Contract summary

- **Confirmed Draft V2 = semantic/layout authority** — the server reloads the
  authoritative Draft for generation; Web cannot supply Draft authority.
- **Resolved values are derived output** — `FinalResolvedValuesV1` is computed
  per run; the Draft is never mutated during final generation.
- **PC blanks never generated** — all PC blanks remain absent/editable.
- **14.12 NPC generation is bounded** — only blank NUMBER fields with complete
  min/max ranges; text/textarea/date/checkbox/choice/label blanks stay blank.
- **Presentation AI owns bounded visual tokens only** — `FinalPresentationPlanV1`
  carries finite enums; the AI cannot output semantic content or coordinates.
- **StyleProfile owns actual rendering** — colors, fonts, geometry, vectors.
- **Medieval + Sci-fi implemented** — the canonical six-style catalog is intact;
  the other four styles are not selectable in the final-generation chooser.
- **Draft-native renderer replaces the flat Spec as the final-product path** —
  no `projectDraftV2ToSpec` in the styled path; the old renderer stays as the
  technical/compatibility path.
- **Synchronous D1 run lifecycle** — existing `sheet_generation_runs`;
  temporary session-scoped R2 final PDF (`.../runs/<runId>/sheet.pdf`,
  `no-store`).
- **Server builds FinalGenerationRequest from the authoritative Draft.**
- **Portrait still deferred to 14.13** — contract and Workshop state remain
  `{ kind: "none" }`.
- **Richer instruction-driven NPC mechanics deferred to 14.14** — 14.12
  `instructions` are presentation guidance only.

## Test coverage

**Domain (`@repo/character-sheet-generation`):**
- presentation plan: bounded tokens only; unknown style/variant/density/
  contrast/emphasis rejected; extra properties rejected; style profiles and
  token sets verified; structural summary (mode/counts/depth/columns/density);
  system prompt carries trusted instructions + untrusted-data channel
- final value resolution: PC explicit false/0/strings preserved, blanks absent;
  NPC explicit preserved, bounded numeric generated in-range, deterministic per
  seed/threat/key, monotonic threat bias, style-independent (resolver takes no
  style), unbounded/non-numeric blanks stay blank
- final generation contract: required seed once, options.seed/visualStyleIntent
  rejected, six canonical styles accepted, unknown rejected, none-only
  portrait, five threats accepted, old aliases rejected, PC/NPC rules intact

**Renderer (`@repo/character-sheet-pdf-renderer`):**
- Medieval + Sci-fi valid PDFs; byte-distinct outputs; deep-equal semantic
  manifests; nested/mixed/grid geometry preserved; explicit false/0/text/date/
  choice preserved; PC blanks editable; NPC generated numeric present; label
  has no widget; no Spec projection; no raster artwork; overflow fails closed;
  unsupported style rejected

**Worker (`rules-worker`, fake presentation port, no real inference):**
- confirmed PC → READY + PDF bytes + headers; NPC cross-style determinism;
  stale version → 409 with no run; unconfirmed → 422; PC+threat → 422;
  NPC-threat-missing → 422; unsupported style → 422; client Draft in body →
  400; AI failure → 503 + FAILED + no PDF; invalid plan → FAILED; storage
  failure → FAILED; cross-session PDF → 404; missing run → 404; missing
  binding → 503; repost-as-reroll supersede lifecycle

**Web (unit/RTL/API, no Playwright):**
- proxy whitelist for generate + runs-pdf; client sends
  expectedVersion/options/seed with no Draft and downloads raw bytes; store
  idle/generating/ready/error with runId/draftVersion, local rejections for
  unconfirmed/NPC-threat/PC-threat, stable seed reuse; post-confirm panel with
  Medieval/Sci-fi only, threat/instructions flow, Generate/Download states;
  technical PDF secondary; pre-confirm set_mode buttons intact

## Related documents

- ADR-062 — Character Sheet AI Presentation Authority
- `docs/features/character-sheets.md` (ACTIVE product behavior)
- ADR-061 — Canonical Final Generation Contract (Phase 14.11)
- `docs/architecture/phase-14.11/character-sheet-final-generation.md`
