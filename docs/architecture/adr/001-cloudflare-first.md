# ADR-001 — Arquitectura Cloudflare-first y free-first

**Estado:** Aceptada  
**Fecha:** 11/08/2026

## Contexto

El proyecto comienza sin ánimo de lucro y debe utilizar recursos gratuitos en sus fases iniciales. Ya se prevé utilizar Cloudflare para despliegue e IA.

## Decisión

Utilizar Cloudflare como plataforma de infraestructura primaria mientras sus servicios gratuitos cubran adecuadamente cada necesidad.

Servicios previstos:

- Workers;
- Workers AI;
- D1;
- Durable Objects;
- Turnstile;
- R2 cuando sea necesario.

## Consecuencias positivas

- menor complejidad operativa;
- una única plataforma principal;
- free tiers compatibles con una beta pequeña;
- bindings internos y buena integración entre servicios;
- despliegue edge.

## Riesgos

Mayor dependencia de Cloudflare.

## Mitigación

Introducir abstracciones únicamente donde exista un riesgo real de sustitución:

- `AIProvider`;
- `StoragePort`;
- repositories de persistencia.

No abstraer por abstracción.
