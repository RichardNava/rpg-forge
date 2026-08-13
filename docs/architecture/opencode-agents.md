# Agentes de OpenCode — Proyecto RPG

**Fase:** 6 — Agentes  
**Estado:** Aprobada  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026

## 1. Objetivo

Definir los primeros agentes especializados de OpenCode sin duplicar los agentes integrados `Build`, `Plan`, `General`, `Explore` y `Scout`.

Agentes de proyecto:

```text
frontend
backend-db
qa
security
```

## 2. Estrategia de agentes

Los cuatro agentes utilizan:

```text
mode: all
```

Esto permite dos modos de trabajo:

### Directo

El usuario puede seleccionar un especialista como agente principal en una sesión.

Ejemplo:

```text
frontend
→ sesión dedicada a UI

backend-db
→ sesión dedicada a servidor
```

### Delegado

`Build` puede invocarlos como subagentes cuando sus descripciones coincidan con una unidad de trabajo.

También pueden invocarse manualmente:

```text
@frontend
@backend-db
@qa
@security
```

## 3. Orquestación

No se crea un agente `orchestrator`.

Se mantienen:

```text
Build
→ primary default / implementation coordinator

Plan
→ planning and analysis

Explore
→ read-only repository exploration

Scout
→ external documentation/dependency research
```

La especialización se añade sin sustituir capacidades integradas.

## 4. Modelo

Ningún agente fija un modelo.

Comportamiento de OpenCode:

- si se usa como primary, utiliza el modelo global configurado;
- si se invoca como subagent sin modelo propio, hereda el modelo del primary que lo invocó.

Esto evita acoplar el repositorio a proveedor/coste de desarrollo.

## 5. Profundidad

Se recomienda configurar:

```json
"default_agent": "build",
"subagent_depth": 1
```

`Build` puede delegar en especialistas.

Los especialistas ejecutados como subagentes no generan árboles adicionales de agentes.

Cuando un especialista se selecciona directamente como primary, sus permisos `task` solo le permiten usar `Explore` y `Scout`.

## 6. Frontend

### Propósito

Responsable de:

- Next.js UI;
- React;
- layouts/pages;
- Tailwind;
- shadcn/Base UI;
- accesibilidad;
- responsive;
- themed components;
- client-side Table UI/Konva.

### Puede editar

Principalmente:

```text
apps/web/src/app
except app/api

features/*/components
features/*/state
features/*/realtime client
shared
public
```

### No puede editar

- D1/migrations;
- infrastructure;
- Durable Object server;
- API backend.

## 7. Backend DB

El nombre se conserva por continuidad, aunque su alcance real es backend + database + Cloudflare platform.

Responsable de:

- application/domain logic;
- Zod server schemas;
- prompts;
- AI ports/adapters;
- Workers AI;
- D1/Drizzle;
- Better Auth;
- Route Handlers;
- dice engine;
- Table contracts;
- realtime Worker;
- Durable Objects.

No es el agente de UI.

## 8. QA

Responsable exclusivamente de calidad automatizada.

Puede:

- leer toda la implementación;
- crear/modificar tests;
- ejecutar test/lint/typecheck/build/E2E.

No puede modificar producción.

Cuando encuentra un bug:

```text
QA reproduces/tests
→ implementation agent fixes
→ QA verifies
```

## 9. Security

Agente deliberadamente read-only.

Revisa:

- secrets;
- auth/authz;
- AI abuse;
- uploads;
- D1;
- R2;
- dependencies;
- realtime;
- Durable Objects;
- privacidad.

No corrige directamente.

Produce findings priorizados y mitigaciones.

## 10. Separación de escritura

El objetivo no es impedir absolutamente toda zona compartida, sino reducir cambios accidentales.

Resumen:

| Área                       | frontend |            backend-db |         qa | security |
| -------------------------- | -------: | --------------------: | ---------: | -------: |
| UI/components              |     Edit |                    No | Tests only |     Read |
| pages/layouts              |     Edit |                    No | Tests only |     Read |
| API                        |       No |                  Edit | Tests only |     Read |
| feature domain/application |       No |                  Edit | Tests only |     Read |
| core                       |       No |                  Edit | Tests only |     Read |
| infrastructure             |       No |                  Edit | Tests only |     Read |
| D1/Drizzle                 |       No |                  Edit | Tests only |     Read |
| realtime server            |       No |                  Edit | Tests only |     Read |
| Table client               |     Edit | Contracts/server only | Tests only |     Read |
| shared tests               |       No |                    No |       Edit |     Read |

Shared/public feature `index.ts` changes require approval for implementation agents because they alter a feature boundary.

## 11. Bash

Implementation agents may automatically run known verification commands and read-only Git commands.

Unknown shell commands require approval.

QA has the same verification capability.

Security may run read-only checks plus `pnpm audit`.

Global project restrictions continue to block push/destructive operations.

## 12. Task delegation

Specialists may invoke only:

```text
explore
scout
```

when acting as primary.

They cannot autonomously invoke one another.

This keeps coordination visible:

```text
User / Build
      ↓
frontend
backend-db
qa
security
```

rather than:

```text
agent
 ↓
agent
 ↓
agent
 ↓
agent
```

## 13. Parallel work

Recommended safe parallel example:

```text
frontend
→ Adventure form/components

backend-db
→ Adventure schema/use case/AI adapter

qa
→ Acceptance tests / E2E preparation

security
→ Review existing AI endpoint design
```

Avoid assigning two agents simultaneous edits to the same file or contract.

The agents operate on the same project repository; parallel specialization does not imply automatic merge/conflict isolation.

## 14. Recommended feature workflow

For a substantial feature:

```text
Plan
  ↓
Backend/Frontend implementation in bounded work
  ↓
QA
  ↓
Security when relevant
  ↓
Build integrates / final verification
```

Security should be mandatory for:

- auth;
- uploads;
- AI public endpoints;
- secrets/configuration;
- D1 ownership;
- R2 access;
- The Table/realtime.

## 15. Agent files

```text
.opencode/agents/
├── frontend.md
├── backend-db.md
├── qa.md
└── security.md
```

The markdown file name is the OpenCode agent name.

## 16. Skills

Skills are not embedded into these prompts yet.

Phase 7 will:

- create/select skills;
- define which agents can see each skill;
- update agent skill permissions if needed.

Agent prompts describe responsibilities; skills describe reusable procedures.

## 17. MCP

No MCP-specific permissions are defined yet.

Phase 8 will introduce MCP servers and then restrict their tools per agent where appropriate.

## 18. Commands

Phase 9 will connect commands such as:

```text
/feature
/review
/test
/security
```

to these agents/subtasks.

## 19. OpenCode config change

Phase 6 adds to the project config:

```json
"default_agent": "build",
"subagent_depth": 1
```

The agents themselves are discovered automatically from `.opencode/agents/`; they do not need to be duplicated inside `opencode.jsonc`.

## 20. Next phase

**Fase 7 — Skills.**

We will choose a deliberately small set of skills and determine whether each one should be:

- authored specifically for this project;
- adapted from an external skill;
- omitted because `AGENTS.md`/agent prompts already cover it.
