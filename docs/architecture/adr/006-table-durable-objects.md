# ADR-006 — La Mesa mediante Realtime Worker + Durable Objects

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Contexto

La Mesa necesita varios usuarios viendo y modificando el mismo estado en tiempo real.

## Alcance explícito

En el MVP, La Mesa es la **única** funcionalidad multiusuario y realtime. Aventuras, mapas generados, NPC, hojas y dados standalone no utilizarán esta infraestructura.

## Decisión

Desplegar un Worker específico de realtime.

Cada Mesa se coordinará mediante un Durable Object identificado por `tableId`.

Los clientes se conectarán mediante WebSockets.

## Reglas

- todos los participantes autenticados;
- credencial realtime de corta duración;
- estado server-authoritative;
- eventos tipados y validados;
- WebSocket Hibernation API;
- snapshot al reconectar;
- estado gratuito con expiración.

## Motivo de separación

La Mesa tiene un modelo de ejecución y desarrollo distinto del HTTP tradicional de Next.js. Mantenerla separada reduce el acoplamiento y facilita desarrollo/testing con Durable Objects.
