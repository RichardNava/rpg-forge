# OpenCode Commands — Cheatsheet

**Proyecto:** RPG Project  
**Uso:** referencia rápida para elegir el command correcto  
**Fecha:** 12 de agosto de 2026

---

# Vista rápida

| Quiero...                                     | Command     |
| --------------------------------------------- | ----------- |
| Crear o modificar una funcionalidad           | `/feature`  |
| Revisar código/arquitectura sin tocar nada    | `/review`   |
| Probar una funcionalidad o buscar regresiones | `/test`     |
| Auditar seguridad/privacidad                  | `/security` |
| Registrar una decisión arquitectónica         | `/adr`      |

---

# 1. `/feature`

## Úsalo cuando...

Quieres **construir o modificar comportamiento real del producto**.

Ejemplos:

```text
/feature Implementa el generador de NPC del MVP
```

```text
/feature Añade edición del resultado generado en el generador de aventuras
```

```text
/feature Crea el lanzador de dados standalone
```

```text
/feature Añade soporte responsive al formulario de mapas
```

```text
/feature Implementa la generación de mapas mediante Workers AI
```

## También úsalo si...

La tarea implica varias capas:

```text
UI
+
schema
+
backend
+
IA
+
tests
```

Ejemplo:

```text
/feature Implementa el generador completo de aventuras one-shot
```

Build podrá coordinar:

```text
@frontend
@backend-db
@qa
@security
```

## NO lo uses para...

Solo revisar código:

```text
/review
```

Solo probar:

```text
/test
```

Solo revisar seguridad:

```text
/security
```

Registrar una decisión:

```text
/adr
```

## Regla mental

```text
¿Quiero cambiar cómo funciona el producto?
→ /feature
```

---

# 2. `/review`

## Úsalo cuando...

Quieres una **segunda revisión técnica sin modificar archivos**.

Ejemplo general:

```text
/review
```

Sin argumentos revisa los cambios actuales del working tree.

## Escenarios típicos

### Antes de considerar terminada una feature

```text
/review
```

### Revisar una feature concreta

```text
/review apps/web/src/features/adventures
```

### Revisar arquitectura

```text
/review arquitectura del generador de mapas
```

### Revisar un refactor

```text
/review separación entre core e infrastructure
```

### Revisar si se está violando el MVP

```text
/review comprueba que el login no esté provocando persistencia automática de recursos
```

### Revisar compatibilidad Cloudflare

```text
/review cambios del backend por compatibilidad con workerd
```

## Qué busca

```text
bugs
arquitectura incorrecta
dependencias indebidas
scope creep
features premium anticipadas
persistencia incorrecta
realtime fuera de La Mesa
problemas TypeScript/Zod
tests insuficientes
refactors innecesarios
```

## NO lo uses para...

Auditoría de seguridad profunda:

```text
/security
```

Ejecutar pruebas:

```text
/test
```

Modificar código:

```text
/feature
```

## Regla mental

```text
¿Quiero que alguien revise lo hecho sin tocarlo?
→ /review
```

---

# 3. `/test`

## Úsalo cuando...

Quieres **verificar comportamiento automáticamente**.

Ejemplo:

```text
/test motor de dados
```

## Escenarios típicos

### Después de implementar una feature

```text
/test adventure generator
```

### Reproducir un bug

```text
/test reproduce el fallo al lanzar 4d6kh3
```

### Crear un regression test

```text
/test añade una prueba que cubra el bug corregido en el parser de dados
```

### Comprobar un componente React

```text
/test formulario de generación de NPC
```

### Probar D1 / Worker / Durable Object

```text
/test creación y reconexión de La Mesa
```

### Probar flujo E2E

```text
/test flujo completo de invitado: generar aventura, editar y descargar
```

### Sin scope explícito

```text
/test
```

QA inspeccionará los cambios actuales y decidirá qué pruebas son relevantes.

## Qué puede hacer QA

```text
ejecutar tests
crear tests
modificar tests
crear fixtures
crear regression tests
```

## Qué NO puede hacer

```text
modificar código de producción
```

Si encuentra un fallo:

```text
QA
→ identifica defecto
→ recomienda frontend/backend
→ agente de implementación corrige
→ QA vuelve a verificar
```

## Regla mental

```text
¿Quiero demostrar que funciona?
→ /test
```

---

# 4. `/security`

## Úsalo cuando...

La tarea toca una **frontera de seguridad o privacidad**.

Ejemplo:

```text
/security public AI adventure endpoint
```

## Úsalo especialmente para...

### Autenticación

```text
/security integración Better Auth
```

### Autorización

```text
/security permisos host/participant en La Mesa
```

### IA pública

```text
/security endpoint público de generación de mapas
```

### Turnstile / rate limiting

```text
/security protección anti-abuso del generador de NPC
```

### Uploads

```text
/security subida temporal de mapas a La Mesa
```

### D1

```text
/security ownership y acceso a datos de usuario
```

### R2

```text
/security acceso a mapas temporales almacenados en R2
```

### Secrets

```text
/security configuración de secrets y bindings Cloudflare
```

### WebSockets

```text
/security autenticación y mensajes WebSocket de La Mesa
```

### Durable Objects

```text
/security Durable Object de TableSession
```

### Dependencias nuevas

```text
/security nueva dependencia para generación de PDF
```

## Sin scope explícito

```text
/security
```

Revisa los cambios actuales buscando superficies sensibles.

## Resultado

Hallazgos clasificados como:

```text
Critical
High
Medium
Low
Informational
```

y para cada uno:

```text
ubicación
riesgo
escenario
mitigación
bloquea/no bloquea release
```

## NO lo uses para...

Revisión general de arquitectura:

```text
/review
```

Arreglar directamente el problema:

```text
/feature
```

Security es read-only.

## Regla mental

```text
¿Puede afectar a seguridad, privacidad, permisos o exposición?
→ /security
```

---

# 5. `/adr`

## Úsalo cuando...

Se ha tomado una **decisión arquitectónica importante que queremos conservar en el historial del proyecto**.

Ejemplo:

```text
/adr Context7 será el único MCP activo inicialmente
```

## Escenarios típicos

### Elegir tecnología

```text
/adr Usaremos Drizzle ORM sobre D1
```

### Cambiar una decisión anterior

```text
/adr Sustituimos la estrategia X por Y debido a ...
```

### Establecer una frontera de arquitectura

```text
/adr La Mesa será el único módulo realtime del MVP
```

### Decidir almacenamiento

```text
/adr Los mapas temporales de La Mesa se almacenarán en R2
```

### Decidir organización del repositorio

```text
/adr apps/web y apps/realtime serán deployables independientes dentro del mismo pnpm workspace
```

## Qué hace

```text
lee arquitectura
↓
busca ADR relacionados
↓
calcula siguiente número
↓
comprueba que la decisión está cerrada
↓
crea ADR
↓
actualiza documentación si procede
```

## Importante

Si la decisión **todavía no está clara**, `/adr` no debe inventarla.

Debe preguntarte primero.

## NO lo uses para...

Ideas tentativas:

```text
"Quizá usemos Redis"
```

Todavía no es un ADR.

Primero:

```text
analizar
decidir
```

Luego:

```text
/adr ...
```

## Regla mental

```text
¿Hemos tomado una decisión que probablemente querremos recordar dentro de 6 meses?
→ /adr
```

---

# Decisión rápida

```text
¿Voy a IMPLEMENTAR algo?
        ↓
     /feature
```

```text
¿Quiero REVISAR lo implementado?
        ↓
     /review
```

```text
¿Quiero PROBAR que funciona?
        ↓
      /test
```

```text
¿Puede haber un RIESGO de seguridad?
        ↓
    /security
```

```text
¿Hemos tomado una DECISIÓN arquitectónica?
        ↓
      /adr
```

---

# Flujo recomendado para una feature normal

```text
/feature Implementa X
        ↓
/test X
        ↓
/review
```

Si toca seguridad:

```text
/feature Implementa X
        ↓
/test X
        ↓
/security X
        ↓
/review
```

Si además aparece una nueva decisión arquitectónica:

```text
/feature Implementa X
        ↓
decisión arquitectónica
        ↓
/adr <decisión>
        ↓
/test X
        ↓
/security X   [si procede]
        ↓
/review
```

---

# Ejemplos específicos del proyecto

## Generador de aventuras

```text
/feature Implementa el generador de one-shots del MVP
/test adventure generator
/security public adventure generation endpoint
/review
```

---

## Motor de dados

```text
/feature Implementa el parser y evaluador del motor de dados
/test dice engine
/review packages/dice-engine
```

Normalmente no necesita `/security` salvo que cambie la fuente de aleatoriedad o exista interacción remota.

---

## Login

```text
/feature Implementa Better Auth con Google OAuth
/test authentication flow
/security Better Auth integration
/review
```

---

## Generación de mapas

```text
/feature Implementa generación de mapas con Workers AI
/test map generator
/security public map generation endpoint
/review
```

---

## La Mesa

```text
/feature Implementa creación y unión a una Mesa
/test Table create/join/reconnect
/security Table authentication and realtime authorization
/review
```

Para cambios importantes de arquitectura realtime:

```text
/adr <decisión aceptada>
```

---

## Nueva dependencia

Antes de usarla:

```text
/review necesidad de introducir <library>
```

Si es una decisión arquitectónica relevante:

```text
/adr Usaremos <library> para ...
```

Si afecta seguridad/supply chain:

```text
/security nueva dependencia <library>
```

---

# Lo que NO necesitas escribir

No necesitas decir:

```text
@qa ejecuta los tests...
```

si el workflow es simplemente:

```text
/test ...
```

No necesitas decir:

```text
@security revisa...
```

si puedes usar:

```text
/security ...
```

No necesitas pedir manualmente:

```text
usa feature-development skill
```

porque:

```text
/feature
```

ya indica a Build que debe cargarlo.

---

# Regla final

Los commands son **atajos de workflow**, no limitaciones.

Puedes seguir hablando directamente con:

```text
Build
Plan
@frontend
@backend-db
@qa
@security
```

cuando una tarea no encaje en uno de estos flujos o quieras controlar manualmente la delegación.
