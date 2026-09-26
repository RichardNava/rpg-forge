# RPG Project

Aplicación web para generar y utilizar recursos de juegos de rol de mesa.

> Nombre provisional del producto.

## Estado

Phase 13: COMPLETE - the public standalone Dice Roller is available at `/dice`.
Phase 14: ACTIVE - Character Sheets is the current development area.
Campaigns are deferred to future persistence/premium work.

## Stack base

- Next.js 16
- TypeScript
- Tailwind CSS 4
- shadcn/ui + Base UI
- Cloudflare Workers + OpenNext
- pnpm workspace
- OpenCode project configuration

## Local auth and D1

The local D1 binding is named `DB` and uses Wrangler/Miniflare only. It has no remote `database_id` configured, so this configuration is local-only and must not be used to deploy or upload a Worker. Dev/Prod bindings receive approved remote IDs only when those environments are created.

1. Create `apps/web/.dev.vars` from `apps/web/.dev.vars.example` without committing it.
2. Generate `BETTER_AUTH_SECRET` locally, for example with `openssl rand -base64 32`.
3. Add Google OAuth credentials manually. For local development, configure this exact Google redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

Generate and apply the initial local migration:

```powershell
pnpm db:generate
pnpm db:migrate:local
```

Inspect local tables with:

```powershell
pnpm --filter web exec wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
```

To reset local D1 state, stop local Workers and remove the ignored `apps/web/.wrangler` directory manually. This affects only the local database.

## Estructura

```text
apps/web       → aplicación Next.js
apps/realtime  → se creará al implementar La Mesa
packages/      → paquetes compartidos solo cuando exista reutilización real
docs/          → producto, arquitectura y OpenCode
```

## Dados standalone

`@repo/dice-engine` es un paquete TypeScript puro reutilizable por el navegador,
tests y la futura Mesa. `/dice` no requiere login, no usa D1 y no guarda
tiradas. El motor usa Web Crypto, admite hasta 20 dados por tirada y soporta
`d20`, `2d6` y `2d6+3`.

## Desarrollo

```powershell
pnpm dev
```

## Preview Cloudflare/workerd

```powershell
pnpm preview
```

## Quality gates

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Documentación

Empieza por:

- `AGENTS.md`
- `docs/product/vision.md`
- `docs/product/mvp.md`
- `docs/architecture/architecture.md`
- `docs/features/character-sheets.md` (canonical Character Sheets specification)

La configuración de OpenCode se encuentra en `opencode.jsonc` y `.opencode/`.
