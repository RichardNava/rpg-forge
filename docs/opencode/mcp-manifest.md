# MCP manifest — Proyecto OpenCode RPG

**Estado:** Aprobado  
**Fecha de revisión:** 12 de agosto de 2026

---

## 1. Principio

MCP se utiliza únicamente cuando aporta acceso externo que OpenCode no cubre suficientemente con:

```text
repository read/edit
shell
Git
web search/fetch
skills
project documentation
```

Cada MCP añade herramientas y contexto al modelo, por lo que el catálogo debe permanecer pequeño.

---

# 2. MCP activo desde el inicio

## Context7

**Estado:** ACTIVO  
**Tipo:** Remote MCP  
**Proveedor:** Context7 / Upstash  
**Uso:** documentación actualizada y específica de versión para librerías/frameworks.

Configuración:

```jsonc
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "enabled": true
  }
}
```

OpenCode documenta directamente esta configuración para Context7.

### Autenticación

La conexión básica puede utilizarse sin incluir un secreto en el repositorio.

Una cuenta/API key puede proporcionar límites superiores. Si se utiliza en el futuro:

```jsonc
"headers": {
  "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
}
```

La clave nunca debe escribirse directamente en `opencode.jsonc`.

### Cuándo usarlo

Usar Context7 cuando la respuesta dependa de:

- sintaxis actual;
- API de una versión concreta;
- configuración de una librería;
- patrones actuales del framework;
- una dependencia que pueda haber cambiado.

Ejemplos:

```text
Next.js
Better Auth
Drizzle
Zod
Tailwind
shadcn
Konva
Zustand
Vitest
Playwright
OpenNext
```

### Cuándo NO usarlo

No utilizarlo para:

- decisiones de producto definidas en `docs/`;
- arquitectura propia;
- búsqueda de archivos locales;
- lógica del proyecto ya visible en el repositorio;
- preguntas estables que no requieren documentación externa.

### Agentes autorizados

```text
Build
Plan
frontend
backend-db
qa
security
```

Las herramientas `context7_*` están denegadas globalmente y habilitadas explícitamente para estos agentes.

---

# 3. MCP aprobado pero diferido

## Cloudflare API MCP

**Estado:** DIFERIDO  
**Proveedor:** Cloudflare  
**Endpoint oficial:**

```text
https://mcp.cloudflare.com/mcp
```

Cloudflare ofrece un MCP remoto administrado que expone su API mediante dos herramientas conceptuales:

```text
search
execute
```

Su enfoque Code Mode evita cargar miles de schemas de endpoints en contexto.

### Por qué no activarlo todavía

Durante las primeras fases OpenCode necesita principalmente:

- documentación de Cloudflare;
- código local;
- Wrangler;
- preview;
- tests.

Ya disponemos de:

```text
Cloudflare skill
Context7
web
Wrangler
```

El MCP de cuenta añade capacidad real de leer/modificar recursos de Cloudflare y, por tanto, una superficie de permisos que no necesitamos todavía.

### Activarlo cuando

Sea necesario que OpenCode trabaje directamente con recursos de la cuenta, por ejemplo:

- revisar/configurar un Worker desplegado;
- crear o inspeccionar bindings;
- gestionar D1/R2;
- consultar configuración o logs del entorno remoto;
- automatizar infraestructura real.

### Autenticación futura

OpenCode soporta OAuth para MCP remotos.

Configuración futura:

```jsonc
"cloudflare-api": {
  "type": "remote",
  "url": "https://mcp.cloudflare.com/mcp",
  "enabled": true
}
```

Después:

```powershell
opencode mcp auth cloudflare-api
```

El usuario deberá revisar los permisos OAuth concedidos.

### Política futura

Las llamadas capaces de modificar la cuenta deberán requerir aprobación humana.

No conceder permisos más amplios de los necesarios.

---

# 4. MCP no instalado inicialmente

## GitHub MCP

**Estado:** OMITIDO / REEVALUAR SI APARECE UN WORKFLOW REMOTO**

GitHub mantiene un servidor MCP oficial capaz de:

- leer repositorios;
- gestionar issues;
- gestionar pull requests;
- automatizar workflows.

### Motivos para no instalarlo

El MVP inicial trabaja con:

```text
repositorio local
Git local
GitHub privado
```

OpenCode ya dispone de shell y Git.

Además, la propia documentación de OpenCode advierte que algunos MCP como GitHub pueden añadir muchos tokens y llegar a exceder el contexto.

### Reconsiderarlo si

El flujo de trabajo pasa a depender intensivamente de:

- issues;
- PRs;
- review remota;
- Actions;
- project management GitHub;
- automatización multi-repo.

Si se activa, se limitarán toolsets y permisos.

---

# 5. Playwright MCP

**Estado:** OMITIDO**

Microsoft mantiene un MCP oficial de Playwright.

Sin embargo, la documentación actual de Playwright recomienda para **coding agents** el enfoque CLI/skills porque:

- consume menos tokens;
- evita cargar schemas MCP grandes;
- encaja mejor con codebases amplios;
- Playwright Test ya forma parte de nuestro stack.

Para este proyecto utilizaremos:

```text
Playwright Test
+
shell/CLI
+
QA agent
```

El MCP solo se reconsiderará si necesitamos sesiones de automatización exploratoria largas y persistentes que justifiquen esa superficie adicional.

---

# 6. MCP expresamente innecesarios

No instalar:

```text
filesystem MCP
shell MCP
Git MCP
generic local-file MCP
Supabase MCP
Firebase MCP
```

Motivos:

- filesystem/shell/Git duplican herramientas nativas de OpenCode;
- Supabase/Firebase no pertenecen al stack aprobado.

---

# 7. Seguridad

Un MCP es una nueva frontera de confianza.

Antes de añadir uno:

1. confirmar proveedor;
2. revisar documentación oficial;
3. revisar endpoint/paquete exacto;
4. entender todas las herramientas que expone;
5. estimar coste de contexto;
6. comprobar autenticación;
7. aplicar mínimo privilegio;
8. bloquear operaciones de escritura por defecto cuando sea posible;
9. no guardar tokens en Git;
10. probarlo primero con tareas no destructivas.

---

# 8. Política de permisos

Regla base:

```text
MCP tool
→ denied globally
→ explicitly enabled per agent
```

Para Context7:

```text
context7_*
```

se habilita a los agentes aprobados.

Para futuros MCP con acciones de cuenta, los permisos deben ser más restrictivos y las mutaciones deben pedir confirmación.

---

# 9. Comandos de diagnóstico

OpenCode ofrece:

```powershell
opencode mcp list
opencode mcp auth list
opencode mcp auth <server-name>
opencode mcp logout <server-name>
opencode mcp debug <server-name>
```

Utilizarlos al configurar un servidor remoto.

---

# 10. Revisión del catálogo

Revisar MCP únicamente cuando:

- aparezca una necesidad externa nueva;
- un MCP activo consuma demasiado contexto;
- cambie su proveedor/autenticación;
- cambie el workflow del proyecto.

No realizar una búsqueda periódica de MCP solo para añadir más herramientas.
