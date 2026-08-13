# ADR-045 — Bootstrap web mediante Cloudflare C3

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Contexto

La aplicación web debe ejecutarse como Next.js full-stack sobre Cloudflare Workers mediante OpenNext.

## Decisión

El scaffold inicial de `apps/web` se creará con el CLI oficial de Cloudflare:

```text
pnpm create cloudflare@latest apps/web --framework=next
```

C3 invoca el setup oficial de Next.js y configura OpenNext/Wrangler para Workers.

## Consecuencia

No crearemos primero un Next.js genérico para adaptar Cloudflare después.

`pnpm dev` sirve para desarrollo rápido sobre Node.js; `pnpm preview`/OpenNext es el checkpoint de compatibilidad con `workerd`.
