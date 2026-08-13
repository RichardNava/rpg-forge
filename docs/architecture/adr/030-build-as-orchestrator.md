# ADR-030 — Built-in Build remains the default coordinator

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Do not create a custom orchestrator agent in Phase 6.

Configure:

```json
"default_agent": "build",
"subagent_depth": 1
```

## Motivo

OpenCode already provides:

- Build for implementation;
- Plan for planning;
- Explore for codebase exploration;
- Scout for dependency/docs research.

A second orchestration layer would duplicate built-in behavior and increase agent nesting/cost.
