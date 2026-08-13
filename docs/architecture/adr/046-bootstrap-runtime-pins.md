# ADR-046 — Pins de runtime para el bootstrap

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Para el bootstrap del 12/08/2026:

```text
Node.js 24.19.0 LTS
pnpm 11.20.0
```

`pnpm 12` no se adopta porque sigue en Release Candidate.

El `packageManager` raíz fija `pnpm@11.20.0` y `.nvmrc` documenta Node `24.19.0`.

## Consecuencia

Las versiones de dependencias de la aplicación quedan fijadas por `pnpm-lock.yaml` después del scaffold/instalación.
