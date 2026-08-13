# ADR-028 — El modelo de desarrollo no se fija en el repositorio

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

No incluir `model` ni `provider` en el `opencode.jsonc` compartido.

## Motivo

El modelo que ejecuta OpenCode es una elección de herramienta/coste de desarrollo y puede cambiar sin afectar al producto.

Los agentes especializados podrán tener preferencias de modelo en Fase 6 si existe una razón clara.
