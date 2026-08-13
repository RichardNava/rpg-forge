# Bootstrap del repositorio — Proyecto RPG

**Fase:** 10 — Bootstrap  
**Estado:** Preparado para ejecución local  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026  
**Entorno objetivo:** Windows 10 + OpenCode Desktop/CLI

---

## 1. Objetivo

Materializar las decisiones de Fases 0–9 en un repositorio real y verificable.

Al terminar:

```text
Git repository
pnpm workspace
apps/web (Next.js + OpenNext + Wrangler)
Tailwind
shadcn/Base UI
docs con rutas estables
AGENTS.md
opencode.jsonc
agents
custom skills
commands
Context7 MCP
root quality scripts
```

No se crean todavía recursos remotos de producto.

---

## 2. Versiones fijadas para esta ejecución

A fecha 12/08/2026:

```text
Node.js 24.19.0 LTS
pnpm 11.20.0
Next.js 16.x (C3/create-next-app resolverá la estable actual)
Cloudflare C3 latest
OpenNext Cloudflare latest compatible
Wrangler latest compatible
shadcn CLI latest
Base UI
```

`pnpm 12` queda fuera porque sigue en RC.

El `pnpm-lock.yaml` generado por el bootstrap será la fuente exacta de las versiones instaladas.

---

## 3. Estrategia

No generamos un Next.js genérico para adaptarlo después.

Usamos directamente:

```powershell
pnpm create cloudflare@latest apps/web --framework=next
```

Cloudflare C3 ejecuta la configuración oficial de Next.js y añade el adaptador OpenNext/Wrangler.

---

## 4. Prerrequisitos Windows

Comprobar:

```powershell
node --version
pnpm --version
git --version
opencode --version
```

Esperado para Node/pnpm:

```text
v24.19.0
11.20.0
```

En Windows, pnpm recomienda actualmente instalación mediante npm:

```powershell
npm install -g pnpm@11.20.0
```

No continuar con pnpm 12 RC.

---

## 5. Kit

El ZIP de Fase 10 contiene:

```text
overlay/
scripts/
docs de Fase 10
```

`overlay/` es el contenido que debe vivir en la raíz del repositorio.

No contiene `apps/web`, porque esa carpeta debe generarla C3 con las dependencias actuales.

---

## 6. Creación recomendada

Extraer el kit fuera de la carpeta final del proyecto.

Abrir PowerShell en la carpeta extraída y ejecutar:

```powershell
.\scripts\bootstrap.ps1 -ProjectPath "C:\ruta\rpg-project"
```

La carpeta destino debe estar vacía o no existir.

---

## 7. Wizard de Cloudflare / Next.js

Cuando el CLI pregunte, usar estas decisiones:

```text
Deploy now?
→ No
```

Para el setup de Next.js, si solicita personalización:

```text
Recommended defaults?
→ No / Customize

TypeScript
→ Yes

Linter
→ ESLint

React Compiler
→ No

Tailwind CSS
→ Yes

src/ directory
→ Yes

App Router
→ Yes

Import alias
→ @/*
```

Si C3 pregunta por Git dentro de `apps/web`, responder **No**: Git pertenece a la raíz del workspace.

El script elimina defensivamente un `.git` anidado si el generador lo crease.

---

## 8. shadcn

Después del scaffold el script ejecuta:

```powershell
pnpm dlx shadcn@latest init
```

Base UI es actualmente el default recomendado para nuevos proyectos.

Mantener:

```text
Base UI
CSS variables
Lucide
```

El script ajusta después los aliases a:

```text
components → @/shared/components
ui         → @/shared/components/ui
lib        → @/shared
hooks      → @/shared/hooks
utils      → @/shared/utils/cn
```

Si `shadcn init` crea `src/lib/utils.ts`, se mueve a:

```text
src/shared/utils/cn.ts
```

---

## 9. Qué NO crear

Fase 10 no crea:

```text
apps/realtime
packages/dice-engine
packages/table-contracts
D1
R2
Durable Objects
Better Auth
Workers AI binding
campaigns
premium
RAG
payments
```

Tampoco se despliega nada.

---

## 10. External skills

Los 3 skills externos aprobados no se instalan automáticamente por el script.

Motivo: la política acordada exige revisar el `SKILL.md` upstream antes de incorporar una dependencia de agentes.

Después del bootstrap, revisar:

```text
docs/opencode/external-skills.md
```

y solo entonces instalar:

```powershell
npx skills add cloudflare/skills --skill cloudflare -a opencode
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices -a opencode
npx skills add vercel-labs/agent-skills --skill web-design-guidelines -a opencode
```

Los skills propios ya vienen dentro de `.opencode/skills`.

---

## 11. Context7

`opencode.jsonc` ya contiene el MCP remoto:

```text
context7
```

No requiere almacenar una clave en Git.

Diagnóstico posterior:

```powershell
opencode mcp list
```

Si se añade una API key más adelante, debe hacerse mediante variable de entorno.

---

## 12. Verificación automática

Después del scaffold:

```powershell
.\scripts\verify-bootstrap.ps1 -ProjectPath "C:\ruta\rpg-project"
```

Comprueba:

- Node/pnpm;
- archivos obligatorios;
- workspace;
- OpenCode config;
- agentes;
- skills propios;
- commands;
- documentación estable;
- instalación;
- lint;
- typecheck;
- build Next.js;
- build OpenNext.

---

## 13. Verificación manual de `workerd`

Desde la raíz:

```powershell
pnpm preview
```

Abrir la URL local que indique Wrangler/OpenNext.

Esta prueba es obligatoria porque:

```text
pnpm dev
→ Node.js

pnpm preview
→ Cloudflare workerd
```

Que `dev` funcione no demuestra compatibilidad con producción.

Detener con:

```text
Ctrl+C
```

---

## 14. Verificación OpenCode

Abrir OpenCode **desde la raíz** del nuevo repositorio.

Comprobar:

### Contexto

Preguntar, por ejemplo:

```text
¿Cuál es la única funcionalidad realtime del MVP?
```

Debe responder:

```text
La Mesa
```

Y:

```text
¿Estar logueado implica que los recursos generados se guardan?
```

Debe responder:

```text
No
```

### Agentes

Deben estar disponibles:

```text
frontend
backend-db
qa
security
```

### Commands

Deben existir:

```text
/feature
/review
/test
/security
/adr
```

### Skills propios

```text
feature-development
rpg-frontend-style
ai-generation
```

### MCP

```text
Context7
```

---

## 15. No ejecutar `/init` a ciegas

Ya tenemos un `AGENTS.md` diseñado y revisado.

No ejecutar `/init` para que regenere reglas sin revisar el diff.

Si se utiliza `/init`, cualquier modificación a `AGENTS.md` debe revisarse antes de aceptarla.

---

## 16. Git

Al final del bootstrap:

```powershell
git status
```

Debe mostrar el scaffold y configuración como cambios no comprometidos.

El script no ejecuta:

```text
git add
git commit
git push
```

El primer commit se hará explícitamente después de revisar el resultado.

---

## 17. Checkpoint de Fase 10

Fase 10 termina cuando:

- [ ] Node 24.19.0 está activo.
- [ ] pnpm 11.20.0 está activo.
- [ ] existe un único repositorio Git raíz.
- [ ] `apps/web` existe.
- [ ] C3/OpenNext/Wrangler están configurados.
- [ ] Tailwind funciona.
- [ ] shadcn/Base UI está inicializado.
- [ ] documentación está bajo rutas estables.
- [ ] `AGENTS.md` está en raíz.
- [ ] `opencode.jsonc` está en raíz.
- [ ] agentes/skills/commands aparecen en OpenCode.
- [ ] Context7 aparece como MCP.
- [ ] `pnpm lint` pasa.
- [ ] `pnpm typecheck` pasa.
- [ ] `pnpm build` pasa.
- [ ] OpenNext build pasa.
- [ ] `pnpm preview` funciona sobre `workerd`.
- [ ] no se ha desplegado nada.
- [ ] no existen todavía D1/R2/DO/premium.

---

## 18. Próximo paso

Tras este checkpoint comienza la implementación funcional.

El siguiente bloque del roadmap original era autenticación/DB después del bootstrap, pero antes de construir features conviene realizar un **commit base limpio** y trabajar a partir de `/feature`.
