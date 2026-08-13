# ADR-044 — Commands no fijan modelo

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Ningún command incluye `model`.

## Motivo

El workflow del proyecto no debe acoplarse al proveedor/modelo utilizado por OpenCode.

Los commands seleccionan agentes; la estrategia de modelo permanece configurable independientemente.
