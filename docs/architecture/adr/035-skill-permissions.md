# ADR-035 — Skills deny-by-default

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

La política global de `skill` será:

```text
deny by default
```

Build, Plan y cada agente especializado reciben una allow-list explícita.

## Motivo

Un skill nuevo o externo no debe quedar automáticamente disponible para todos los agentes.
