# Character Sheets — Release Readiness

**Status:** MVP COMPLETE (Phases 14.11–14.15) — pending external provisioning
**Date:** 2026-10-16
**Product spec:** `docs/features/character-sheets.md` (ACTIVE)
**Hardening record:** `docs/architecture/phase-14.15/character-sheet-mvp-hardening.md`

## What ships

Three entry paths (Manual / Upload + Extraction / Generate Character with
AI) converge on one canonical editable Draft V2 in a single Workshop:
recursive sections with mixed ordering, seven field types, spatial layout
grids, keyboard + pointer DnD, one-level Undo, PC/NPC modes, Medieval/Sci-fi
final styles, instruction-driven NPC authoring (explicit > AI >
threat/default), optional Portrait Slot with upload/URL/AI sources, and a
Draft-native styled final PDF. Standalone outputs are temporary until the
user exports/downloads them.

## Deployment prerequisites (account-side; NOT provisioned by this phase)

| Binding / config | Required | Local behavior | Missing-behavior (fail-closed) |
|---|---|---|---|
| `DB` (D1) | Yes (auth + heads + runs) | Wrangler local D1 | Storage-unavailable errors |
| `SHEET_ARTIFACTS` (R2) | Yes (drafts, runs, portraits) | Local bucket | Storage-unavailable errors |
| `RATE_LIMITER` | Yes for prod fairness | `RATE_LIMIT_MODE=local` in-memory | `RATE_LIMIT_UNAVAILABLE` |
| `AI` (Workers AI) | Yes for all AI flows | Remote account binding in local env | Ports absent → 503/failed runs |
| `TURNSTILE_SECRET` | Yes for public sessions | `TURNSTILE_MODE=local` bypass | Human-verification errors |
| `SHEET_VISION_MODEL` | For upload extraction | Local var present | Extraction 503 |
| `SHEET_PRESENTATION_MODEL` | For final generation | Must be configured | Generation unavailable |
| `SHEET_AUTHORING_MODEL` | For NPC authoring + AI creation | Must be configured | Authoring/creation 503 |
| `SHEET_PORTRAIT_MODEL` | For portrait AI generation | Must be configured | Portrait generation 503 |
| `RULES_WORKER_URL` (web server env) | Yes for the same-origin proxy | Unset in repo | Proxy 503 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Yes for public UX | Public key by design | No widget |

Do NOT invent bucket IDs, database IDs, namespace IDs, or model names: they
are Cloudflare-account values supplied at release time. No remote IDs exist
in the repo; the local `DB` binding intentionally has no `database_id`.

Rate-limit policy: `sheet-session-create` keyed by IP (pre-auth); all
authenticated AI/write routes keyed by session
(`sheet-document-extraction`, `sheet-ai-draft`, `sheet-final-generation`,
`sheet-portrait-upload/url/generate`, `sheet-draft-write`). Denied →
provider-specific 429/4xx; unavailable limiter → `RATE_LIMIT_UNAVAILABLE`.

## Security posture

Read-first review passed with 8 bounded remediations (stream-capped JSON,
proxy body caps, session-scoped limits, write-route limits, SSRF numeric/
mapped-IP forms + fetch timeout, `nosniff`, proxy `undo` route, debug-vars
pinned local-only). Session-scoped authorization on every Draft/Run/Portrait
route; no IDOR; bounded inputs; magic-validated images; HTTPS-only URL
import with redirect revalidation; user data untrusted into AI; schema +
semantic AI validation with one repair; no raw provider output persisted or
logged; secrets never in client bundles. Final read-only pass: PASS (no
HIGH/CRITICAL open; residual lows documented in the phase record).

## Verification (evidence in the phase report)

Unit/integration (fakes, no inference): draft 1411, generation 513,
portraits, artifacts, pdf-renderer 67, worker node 477, workerd 133, web
243. Typecheck zero (worker, web, touched packages). Lint zero (web).
Production `pnpm build` green. Playwright 9/9 (manual, DnD, resize,
keyboard, completeness, deletion/undo, AI creation, portrait, upload
rejection), including `%PDF-` download assertions.

## Known boundaries (by design, not defects)

- Generated standalone resources are temporary until export/download.
- No campaigns, libraries, saved Tables resources, or subscriptions (future).
- The Table remains the only realtime/multi-user feature (separate phase).
- Browser reload in local backend mode resets (ephemeral by design).
- Upload extraction success requires remote AI; single-column portrait
  frames overflow by design (fail closed with an explicit message).
- Only Medieval + Sci-fi styles are live; only one Portrait Slot; no chat.
