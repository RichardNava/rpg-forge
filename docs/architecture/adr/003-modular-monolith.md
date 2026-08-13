# ADR-003 — Monolito modular orientado a features

**Estado:** Aceptada  
**Fecha:** 11/08/2026

## Contexto

El producto tendrá varias capacidades independientes: aventuras, mapas, NPC, hojas, dados y La Mesa.

## Decisión

Organizar el código de negocio por features/dominos.

```text
features/
├── adventures/
├── maps/
├── npcs/
├── character-sheets/
├── dice/
└── table/
```

Infraestructura común:

```text
lib/
├── ai/
├── auth/
├── db/
├── export/
├── security/
└── storage/
```

## Consecuencias

- agentes de OpenCode pueden trabajar en áreas concretas;
- menor acoplamiento;
- las features pueden evolucionar de forma independiente;
- se evita la complejidad de microservicios prematuros.

El Worker realtime de La Mesa se considera un componente de infraestructura especializado, no un microservicio de dominio.
