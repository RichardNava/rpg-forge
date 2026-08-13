# ADR-039 — GitHub y Playwright MCP omitidos inicialmente

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## GitHub

No se instala mientras Git local cubra el workflow.

Reconsiderar si issues/PRs/Actions pasan a formar parte del trabajo operativo del agente.

## Playwright

No se instala.

El proyecto utilizará Playwright Test y CLI/shell.

La documentación actual de Playwright recomienda CLI para coding agents por menor coste de contexto; MCP queda reservado a workflows exploratorios/agénticos que realmente lo necesiten.
