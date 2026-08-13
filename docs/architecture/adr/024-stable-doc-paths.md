# ADR-024 — Rutas documentales estables

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Al incorporar la documentación al repositorio se utilizarán nombres estables:

```text
docs/product/vision.md
docs/product/mvp.md
docs/product/feature-map.md

docs/architecture/architecture.md
docs/architecture/stack.md
docs/architecture/data-model.md
docs/architecture/repository-structure.md
```

No se incluirá la versión en el nombre del archivo.

## Motivo

La versión pertenece al contenido y al historial Git.

Esto permite que:

```text
AGENTS.md
opencode.jsonc
```

usen referencias permanentes.

Los ADR conservarán números estables y nunca se eliminarán para ocultar decisiones históricas.
