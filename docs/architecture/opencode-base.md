# Configuración base de OpenCode — Proyecto RPG

**Fase:** 5 — Configuración base de OpenCode  
**Estado:** Aprobada para incorporar al repositorio cuando se inicialice  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026

## 1. Objetivo

Definir el contexto permanente, las reglas compartidas y la política de seguridad de OpenCode antes de crear agentes especializados, skills, MCPs o commands.

La configuración base está formada por:

```text
AGENTS.md
opencode.jsonc
docs/opencode/project-context.md
```

Los agentes especializados se definen en la Fase 6.

## 2. Estrategia de contexto

No se cargarán automáticamente todos los documentos de producto y arquitectura en cada sesión.

Motivo: OpenCode combina los archivos configurados en `instructions` con las reglas del proyecto; cargar toda la documentación permanentemente aumentaría el contexto y podría disminuir precisión.

Se utilizarán dos niveles:

### Always-on

```text
AGENTS.md
docs/opencode/project-context.md
```

Contienen:

- invariantes del producto;
- límites del MVP;
- fronteras arquitectónicas;
- disciplina de cambios;
- mapa de documentación.

### On-demand

```text
docs/product/*
docs/architecture/*
docs/architecture/adr/*
```

`AGENTS.md` indica qué documento debe leer el agente según la tarea.

## 3. `AGENTS.md`

Es la constitución técnica del repositorio.

Debe permanecer:

- relativamente conciso;
- estable;
- versionado en Git;
- válido para todos los agentes.

Incluye explícitamente:

- definición de one-shot;
- Table como único módulo realtime del MVP;
- `logged in != persistent resources`;
- prohibición de implementar premium por anticipación;
- abstracción de IA;
- dependencias permitidas/prohibidas;
- reglas de Cloudflare/workerd;
- validación y TypeScript;
- reglas de La Mesa;
- verificación;
- Git/destructive operations;
- carga selectiva de documentación.

## 4. `project-context.md`

Es el único archivo adicional configurado como `instructions`.

Su objetivo no es duplicar toda la arquitectura, sino mantener siempre visibles los pocos hechos de producto cuya interpretación incorrecta podría causar un rediseño:

- herramientas standalone;
- alcance de La Mesa;
- persistencia temporal;
- premium futuro;
- stack arquitectónico de alto nivel.

## 5. `opencode.jsonc`

La configuración de proyecto:

- desactiva sharing;
- mantiene snapshots;
- habilita LSP;
- carga únicamente el contexto pequeño;
- protege archivos de secretos;
- permite edición normal del repositorio;
- pide confirmación para instalaciones, commits y deploys;
- bloquea pushes y operaciones destructivas;
- ignora directorios ruidosos en el watcher.

## 6. Modelo/proveedor de OpenCode

No se fija `model` ni `provider` dentro del repositorio.

La elección del modelo utilizado para programar es una preferencia/coste de desarrollo y puede cambiar.

Se configurará a nivel personal/global de OpenCode o se elegirá desde la aplicación.

Los futuros agentes pueden recomendar modelos concretos, pero esa decisión pertenece a la Fase 6 y podrá ajustarse sin cambiar la arquitectura del producto.

## 7. Permisos

La política base distingue tres niveles:

### Automático

- lectura normal;
- edición normal;
- búsquedas;
- LSP;
- tests;
- lint;
- typecheck;
- build;
- comandos Git de solo lectura.

### Preguntar

- instalar/añadir/eliminar/actualizar dependencias;
- `git add`;
- `git commit`;
- deploy;
- acceso a directorios externos.

### Denegar

- `git push`;
- `git reset`;
- `git clean`;
- borrado genérico mediante `rm`/`Remove-Item`;
- lectura directa de secretos mediante las herramientas de archivos.

Los agentes especializados podrán ser aún más restrictivos en Fase 6.

## 8. Sharing

Se fija:

```json
"share": "disabled"
```

porque el repositorio y el desarrollo inicial son privados.

Si en el futuro se desea compartir una sesión de OpenCode, esta decisión debe revisarse explícitamente.

## 9. Snapshots

Se mantienen activos para conservar la capacidad de rollback de cambios realizados por agentes.

## 10. LSP

Se habilita LSP porque el proyecto TypeScript se beneficiará de navegación, referencias y diagnósticos.

La configuración concreta de TypeScript/LSP se validará en el bootstrap.

## 11. Watcher

Se excluyen:

```text
node_modules
.next
.open-next
.wrangler
coverage
playwright-report
test-results
dist
```

para reducir ruido y trabajo innecesario del watcher.

## 12. Estructura cuando se incorpore al repositorio

```text
/
├── AGENTS.md
├── opencode.jsonc
├── docs/
│   └── opencode/
│       └── project-context.md
└── .opencode/
    ├── agents/      [Fase 6]
    ├── skills/      [Fase 7]
    └── commands/    [Fase 9]
```

No se crearán todavía archivos de agentes, skills o commands en esta fase.

## 13. Instalación futura

Cuando iniciemos físicamente el repositorio:

1. copiar `AGENTS.md` a la raíz;
2. copiar `opencode.jsonc` a la raíz;
3. copiar `project-context.md` a `docs/opencode/`;
4. incorporar la documentación existente con rutas estables;
5. abrir OpenCode desde la raíz del repositorio;
6. comprobar que detecta el `AGENTS.md` y el config;
7. validar el schema/autocompletado de `opencode.jsonc`;
8. ejecutar una prueba de lectura de contexto antes de permitir cambios de código.

No ejecutaremos `/init` de forma ciega después de copiar nuestro `AGENTS.md`: OpenCode puede actualizar un `AGENTS.md` existente, pero cualquier cambio propuesto debe revisarse para no perder nuestras invariantes.

## 14. Qué queda fuera

Fase 5 no configura todavía:

- agentes especializados;
- modelos por agente;
- skills;
- MCP;
- custom commands;
- plugins.

## 15. Próxima fase

**Fase 6 — Agentes de OpenCode.**

Se definirán inicialmente:

```text
frontend
backend-db
qa
security
```

y se decidirán:

- primary/subagent;
- prompts;
- modelos;
- permisos;
- capacidad de delegar;
- fronteras de escritura.
