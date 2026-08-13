# ADR-013 — react-konva + Zustand + WebSocket nativo

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

La Mesa utilizará:

- Konva/react-konva para canvas;
- Zustand para estado interactivo del cliente;
- WebSocket nativo;
- Durable Objects como estado autoritativo;
- Zod para protocolo.

## Regla

No serializar objetos Konva en el protocolo realtime.

Los mensajes transportan datos del dominio.

## Alcance

Esta infraestructura pertenece exclusivamente a La Mesa durante el MVP.
