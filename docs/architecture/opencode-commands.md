# Commands de OpenCode — Proyecto RPG

**Fase:** 9 — Commands  
**Estado:** Aprobada  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026

## 1. Objetivo

Crear un conjunto mínimo de slash commands para los workflows que se repetirán durante el proyecto.

OpenCode descubre los commands del proyecto desde:

```text
.opencode/commands/*.md
```

El nombre del archivo se convierte en el comando.

## 2. Catálogo aprobado

```text
/feature
/review
/test
/security
/adr
```

No añadimos commands para tareas triviales ni para cada herramienta del stack.

## 3. `/feature`

```yaml
agent: build
subtask: false
```

Es el punto de entrada de implementación de una feature.

La descripción de usuario se recibe mediante:

```text
$ARGUMENTS
```

El workflow:

```text
request
→ AGENTS.md
→ feature-development skill
→ relevant docs
→ inspect code
→ resolve scope
→ implement/delegate
→ QA/security when relevant
→ quality gates
→ report
```

No decide por el usuario una ambigüedad material que la documentación no resuelva.

## 4. `/review`

```yaml
agent: plan
subtask: true
```

Revisión read-only:

```text
correctness
architecture
MVP boundaries
Cloudflare compatibility
test gaps
maintainability
```

Si no hay argumentos, revisa cambios actuales.

El resultado vuelve como subtask para evitar llenar el contexto principal con todo el análisis.

## 5. `/test`

```yaml
agent: qa
subtask: true
```

Ejecuta el workflow del agente QA.

Puede:

- ejecutar tests;
- modificar tests;
- crear regresiones.

No puede modificar producción.

Sin argumentos, infiere el scope desde los cambios actuales.

## 6. `/security`

```yaml
agent: security
subtask: true
```

Auditoría read-only y aislada.

Debe utilizarse especialmente en:

```text
auth
authorization
AI public endpoints
uploads
secrets
D1 ownership
R2
WebSockets
Durable Objects
dependencies
```

## 7. `/adr`

```yaml
agent: build
subtask: false
```

Registra una decisión arquitectónica aceptada.

Debe:

- encontrar ADRs relacionados;
- calcular el siguiente número;
- preservar ADRs históricos;
- preguntar al usuario si la decisión aún está materialmente abierta;
- actualizar documentación arquitectónica solo si procede;
- no implementar código.

## 8. Por qué commands Markdown

No añadimos estos workflows a `opencode.jsonc`.

Preferimos:

```text
.opencode/commands/*.md
```

porque:

- cada workflow es legible;
- puede versionarse/revisarse de forma independiente;
- el config permanece centrado en configuración;
- evita grandes strings de prompt dentro de JSONC.

## 9. Sin model pinning

No se configura:

```yaml
model:
```

en ningún command.

Esto mantiene la decisión de Fases 5/6 de separar:

```text
workflow del repositorio
≠
modelo/proveedor de desarrollo
```

## 10. Sin shell injection

OpenCode permite insertar salida de shell mediante:

```text
!`command`
```

pero los commands del proyecto no lo harán inicialmente.

Los agentes ejecutarán Git/tests mediante sus permisos normales.

Ventajas:

- ejecución visible;
- aprobación cuando corresponde;
- menos contexto innecesario;
- no ejecutar trabajo que el agente no necesite;
- política centralizada en permissions.

## 11. Relación con agentes

```text
/feature  → Build
/review   → Plan
/test     → QA
/security → Security
/adr      → Build
```

No se crea un nuevo agente para commands.

## 12. Relación con skills

`/feature` ordena cargar:

```text
feature-development
```

y deja que el trabajo active skills adicionales cuando proceda.

No copiamos el contenido completo de los skills al prompt del command.

## 13. Relación con MCP

Los commands no fuerzan Context7.

Los agentes recurren a Context7 únicamente si necesitan documentación externa actualizada, conforme a `AGENTS.md`.

Esto evita llamadas externas automáticas innecesarias.

## 14. Seguridad

No existen commands:

```text
/deploy
/push
/reset
/delete
```

durante esta fase.

Las operaciones sensibles siguen gobernadas por `opencode.jsonc`.

Un command nunca debe convertirse en una forma de eludir permissions.

## 15. Crecimiento futuro

Posibles commands futuros, solo con workflows reales:

```text
/deploy
/db-migrate
/release
/table-debug
/ai-eval
```

No se crean preventivamente.

## 16. Estructura resultante

```text
.opencode/
├── agents/
├── skills/
└── commands/
    ├── feature.md
    ├── review.md
    ├── test.md
    ├── security.md
    └── adr.md
```

## 17. Próxima fase

**Fase 10 — Bootstrap del proyecto Next.js/OpenCode.**

En esa fase dejaremos de diseñar y pasaremos a crear físicamente el repositorio:

```text
pnpm workspace
apps/web
Next.js
TypeScript
Tailwind/shadcn
OpenNext
Wrangler
docs
AGENTS.md
OpenCode config
agents
skills
commands
Context7
```

Antes de ejecutar instalaciones se verificarán nuevamente las versiones estables actuales.
