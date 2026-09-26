# OpenCode Always-On Project Context

This file contains the small set of product facts that every OpenCode session must know.

## Product

This is a web application for tabletop RPG resources. The core product is system-agnostic.

A **one-shot** is a short adventure designed to start and finish in a single play session.

## MVP modes

### Standalone tools

These work independently and do not require campaigns or persistent storage:

- adventure generation;
- map generation;
- NPC generation;
- character-sheet generation (manual creation, upload extraction, editable draft);
- standalone dice roller.

Generated standalone resources are temporary until the user exports/downloads them.

### The Table

**The Table is the only multi-user and realtime feature in the MVP.**

It requires authenticated users and supports a shared map, grid, tokens, simple drawing tools and shared dice rolls.

Its free MVP state is temporary. Temporary server state used for synchronization/reconnection is not premium persistence.

## Current workstream

**Phase 14 Character Sheets** is the active major workstream.

- The authoritative detailed spec is `docs/features/character-sheets.md`.
- Character Sheets use a temporary server-authoritative/session-based architecture.
- Current approved baseline includes the existing editor/domain/storage work from main.
- Advanced recursive reorder/reparent UX is the next stabilization work and must follow the active spec.
- Do not recreate obsolete Root organizer/tree approaches.
- Do not assume historical Phase 14 docs override the active feature spec.

## Future scope

Campaigns, persistent resource libraries, saved Tables, campaign-context AI, user-uploaded lore sources and monetization are future features.

Their presence in documentation does not authorize implementation during the MVP.

## Architecture

- Cloudflare-first and free-tier-first.
- Next.js web app on Cloudflare Workers via OpenNext.
- D1 + Better Auth for MVP authentication persistence.
- Workers AI behind project-owned provider abstractions.
- Durable Objects + native WebSockets only for The Table.
- R2 used for temporary Character Sheet artifact and draft storage.
- pnpm workspace, no Turborepo.
- Future cross-runtime packages are created only when their corresponding feature is implemented.

For detailed behavior and architecture, follow the documentation-loading map in the root `AGENTS.md`.
