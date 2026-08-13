# OpenCode commands manifest — Proyecto RPG

**Estado:** Aprobado  
**Fecha de revisión:** 12 de agosto de 2026

---

## 1. Catálogo

```text
/feature
/review
/test
/security
/adr
```

Los comandos viven en:

```text
.opencode/commands/
```

OpenCode utiliza el nombre del archivo Markdown como nombre del slash command.

---

# 2. `/feature`

Archivo:

```text
.opencode/commands/feature.md
```

Agente:

```text
build
```

Subtask:

```text
false
```

Uso:

```text
/feature Implementa el formulario y generación de NPC del MVP
```

Objetivo:

- iniciar una feature real;
- cargar `feature-development`;
- leer documentación relevante;
- proteger el alcance MVP;
- coordinar especialistas cuando sea útil;
- implementar;
- verificar;
- reportar.

Puede delegar:

```text
frontend
backend-db
qa
security
```

según la necesidad.

Si existe una duda material de producto/arquitectura que los documentos no resuelven, debe preguntar al usuario.

---

# 3. `/review`

Archivo:

```text
.opencode/commands/review.md
```

Agente:

```text
plan
```

Subtask:

```text
true
```

Uso:

```text
/review
```

revisa los cambios actuales.

O:

```text
/review apps/web/src/features/adventures
```

Revisión:

- bugs;
- arquitectura;
- límites;
- scope creep;
- Cloudflare compatibility;
- test gaps;
- mantenibilidad.

No modifica archivos.

No sustituye `/security`.

---

# 4. `/test`

Archivo:

```text
.opencode/commands/test.md
```

Agente:

```text
qa
```

Subtask:

```text
true
```

Uso:

```text
/test
```

o:

```text
/test dice parser
```

QA:

- inspecciona;
- ejecuta tests;
- puede crear/modificar tests;
- no puede corregir producción;
- clasifica fallos.

La ausencia de argumentos significa:

```text
inferir scope desde los cambios actuales
```

No significa ejecutar ciegamente toda la suite.

---

# 5. `/security`

Archivo:

```text
.opencode/commands/security.md
```

Agente:

```text
security
```

Subtask:

```text
true
```

Uso:

```text
/security public AI adventure endpoint
```

o simplemente:

```text
/security
```

para revisar cambios actuales.

Es read-only.

Produce:

- severidad;
- escenario;
- mitigación;
- decisión de bloqueo/no bloqueo.

---

# 6. `/adr`

Archivo:

```text
.opencode/commands/adr.md
```

Agente:

```text
build
```

Subtask:

```text
false
```

Uso:

```text
/adr Usaremos Context7 como único MCP activo al inicio; Cloudflare MCP queda diferido
```

El comando:

1. lee arquitectura/ADRs relacionados;
2. determina el siguiente número;
3. comprueba que la decisión está realmente resuelta;
4. crea el ADR;
5. actualiza arquitectura si cambia la fuente de verdad.

Si la decisión aún requiere una elección del usuario, debe preguntar antes de marcarla como aceptada.

No implementa código.

---

# 7. Por qué `subtask: true`

OpenCode permite forzar un command a ejecutarse como subagent con:

```yaml
subtask: true
```

Lo utilizamos en:

```text
/review
/test
/security
```

porque sus análisis pueden ser extensos y queremos que vuelvan al agente principal como resultado aislado.

No lo utilizamos en:

```text
/feature
/adr
```

porque ambos pueden necesitar edición/coordinación dentro del contexto de Build.

---

# 8. Modelos

Ningún command incluye:

```yaml
model:
```

Se mantiene la decisión previa de no fijar modelos de desarrollo en el repositorio.

El command utiliza la estrategia del agente configurado.

---

# 9. Argumentos

Los cinco commands utilizan:

```text
$ARGUMENTS
```

Ejemplos:

```text
/feature añade el generador de mapas
/test motor de dados
/security subida temporal de mapas a La Mesa
```

No necesitamos argumentos posicionales `$1`, `$2`, etc. en los workflows iniciales.

---

# 10. Shell output

OpenCode admite:

```text
!`command`
```

para ejecutar shell e insertar el resultado en el prompt.

No lo utilizamos inicialmente.

Motivos:

- puede inflar el contexto;
- ejecuta trabajo incluso antes de que el agente decida si es necesario;
- puede duplicar comandos;
- preferimos que Git/tests pasen por permisos normales del agente;
- hace el workflow más fácil de auditar.

---

# 11. File references

OpenCode también permite referencias:

```text
@path/file.ts
```

dentro de un command.

No fijamos referencias concretas en estos workflows porque su scope es dinámico.

Los agentes inspeccionan los archivos relevantes en cada ejecución.

---

# 12. Commands vs Skills

```text
Command
→ inicia un workflow explícito del usuario

Skill
→ aporta procedimiento especializado bajo demanda
```

Ejemplo:

```text
/feature ...
       ↓
Build
       ↓
feature-development skill
       ↓
optional ai-generation / rpg-frontend-style / external skill
```

No duplicamos el contenido completo de los skills dentro de los commands.

---

# 13. Commands vs Agents

```text
/feature  → Build
/review   → Plan
/test     → QA
/security → Security
/adr      → Build
```

Los commands seleccionan el rol apropiado y proporcionan el workflow específico.

---

# 14. Built-ins

No se redefinen:

```text
/init
/undo
/redo
/share
/help
```

ni ningún built-in conocido.

OpenCode permite sobrescribir built-ins con custom commands, pero no necesitamos hacerlo.

---

# 15. Ejemplo de ciclo

```text
/feature Añade el generador de aventuras MVP
         ↓
implementation

/test adventure generator
         ↓
QA result

/security adventure AI endpoint
         ↓
security result

/review
         ↓
architecture/code review
```

Si durante el trabajo se acepta una nueva decisión arquitectónica:

```text
/adr <decision>
```

---

# 16. Reglas de crecimiento

No añadir commands para:

- cada librería;
- cada carpeta;
- cada comando shell;
- acciones triviales que el lenguaje natural ya expresa claramente.

Crear un nuevo slash command solo si:

1. el workflow se repite;
2. requiere una secuencia consistente;
3. el agente/skill correcto no es obvio;
4. reduce errores o contexto innecesario.

---

# 17. Commands diferidos

No crear todavía:

```text
/deploy
/db-migrate
/release
/table-debug
/ai-eval
```

Se evaluarán cuando existan esos workflows reales.

Especialmente `/deploy` y `/db-migrate` implican operaciones sensibles y no deben aparecer antes de tener entornos/procedimientos concretos.
