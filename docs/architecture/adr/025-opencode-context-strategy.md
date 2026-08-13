# ADR-025 — Contexto always-on pequeño + documentación bajo demanda

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Mantener siempre en contexto:

- `AGENTS.md`;
- `docs/opencode/project-context.md`.

La documentación extensa bajo `docs/product` y `docs/architecture` se lee solo cuando la tarea lo requiere.

## Motivo

Evitar saturar el contexto, manteniendo siempre visibles las invariantes críticas.

`AGENTS.md` contiene un mapa explícito para que los agentes sepan qué documentación cargar.
