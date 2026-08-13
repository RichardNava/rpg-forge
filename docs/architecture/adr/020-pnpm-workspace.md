# ADR-020 — pnpm workspace sin Turborepo

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Utilizar un único repositorio Git gestionado mediante `pnpm workspace`.

No utilizar Turborepo en el MVP.

## Motivo

Existen varios workspaces reales, pero no una complejidad de builds que justifique una capa adicional de orquestación.

Estructura:

```text
apps/*
packages/*
```

Los scripts raíz delegarán mediante filtros de pnpm.
