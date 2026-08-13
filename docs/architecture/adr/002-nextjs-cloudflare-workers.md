# ADR-002 — Next.js full-stack sobre Cloudflare Workers

**Estado:** Aceptada  
**Fecha:** 11/08/2026

## Contexto

La aplicación necesita UI rica, renderizado híbrido, endpoints backend y una evolución rápida con TypeScript.

## Decisión

Usar Next.js App Router y desplegar la aplicación full-stack en Cloudflare Workers mediante el adaptador OpenNext.

Cloudflare Pages no será la plataforma principal del proyecto full-stack.

## Consecuencias

- frontend y backend web en un único framework;
- Server Components y Route Handlers disponibles;
- despliegue edge;
- debemos vigilar compatibilidad entre el entorno Node de desarrollo y `workerd`.

## Regla

Todo cambio de servidor deberá validarse mediante preview/runtime de Cloudflare antes de considerarse terminado.
