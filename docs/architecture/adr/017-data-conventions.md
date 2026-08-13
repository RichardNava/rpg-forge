# ADR-017 — Convenciones de datos

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## IDs

Better Auth gestiona sus propios IDs.

Las entidades propias utilizarán IDs opacos. Para el MVP se admite `crypto.randomUUID()` sin añadir una dependencia específica.

## Timestamps

Datos propios:

- UTC;
- timestamps en milisegundos;
- nombres `createdAt`, `updatedAt`, `expiresAt`, `lastActivityAt`.

El schema de Better Auth utilizará los tipos generados por su CLI.

## JSON

JSON solo para estructuras variables.

Todo JSON persistido debe:

- tener `schemaVersion`;
- validarse con Zod.

## Regla

Datos consultables/relacionales deben ser columnas; estructuras de documento pueden ser JSON.
