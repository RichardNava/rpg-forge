# ADR-015 — Exportación PDF

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Dos herramientas para dos necesidades diferentes:

- `@react-pdf/renderer` para documentos maquetados como aventuras/NPC;
- `pdf-lib` para hojas de personaje y PDFs rellenables.

Markdown se genera directamente desde los objetos del dominio.

## Motivo

No forzar una única librería a resolver problemas de maquetación multipágina y formularios PDF interactivos.
