# ADR-050 - Dice engine and standalone roller

**Status:** Accepted
**Date:** 13/08/2026

## Context

RPG Forge needs a standalone dice roller now and server-authoritative dice rolls
inside the future Table without coupling the dice rules to either runtime or UI.

## Decision

- Create `@repo/dice-engine` as a pure TypeScript, framework-independent package.
- Limit a roll to 20 dice and validate all inputs in the package.
- Use Web Crypto through `CryptoRandomSource`, with rejection sampling to remove
  modulo bias.
- Accept an injectable `RandomSource` so tests remain deterministic.
- Use `@3d-dice/dice-box-threejs@0.0.12` for 3D physical presentation only;
  the engine resolves the result first and DiceBox receives forced faces.
- Make the engine usable in browsers, Node tests, and future Workers/Durable Objects.
- Keep the standalone `/dice` route public and transient. The future Table will
  perform authoritative rolls on its server and broadcast its engine result.

## Consequences

- `apps/web` consumes the package but does not duplicate dice rules.
- The engine has no React, Next.js, DOM, Cloudflare binding, D1, auth, or UI
  dependencies.
- No standalone roll history or persistence is created.

## Known technical debt

`@3d-dice/dice-box-threejs@0.0.12` exposes no public `dispose()` lifecycle or
removal API for its own `window` resize listener. That listener remains after
an initialized component unmounts; the resulting renderer-resource impact has
not been measured.

The current mitigation is one DiceBox instance per mounted table and no
recreation for theme or sound changes. The feature keeps a narrow temporary
bridge for the version-specific internals required to refresh colorset,
texture, material and sound without creating another instance:
`DiceColors.colorsets`, `theme_customColorset`, `loadTheme()`, `loadSounds()`
and `sounds`.

Theme work and physical rolls are serialized for that instance. Before each
physical roll, the UI waits one frame for the dock layout to settle and syncs
dimensions; `ResizeObserver` updates are deferred until the physics work has
finished.

Initialization and physical rolls are bounded. An initialization timeout marks
the renderer unavailable and returns the engine result through the accessible
fallback. A roll timeout uses `clearDice()` as implemented by the exact pinned
0.0.12 package to stop the active animation before releasing the reroll action;
it does not create a replacement instance. The upstream README does not
document `clearDice()`, so this recovery path must be revalidated before an
upgrade.

The component avoids constructing DiceBox if its dynamic import resolves after
unmount. Once initialization has started, it can clear visual dice but cannot
remove the library resize listener because DiceBox 0.0.12 exposes no public
cleanup API.

The completed DiceBox response is checked against the forced faces. If it
cannot be verified, the presentation is marked `unverified` while the engine
result remains authoritative. Expected and returned face values are exposed
only as development diagnostics; production shows a generic accessible notice.

Reevaluate an upgrade or replacement when a maintained renderer provides
deterministic forced outcomes, documented runtime theme updates and public
disposal. Do not fork or monkey-patch DiceBox in the MVP.

## Related ADRs

- ADR-014 - Stack de testing
- ADR-020 - pnpm workspace sin Turborepo
- ADR-022 - Paquetes internos solo con reutilización real
