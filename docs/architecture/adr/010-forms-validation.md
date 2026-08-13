# ADR-010 — React Hook Form + Zod 4

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

React Hook Form gestionará formularios interactivos y Zod 4 será el contrato de validación runtime.

## Regla

La validación cliente nunca sustituye la validación servidor.

Los schemas Zod se reutilizarán en cliente, servidor, HTTP y protocolo realtime cuando sea apropiado.
