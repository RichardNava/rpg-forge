# External skills manifest

**Status:** Approved set for local project installation during repository bootstrap  
**Reviewed:** 12 August 2026

External skills are not copied into this Phase 7 package. They should be installed from their upstream repositories when the real project repository is initialized, after reviewing the current source.

The Skills CLI supports OpenCode and local project installation. Use `-a opencode` to target OpenCode and omit `-g` so the skills remain project-local.

## Active external skills

### 1. `cloudflare`

Publisher: Cloudflare  
Repository: `cloudflare/skills`

Purpose:

- current Cloudflare platform routing;
- Workers;
- D1;
- R2;
- Workers AI;
- Durable Objects references when broad Cloudflare implementation questions arise.

Install:

```powershell
npx skills add cloudflare/skills --skill cloudflare -a opencode
```

Allowed agents:

```text
Build
Plan
backend-db
qa
security
```

Not needed by `frontend` for ordinary UI work.

### 2. `vercel-react-best-practices`

Publisher: Vercel Labs  
Repository: `vercel-labs/agent-skills`

Purpose:

- React/Next.js performance;
- rendering/data-fetching patterns;
- bundle and component-performance guidance.

Install:

```powershell
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices -a opencode
```

Allowed agents:

```text
Build
Plan
frontend
qa
```

### 3. `web-design-guidelines`

Publisher: Vercel Labs  
Repository: `vercel-labs/agent-skills`

Purpose:

- accessibility;
- interaction;
- typography/layout;
- UX review.

Install:

```powershell
npx skills add vercel-labs/agent-skills --skill web-design-guidelines -a opencode
```

Allowed agents:

```text
Build
Plan
frontend
qa
```

## Deferred external skills

Do not install these yet.

### `durable-objects`

Publisher: Cloudflare  
Repository: `cloudflare/skills`

Activate when implementation of The Table begins.

Reason: specialist knowledge for Durable Objects, SQLite, WebSockets, alarms and testing is valuable then, but unnecessary during early standalone-generator work.

Future command:

```powershell
npx skills add cloudflare/skills --skill durable-objects -a opencode
```

### `turnstile-spin`

Publisher: Cloudflare  
Repository: `cloudflare/skills`

Activate when Turnstile is actually integrated into public AI generation endpoints.

Future command:

```powershell
npx skills add cloudflare/skills --skill turnstile-spin -a opencode
```

### `vercel-composition-patterns`

Publisher: Vercel Labs  
Repository: `vercel-labs/agent-skills`

Only add if reusable React component APIs become complex enough to justify a dedicated composition procedure.

## Explicitly omitted

### Generic security-review skill

Not installed initially.

Reason: this repository already has a project-specific read-only `security` agent with explicit coverage for Better Auth, Workers AI, D1, R2, uploads and Table realtime.

### Generic testing skill

Not installed initially.

Reason: the `qa` agent already owns the project's exact Vitest/RTL/Cloudflare/Playwright testing strategy.

### Generic frontend-design skill

Not installed initially.

Reason: `rpg-frontend-style` is intentionally project-specific, while Vercel's React and web-design skills provide the technical/accessibility complement.

## Supply-chain rule

Before adding or updating any external skill:

1. inspect its current `SKILL.md`;
2. inspect bundled scripts/resources if any;
3. confirm publisher/repository;
4. check whether it requests or assumes shell/network operations;
5. confirm it does not contradict `AGENTS.md`;
6. review security-audit signals where available;
7. install locally, not globally;
8. commit the resulting project-local skill files so the team uses a reviewed version.

Do not run `npx skills update` blindly on the whole project before reviewing upstream changes.
