# ADR-011 — D1 + Drizzle + Better Auth

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

- Cloudflare D1;
- Drizzle ORM/Kit estable;
- Better Auth;
- Drizzle adapter para Better Auth.

## Motivo

Unifica modelado y migraciones alrededor de Drizzle y mantiene la infraestructura dentro de Cloudflare.

## Restricción

No utilizar releases RC de Drizzle en el bootstrap salvo que hayan alcanzado GA y superen validación de compatibilidad.
