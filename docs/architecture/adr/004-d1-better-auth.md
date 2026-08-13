# ADR-004 — D1 + Better Auth

**Estado:** Aceptada para MVP/beta  
**Fecha:** 11/08/2026

## Contexto

La Mesa requiere usuarios autenticados, pero los generadores deben funcionar sin cuenta. Se busca coste cero y minimizar plataformas externas.

## Decisión

Utilizar:

- Better Auth como motor de autenticación;
- Cloudflare D1 como almacenamiento inicial de usuarios, sesiones y datos persistentes mínimos.

## Motivos

Better Auth es open source, compatible con Next.js y dispone de soporte para D1.

D1 pertenece a la misma plataforma de despliegue y dispone de free tier apto para una beta pequeña.

## Restricción

La lógica de negocio no accederá directamente a D1.

El acceso se realizará mediante repositorios/adaptadores para conservar una vía de migración a PostgreSQL u otra solución si las funciones premium futuras lo requieren.
