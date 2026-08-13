# ADR-012 — Workers AI binding + abstracción propia

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

El primer provider de IA utilizará el binding nativo de Workers AI.

Las features solo dependerán de:

- `TextGenerationPort`;
- `ImageGenerationPort`.

## Consecuencia

Vercel AI SDK no será una dependencia obligatoria del MVP.

Podrá incorporarse dentro de adapters concretos si aporta posteriormente suficiente valor.

## Modelos

Los modelos se seleccionan por configuración, nunca desde features.
