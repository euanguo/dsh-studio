# ADR — Remove the second palette tone bridge (C7)

- Status: accepted
- Scope: `plugins/shared/theme.css`
- Leaf: 4.3 (UI compliance convergence)

## Decision

Delete `--dsh-studio-tone-protected-bg` / `--dsh-studio-tone-protected-fg`
(light `#f1eaff` / `#6741a5`, dark `#2c2340` / `#c4a6f5`) from `theme.css`.

## Context

`theme.css` defined a purple "protected badge" palette because DSW had no
purple semantic alias. The shared-token rule forbids a second palette in
`theme.css` (see `AGENTS.md` "Feature CSS must not introduce a second
palette"; `theme.css` may only bridge spacing/radius/size, not colors).

## Why delete rather than re-derive with `color-mix`

1. The token was **dead code** — a repository-wide grep found no consumer in
   any `.tsx` / `.css` (`plugins/`, `docs/`). The comment claimed a
   "marketplace protected badge" but no marketplace component references it.
2. There is no purple brand token to derive from. DSW's brand family is blue
   (`--dsw-static-deepseek-*` = `rgb(103,158,254)` / `rgb(65,118,230)`),
   so `color-mix(in srgb, var(--dsw-alias-brand-*))` would produce a *blue*
   tint, not the purple the comment described — the bridge would be misleading.
3. `color-mix(...)` of a nonexistent alias still needs a fallback, which just
   reintroduces a hardcoded color.

If a real purple "protected" badge appears later, push an upstream DSW alias
instead of re-adding a local palette. The `state-business-primary` alias
(light `deepseek-500` / dark `deepseek-400`) already exists upstream and is
the sanctioned source when such a status/badge needs a brand-ish color.

## Consequences

- `theme.css` no longer defines any second palette; fewer color slots.
- The token is gone, so any future consumer must reference a DSW alias
  directly.