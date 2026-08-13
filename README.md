# RPG Project

Aplicación web para generar y utilizar recursos de juegos de rol de mesa.

> Nombre provisional del producto.

## Estado

Bootstrap técnico del MVP.

## Stack base

- Next.js 16
- TypeScript
- Tailwind CSS 4
- shadcn/ui + Base UI
- Cloudflare Workers + OpenNext
- pnpm workspace
- OpenCode project configuration

## Estructura

```text
apps/web       → aplicación Next.js
apps/realtime  → se creará al implementar La Mesa
packages/      → paquetes compartidos solo cuando exista reutilización real
docs/          → producto, arquitectura y OpenCode
```

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

La configuración de OpenCode se encuentra en `opencode.jsonc` y `.opencode/`.
