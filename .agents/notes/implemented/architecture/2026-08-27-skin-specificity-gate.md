# Agent Note: Skin geometry wins by stacked-specificity gate, not !important

Status: implemented

## Problem

The ChatGPT skin stylesheet re-shapes upstream DSH components whose own CSS
loads alongside it. Historically every skin geometry rule carried
`!important` — first as a blanket habit, later justified by demotion
measurements that appeared to show upstream winning without it. The count
climbed to 82 forced declarations, the user asked for governance, and two
facts made blind deletion unsafe: shared in-repo CSS genuinely owns some
state washes with its own force, and some skin selectors are version-pinned
upstream repairs that no longer match anything.

Cascade-equivalence measurement also had a trap: demoting a `var()`-pending
shorthand (`padding: var(--x) !important`) in the CSSOM deletes the whole
declaration instead of lowering its priority, so early demotion runs
reported false "upstream wins" verdicts for every token-driven rule.

## Decision

`skins.ts` gates every component-geometry selector through `SKIN_GATE`,
which stacks the `data-dsh-studio-skin` attribute **four times**:

```css
body[data-dsh-studio-skin][data-dsh-studio-skin][data-dsh-studio-skin][data-dsh-studio-skin] .upstreamHash { … }
```

Repeating an attribute selector accumulates specificity per the CSS spec,
so class rules carry (0,5,1) and the `:has()`-based settings-trigger
exception (0,7,1). The measured strongest contested upstream rule is the
official menu row `body > div[role=menu] [role=menuitem]:not(..):not(..)`
at (0,4,2) — three stacks (0,4,1) lose on the element-count tiebreak,
four win with headroom. Per-selector gating stays (ungated exact hashes
degrade to (0,1,0) and lose to the skin's own generic button/menu rules).

Twenty-nine forced declarations were demoted to normal cascade on this
evidence: menu item geometry, menuitem role sizing, item wrap/label resets,
nav cells, the settings-trigger exception, dialog shell border/shadow,
Button-md spec, and filter pills. Forced declarations remain only where no
live verification exists (rename inputs, selector controls, trigger pill
hashes pinned for upstream repairs, primary pill, focus-within repairs,
toast, onboarding mask) — force is the last resort, never the default.

## Alternatives considered

- **Body ID selector (`#dsh-studio-skin-host …`)** — (1,0,0) beats any
  class chain, but it adds a global-namespace ID to the host `<body>`, a
  second host-DOM contract beside the existing attribute, for strength the
  measured conflicts do not need. Lost to the attribute stack.
- **Keep `!important` everywhere** — maximum robustness, but it is exactly
  what the governance request removes; it also defeats legitimate in-repo
  overrides that use force for states. Lost: measured conflicts are all
  non-important cascade contests.
- **Reorder/last-append the skin `<style>`** — fragile against dynamic
  host injection order and gives no specificity headroom. Lost.
- **Patch upstream to consume skin tokens** — the clean long-term fix, but
  `upstream/` is pinned and token ownership at source is an upstream-scope
  change. Deferred; the gate is the in-repo adaptation point.

## Consequences

The skin now wins geometry by specificity, so the stylesheet reads as
normal cascade and plugin feature CSS can override it without force.
Drift safety shifts from importance to the gate constant: an upstream bump
that raises specificity past (0,5,1) or adds `!important` will silently
lose — the tripwire test pins the four-stack contract plus force-free
navCell/settings.trigger blocks so the failure is loud, and
`pnpm run generate:selectors` remains the re-pin point. The 29 retained
forces are individually listed in
`.agent-workflows/marketplace-geometry-audit/audit.md`; each needs its own
live-state measurement before it can be demoted. Cascade-equivalence
auditing must resolve `var()`-pending shorthands via their shorthand slot
(the fixed auditor lives at
`.agent-workflows/marketplace-geometry-audit/scripts/audit-cascade-winner.js`).
