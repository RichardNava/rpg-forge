# ADR-036 — Revisión y versionado de skills externos

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Los skills externos:

1. se revisan antes de instalar;
2. se instalan localmente en el proyecto;
3. se inspeccionan incluyendo scripts/resources;
4. se versionan en Git después de aprobarlos;
5. se actualizan mediante diff/revisión, no de forma ciega.

## Motivo

Los skills son instrucciones ejecutables por agentes y forman parte de la cadena de suministro de desarrollo.
