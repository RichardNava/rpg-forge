# Phase 14.15 — Character Sheet Generator MVP Hardening

**Status:** COMPLETED
**Date:** 2026-10-16
**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)
**Release readiness:** `docs/features/character-sheets-release-readiness.md`

## Purpose

Phase 14.15 adds no features. It proves, hardens, and closes the complete
Character Sheet Generator MVP: Manual, Upload + Extraction, and AI Draft
Creation converge on one canonical editable Draft V2 → visual Canvas →
PC/NPC → style + NPC options → optional Portrait → confirm → Generate Final
Sheet with AI → final styled PDF.

No ADR was required: every change is a defect fix, gap closure, or
documentation inside already-decided architecture (ADR-060 through ADR-064).

## Initial baseline (current main `36874ec`, clean tree)

- Static marker sweep (production sheet surface): 20 findings, **zero MVP
  blockers** (placeholder/input hints, one deferred error string, four
  isolated `as any`/`: any` casts, no TODO/FIXME/HACK/console/waitForTimeout
  in production, no old threat vocabulary, no dead V1 runtime).
- `rules-worker typecheck`: **29 errors, all Character-Sheet-owned** (fixed
  in 14.15; see below).
- `web typecheck`: **zero errors** (unchanged).
- `web lint`: 5 errors + 3 warnings, all Character-Sheet-owned (fixed).
- `web build`: **broken at baseline** — Turbopack and webpack could not
  resolve workspace `.js` ESM specifiers (fixed; first green production
  build, see §Build).
- E2E suite: never ran green (build broken + stale pre-14.11 vocabulary).

## Fixes made (14.15 only, all bounded)

### TypeScript / lint debt — zero remaining in sheet-owned files

Worker (29 → 0):
- `character-sheet-handler.ts:835` — PATCH mutation now re-validated with
  `parseDraftMutationV2` plus an explicit undo guard (also closes the
  `unknown` type error).
- Portrait URL import: fixed `PortraitUrlImportRejectionCode` typename typo,
  restoring discriminated-union narrowing for `.bytes`.
- Undo: registered the thrown `undo_*` domain codes and the mapped
  `SHEET_DRAFT_UNDO_*` transport codes (thrown and mapped since 14.10, never
  registered); fixed the `persistUndoDraftV2` import.
- `createStructuralSummary` accepts the `slot` placement kind (14.13 widened
  placements; the summary only inspects sections).
- Test fakes/harnesses: `DraftHead` undo fields, `commitUndo` delegation,
  exactOptionalPropertyTypes omissions.

Web (5 errors + 3 warnings → 0):
- `field-editing.tsx` — hooks hoisted above early returns.
- `CanvasInspectorV2.tsx` — prop-sync effect replaced with identity-keyed
  remount for the choice-options editor.
- `local-sheet-backend-v2.ts` — both `as any` casts replaced with
  `parseDraftMutationV2` validation (+ undo guard); dead reads removed.
- `sheet-store-v2.ts` — unused mode parameter removed (renamed helper).

Packages:
- `character-sheet-draft/errors.ts` — registered `undo_*` codes.
- `character-sheet-generation/final-presentation.ts` — summary accepts slots.

### Security remediation (all 8 findings, verified by tests)

1. `readBoundedJson` now streams through the byte cap (was: unbounded
   `request.text()` before the length check). New `http.test.ts`.
2. Proxy tier caps every body (extraction 16 MiB+64 KiB, portrait upload
   8 MiB+64 KiB, JSON 16 KiB); over-cap → 413 without contacting upstream.
   New `proxy-body-limits.ts` (+ tests) and route tests.
3. Authenticated rate-limit keys are session-scoped (`:<auth.sessionId>`);
   the proxy never forwarded client IP, so IP keys shared one global bucket.
   Session-create stays IP-keyed (pre-auth).
4. New `sheet-draft-write:<sessionId>` limit on the five version-creating
   routes (create/mutate/reroll/confirm/undo). Reads stay unthrottled
   (documented decision: no snapshot creation, cheap R2 reads).
5. SSRF validator: single-integer IPv4 normalization, IPv4-mapped IPv6
   (`::ffff:` incl. parser-translated hex form) judged on embedded bits,
   15 s per-attempt fetch timeout.
6. `nosniff` on portrait preview + final PDF, preserved through the proxy.
7. Proxy whitelist gained the missing `undo` branch (route existed, client
   could not reach it).
8. `SHEET_VISION_DEBUG_RAW_RESPONSE` pinned local-only in wrangler + comment.

Rate-limit test expectations updated to session keys. No behavioral change
to allow/deny/unavailable semantics (fail-closed retained everywhere).

### Real product defects found by hardening

- **Canvas `labelOf` precedence bug** (`SheetCanvasV2.tsx`): every move-menu
  label, announcement, and handle description rendered "Portrait". Fixed
  with parenthesization; this unblocked the happy-path, C, and E2E C flows.
- **Layout mutations dropped `slotDetails`** (`draft-layout-mutation-v2.ts`):
  any container/node layout change after adding a Portrait Slot corrupted
  the draft (validateDraftV2 gate rejected it). Both rebuild sites now
  preserve slot details; regression tests added. This unblocked the
  portrait final-PDF journey.
- **Single-column portrait overflow**: a default 3:4 slot frame exceeds one
  page by design and fails closed with `layout_overflow` (documented,
  intended). The portrait E2E uses a fitting two-column layout; the error
  path stays unit-tested.

### E2E closure (9/9 green, deterministic local backend, no AI)

Updated stale expectations (`Veteran` → `Elite`, `Player character` →
`Player Character`, technical `Download PDF` → Generate Final Sheet with AI
→ `Download Final PDF` with `%PDF-` magic assertion), replaced all three
fixed waits with observable conditions (the resize poll already subsumed its
sleep; delete-dialog hidden state; selection-rendered inspector control),
and fixed a test that asserted a dialog without clicking anything.

Added: E2E F (AI creation NPC → edit → threat + npcInstructions → confirm
→ final PDF), E2E G (portrait slot → 1x1 PNG upload → preview → keyboard
move → confirm → final PDF), E2E H (invalid upload rejected with alert).

Accepted boundaries (documented, not defects):
- Browser reload in local mode resets to the landing: the local backend is
  intentionally ephemeral (no persistent libraries in the MVP). Server-side
  persistence is proven by workerd D1/R2 round-trips.
- Upload extraction success needs remote AI: E2E covers the invalid-file
  plumbing; extraction → canonical Draft is proven by worker fake-vision
  integration tests.

### Build (pre-existing blocker, first green build)

`pnpm --filter web build` failed at baseline for the entire workspace
surface (41+ unresolvable `.js` ESM specifiers under both Turbopack and
webpack): `transpilePackages` listed only the renderer. Fixed minimally:
all four imported workspace packages listed, plus
`experimental.extensionAlias` mapping `.js` → `.ts` (webpack mechanism;
Turbopack has no equivalent). Production `pnpm build` is therefore pinned
to `--webpack` (same entrypoint/output contract; E2E webServer unchanged).
Two one-line `crypto.subtle.digest` ArrayBuffer fixes in
`rules-analysis-run`/`rules-analysis-session` (non-sheet baseline debt,
repaired minimally to unblock the required gate; documented as residual).

## Authority invariants (re-verified)

One authority per concern, unchanged: `fields/sections/slots` registries,
`structure[]` order, `layout` geometry (+ slotDetails preserved),
`Draft.mode`, Workshop options, temporary portrait asset, derived
`FinalResolvedValuesV1`, bounded `FinalPresentationPlanV1`, `StyleProfile`.
No client Draft authority; no second mode/hierarchy/portrait authority.
User > Draft > AI holds on every flow.

## Test results (final matrix §27 in the report)

Packages, worker (node + workerd), web unit, lint, typecheck, production
build, and the 9-scenario Playwright suite are green; details in the phase
report. No real inference, no remote resources, no deploys in any test.

## Residual debt (accepted, non-blocking)

- `rules-worker`/`web` baseline items outside Character Sheets: none open —
  worker typecheck is zero; the two `crypto.subtle` one-liners are the only
  non-sheet files touched, documented above.
- Pre-existing repo-wide prettier debt: 14.15 kept all diffs minimal and did
  not reformat unrelated files; new files are prettier-clean.
- `waitForTimeout` debt: eliminated (0 remaining in the sheet E2E).
- Deployment prerequisites (account-side values): see the release-readiness
  document; provisioning remains a release prerequisite.

## Related documents

- `docs/features/character-sheets.md` (ACTIVE; 14.11–14.15 marked COMPLETE)
- `docs/features/character-sheets-release-readiness.md`
- ADR-060 through ADR-064 (unchanged; no new ADR required)
