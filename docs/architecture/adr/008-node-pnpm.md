# ADR-008 — Node.js 24 LTS + pnpm

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Desarrollo local con Node.js 24 LTS y pnpm 11.x.

La versión exacta de pnpm quedará fijada en `packageManager` y las dependencias mediante lockfile.

## Motivo

Node 24 es LTS. pnpm aporta instalación eficiente y reproducible.

## Restricción

Producción usa Cloudflare workerd, por lo que compatibilidad Node local no es suficiente para aprobar una dependencia.
