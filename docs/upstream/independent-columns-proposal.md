# Proposal: Independent Layout Columns for `@deepseek-ai/dsh-client-ui-layout`

- **Status:** Draft, submitted by the DSH Studio desktop team for upstream review.
- **Target package:** `@deepseek-ai/dsh-client-ui-layout`
- **Behavior baseline:** `0.1.1-rc.2` (the version this proposal was validated
  against; earlier affected releases are noted where relevant).
- **Downstream reference implementation:** DSH Studio currently carries this
  behavior as a tracked bundle patch
  (`patches/dsh-runtime/ui-layout-independent-columns.patch`) applied to the
  compiled `lib/client.js` of the pinned npm package. This document translates
  that patch's behavior contract into an upstream-ready specification so the
  patch can be retired once accepted.
- **Evidence convention:** every behavior specification below cites exact
  assertion line numbers in DSH Studio's behavioral verifier
  (`scripts/verify-staged-layout.mjs`), which executes the *real compiled
  staged bundle* — not a reimplementation — and pins its interaction output.
  Patch hunk references point into
  `patches/dsh-runtime/ui-layout-independent-columns.patch`.

---

## 1. Summary

We propose three related changes to how `dsh-client-ui-layout` sizes the
AppFrame's three-column grid:

1. **Remove the fixed 640px center floor.** The center column becomes fully
   flexible (`minmax(0, 1fr)`), and each side panel resizes independently
   within its own clamp range. Geometry alone never closes or squeezes a side
   panel.
2. **Replace viewport-driven sidebar auto-collapse with explicit,
   user-controlled collapse.** Below a small drag threshold, dragging a panel
   closed collapses it; there is no breakpoint at which the app rearranges
   itself against the user's last stated preference.
3. **Clamp drags locally per side.** Dragging the sidebar affects only the
   sidebar, dragging details affects only details, and each drag is capped by
   the other panel's current resolved width so columns can never overlap.

The combined effect: users can keep a file tree and a diff viewer open side by
side on any viewport, down to a zero-width center column, without the layout
fighting them.

## 2. Motivation

### 2.1 Product problems with the current behavior

The stock `0.1.1-rc.2` AppFrame has two interacting behaviors that hurt
desktop code-review workflows (the primary use case observed downstream):

- **Viewport auto-collapse.** A module-level constant
  (`SIDEBAR_AUTO_COLLAPSE = 1024`, see patch hunk 1,
  `ui-layout-independent-columns.patch:8-11`) collapses the sidebar to its
  compact rail whenever the viewport is below 1024px, regardless of what the
  user last chose. A manual re-expand below the breakpoint is routed through a
  separate `narrowExpanded` override whose state diverges from the persisted
  sidebar preference (store hunks at patch lines 47-52 and 117-125). On a
  half-tiled 1440p window (~960px effective width) users cannot keep their
  file tree expanded persistently.
- **Fixed center floor.** `computeColumns` reserves a 640px minimum for the
  center column and absorbs shortfall by first squeezing details down to 300px
  and then force-closing it entirely (`computeColumns` hunk, patch lines
  21-31). When the user opens a right-hand diff/details panel on a modest
  window, the panel they explicitly opened is the one that gets taken away.

### 2.2 Maintenance problems with the downstream workaround

DSH Studio implements the desired behavior today by patching the *compiled,
minified* `lib/client.js` of the published package:

- The patch is version-gated (`scripts/dsh-runtime-patches.mjs:115-119` rejects
  any package version other than the pinned spec) and must be re-derived by
  hand on every runtime bump.
- Because it edits minified output, review of the patch itself cannot verify
  intent — only its observable behavior can, which is why DSH Studio added a
  dedicated behavioral verifier (Section 5).

Upstreaming the semantics removes the only remaining reason DSH Studio patches
this package at all and lets the behavior be covered by ordinary source-level
tests instead of bundle-execution harnesses.

## 3. Behavior change overview

| Aspect | Stock `0.1.1-rc.2` | Proposed |
| --- | --- | --- |
| Center column | Fixed 640px floor when panels overflow; shortage squeezed out of details first, then details force-closed | Fully flexible `minmax(0, 1fr)`; never forces a side panel to close |
| Sidebar clamp range (rendered) | `[264, 420]` px | `[200, 400]` px |
| Details clamp range (rendered) | `[300, 520]` px | `[220, 640]` px |
| Sidebar auto-collapse | Automatic below viewport 1024px; `narrowExpanded` override | Removed; visibility controlled only by explicit toggle or drag-past-threshold |
| Sidebar drag | Uncapped delta passed to store clamp | Collapses when raw target `< 160` px; capped at `min(400, viewport − detailsWidth)` |
| Details drag | Uncapped delta passed to store clamp | Closes when raw target `< 180` px; capped at `min(640, viewport − sidebarWidth)` |
| Store defaults | `sidebar: 280`, plus `narrow` / `narrowExpanded` state | `sidebar: 300`; `narrow` / `narrowExpanded` state deleted |

Collapsed-panel constants are unchanged: a closed sidebar still renders the
56px compact rail, and closed details still render a 0px track while staying
mounted.

## 4. Behavior specifications

Each specification states the proposed normative behavior and the downstream
assertion that pins it today. Assertion line numbers refer to
`scripts/verify-staged-layout.mjs` at the revision this proposal was drafted
from.

### BS-1 — Independent columns, no center floor

Given a viewport `V`, resolved sidebar width `S`, and resolved details width
`D`:

- `S = 56` if the sidebar is collapsed, otherwise `clamp(sidebarPref, 200, 400)`.
- `D = 0` if details is closed, otherwise `clamp(detailsPref, 220, 640)`.
- The grid template is `` `${S}px minmax(0, 1fr) ${D}px` `` and the center
  track receives whatever remains (`V − S − D`, floored at 0). No branch of
  the computation may force-close details or reserve space for the center.

**Downstream evidence:**

- Wide fit — viewport 1500, sidebar 300, details 360 renders
  `'300px minmax(0px, 1fr) 360px'`
  (`verify-staged-layout.mjs:118-126`, assertion label *"wide grid has no
  center floor"*).
- Tight fit — viewport 1200, sidebar 400, details 640 renders
  `'400px minmax(0px, 1fr) 640px'`: both requested widths survive intact and
  the center track simply shrinks toward zero
  (`verify-staged-layout.mjs:140-148`). Under the stock algorithm this exact
  input cannot happen: `s + d0 + 640 = 1560 > 1200` forces the squeeze branch,
  then `s + d1 + 640 = 1340 > 1200` still overflows, so details resolves to
  `0` (force-closed) and the center keeps 800px.
- Closed details on a narrow viewport — viewport 900, sidebar 300, details
  closed renders `'300px minmax(0px, 1fr) 0px'` with the sidebar kept at full
  width (`verify-staged-layout.mjs:150-158`).

### BS-2 — No viewport-driven auto-collapse

Sidebar visibility is a function of explicit user actions only (toggle, or
dragging below the collapse threshold per BS-3). Viewport width must not
collapse, expand, or re-route the sidebar toggle through a parallel
`narrowExpanded` override. Implementation-wise this deletes the
`SIDEBAR_AUTO_COLLAPSE` constant, the `narrow` / `narrowExpanded` store
fields, and the `setNarrow` action (patch hunks at lines 4-11, 47-52, and
117-125).

**Downstream evidence:** at viewport 900 (below the old 1024 breakpoint) with
the sidebar expanded and no active session, the sidebar slot owner reports
`collapsed === false` and the details track stays `0px`
(`verify-staged-layout.mjs:150-160`, assertion label *"narrow viewport does
not auto-collapse the left rail"*).

### BS-3 — Sidebar drag clamps locally and collapses below threshold

On drag start the handler captures the current resolved width as its base. For
each drag delta `dx`, with `raw = base + dx`:

- If `raw < 160` px: collapse the sidebar (write `0`) and end the drag.
- Otherwise write `min(raw, min(400, viewport − resolvedDetailsWidth))`.

The handler writes only sidebar state; it must not emit details mutations.

**Downstream evidence:**

- Both `DragHandle`s (sides `sidebar` and `details`) are present on the
  rendered frame (`verify-staged-layout.mjs:127-130`).
- Starting from sidebar 300 at viewport 1500, dragging by `+500` writes
  sidebar `400` (the cap `min(400, 1500 − 360)`) and emits **zero** details
  writes (`verify-staged-layout.mjs:131-134`, labels *"left drag clamps only
  the left side"* and *"left drag leaves details width unchanged"*).

### BS-4 — Details drag clamps locally and closes below threshold

For each drag delta `dx` (negative = wider), with `raw = base − dx`:

- If `raw < 180` px: close details (`closeDetails()`) and end the drag.
- Otherwise write `min(raw, min(640, viewport − resolvedSidebarWidth))`.

The handler must not mutate sidebar state.

**Downstream evidence:** starting from details 360 at viewport 1500, dragging
by `−500` writes details `640` (the cap `min(640, 1500 − 300)`) while sidebar
write count stays at its pre-drag value
(`verify-staged-layout.mjs:135-138`, labels *"details drag clamps only the
right side"* and *"details drag leaves sidebar width unchanged"*).

### BS-5 — Store defaults and programmatic writes

Prototype values carried by the reference patch (store hunk, patch lines
98-128):

- Initial state: `{ sidebar: 300, details: 0 }`.
- `setSidebar(px)`: `px < 160 → 0`, otherwise `clamp(px, 200, 480)`.
- `setDetails(px)`: `px < 180 → 0`, otherwise `clamp(px, 220, 640)`.
- `toggleSidebar()`: `0 ↔ 300`.
- `openDetails()`: restores `360` when closed (unchanged from stock).

**Downstream evidence status:** the drag-time consequences of these actions
are pinned via BS-3/BS-4, but the store-level thresholds and bounds themselves
have **no direct assertion** in the current verifier — see open question OQ-1
and test-mapping gap T8.

### BS-6 — Explicitly *not* proposed for upstream

Two artifacts of the downstream bundle patch are integration details, not part
of this proposal:

- `data-dsh-studio-*` attributes added to the frame element (patch lines
  82-84) — DSH Studio-specific DOM hooks consumed by its own tooling.
- The cosmetic normalization `minmax(0, 1fr)` → `minmax(0px, 1fr)` (patch line
  81). The downstream verifier asserts the normalized string (lines 124, 146,
  156) because it verifies the *patched artifact*; an upstream implementation
  may keep either spelling.

## 5. How this behavior is proven downstream today

Because DSH Studio only has the published compiled bundle, its verifier
executes the real staged artifact rather than reimplemented sources:

- `loadAppFrame` (`verify-staged-layout.mjs:32-80`) runs the staged
  `node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js` inside a
  `node:vm` context with a `__ModuleLoader__` shim, stubs only
  `react`, `react/jsx-runtime`, and the store factory import (rejecting any
  unexpected dependency, line 61), invokes the plugin's `apply(ctx)`, and
  captures the registered root component (failing loudly at lines 46 and 78 if
  registration fails).
- `renderFrame` (`verify-staged-layout.mjs:82-99`) calls the real AppFrame
  component with recorded action spies (`setSidebar`, `setDetails`,
  `closeDetails`) so assertions observe actual emitted writes, including their
  order and multiplicity.
- `assertEqual` (`verify-staged-layout.mjs:101-103`) fails the whole run on
  any mismatch; there are no soft warnings.
- The verifier is wired into the staging pipeline
  (`scripts/stage-dsh.mjs:33`, invoked at `scripts/stage-dsh.mjs:1155`), so
  `stage:dsh` fails if the patched bundle ever regresses any pinned behavior.

An upstream implementation makes this harness unnecessary: the same contracts
can be tested directly against `computeColumns`, the store factory, and the
AppFrame component at source level.

## 6. Proposed upstream test mapping

| ID | Proposed upstream test | Contract pinned | Downstream evidence today |
| --- | --- | --- | --- |
| T1 | `computeColumns(1500, 300, 360)` yields sidebar 300, details 360, flexible center | BS-1 | `verify-staged-layout.mjs:118-126` |
| T2 | `computeColumns(1200, 400, 640)` keeps both requested widths; center shrinks, never floors | BS-1 | `verify-staged-layout.mjs:140-148` |
| T3 | `computeColumns(900, 300, 0)` keeps sidebar expanded; details track 0px, still mounted | BS-1, BS-2 | `verify-staged-layout.mjs:150-158` |
| T4 | AppFrame mounts exactly one drag handle per side (`sidebar`, `details`) | BS-3, BS-4 precondition | `verify-staged-layout.mjs:127-130` |
| T5 | Sidebar drag `+500` from 300 @1500px emits exactly one sidebar write `400` and no details writes | BS-3 | `verify-staged-layout.mjs:131-134` |
| T6 | Details drag `−500` from 360 @1500px emits exactly one details write `640` and no sidebar writes | BS-4 | `verify-staged-layout.mjs:135-138` |
| T7 | At viewport 900 with sidebar expanded, sidebar owner reports `collapsed === false` | BS-2 | `verify-staged-layout.mjs:159-160` |
| T8 | Store unit tests: `setSidebar`/`setDetails` thresholds, clamp ranges, `toggleSidebar`, `openDetails` restore | BS-5 | **Gap** — no direct downstream assertion (see OQ-1) |

Notes for implementers:

- T1-T3 can be pure function tests over `computeColumns`; T4-T7 exercise the
  component/handlers; T8 exercises the store factory. None require a DOM.
- Assertions should check emitted *writes* (value, order, count), not CSS
  string spellings, except where the grid template itself is the contract
  (T1-T3).
- Suggested additional cases beyond the downstream pins (not currently asserted
  anywhere): drag below each collapse threshold ends in a collapsed panel;
  a details drag cannot push the sidebar track negative, and vice versa.

## 7. Configuration proposal (draft)

Today every limit discussed here is hard-coded inside the bundle. As part of
landing this change we propose consolidating them into one exported, typed
constants module so embedders can see — and later override — the geometry
contract in one place:

```ts
/**
 * Single source for AppFrame three-column geometry.
 * All values in CSS pixels. Values are the ones validated by the
 * reference implementation; they are negotiable during review.
 */
export const layoutLimits = {
  sidebar: {
    collapsedRailWidth: 56,   // compact rail shown while sidebar === 0
    minWidth: 200,
    maxWidth: 400,
    defaultWidth: 300,        // also the toggle-restore width
    collapseBelowDragPx: 160, // drag target under this collapses instead of resting
  },
  details: {
    closedWidth: 0,
    minWidth: 220,
    maxWidth: 640,
    reopenWidth: 360,
    closeBelowDragPx: 180,
  },
} as const
```

Scope note: exposing these as *user-facing settings* (preference UI, per-surface
overrides) is explicitly out of scope for this proposal; the ask is limited to
a named single source inside the package. The asymmetric threshold pairs
(`collapseBelowDragPx` 160 vs `minWidth` 200, `closeBelowDragPx` 180 vs
`minWidth` 220) are intentional hysteresis: a drag target landing in the band
between threshold and minimum resolves to "closed" rather than leaving a
too-narrow panel resting — reviewers should confirm this semantic (OQ-4).

## 8. Proposed PR outline

Working title: **`ui-layout: independent side columns with explicit collapse gestures`**

Suggested commit series (each independently revertible):

1. **`ui-layout: remove the fixed center floor from column computation`**
   Rewrite `computeColumns` to the BS-1 form: independent clamp ranges,
   `center = max(0, viewport − sidebar − details)`, no details
   squeeze/force-close branches. Includes T1-T3.
2. **`ui-layout: replace viewport auto-collapse with explicit user collapse`**
   Delete `SIDEBAR_AUTO_COLLAPSE`, `narrow`, `narrowExpanded`, and
   `setNarrow`; simplify `sidebarCollapsed` to `sidebar === 0`; retarget
   toggle/default widths per BS-5. Includes T7.
3. **`ui-layout: clamp drags per side and close past collapse thresholds`**
   Implement the BS-3/BS-4 handlers with base capture, threshold collapse,
   and cross-panel caps. Includes T4-T6.
4. **`ui-layout: cover layout store actions with unit tests`**
   T8 store-level coverage once OQ-1 is resolved.

PR body checklist:

- **Motivation:** Section 2 of this document.
- **Behavior changes:** the table in Section 3, verbatim.
- **Compatibility:** persisted sidebar/details widths outside the new clamp
  ranges are clamped at render time (non-destructive; the stored preference is
  untouched). Removing `narrow` / `narrowExpanded` from the store shape needs
  a statement on hydration tolerance for stale persisted keys (OQ-3).
- **Verification:** the test mapping in Section 6 plus manual matrix:
  expand/collapse/toggle at viewports 900 / 1024 / 1200 / 1500+; drag each
  handle to both caps and past both thresholds with the opposite panel open
  and closed.

## 9. Open questions for maintainers

| ID | Question |
| --- | --- |
| OQ-1 | The reference prototype is internally inconsistent about the sidebar's maximum: rendered/drag cap is 400 (`computeColumns` hunk; BS-3) but the store's programmatic `setSidebar` clamps to 480 (BS-5), so a programmatically stored width in `(400, 480]` renders as 400. Which bound is canonical? The proposal text assumes 400 everywhere; T8 should pin whichever is chosen. |
| OQ-2 | Should any optional center-floor escape hatch remain for embedders who preferred the old guarantee? The proposal removes the floor outright (simplest contract); reintroducing it as an opt-in field of `layoutLimits` is cheap if review wants it. |
| OQ-3 | What is the store's documented behavior for unknown/stale persisted keys (`narrow`, `narrowExpanded`) after the shape change — silently dropped, or actively migrated? |
| OQ-4 | Confirm the hysteresis bands (threshold strictly below minimum, Section 7) are the intended semantic for drag-to-collapse. |
| OQ-5 | Should the clamp ranges differ per platform/form factor, or stay universal constants? |

## 10. Downstream transition

If accepted upstream, DSH Studio will retire
`patches/dsh-runtime/ui-layout-independent-columns.patch` and the associated
verifier wiring once its pinned runtime includes the upstream change, keeping
its own integration hooks (BS-6 data attributes) in its plugin layer instead.
Until acceptance, the patch remains the pinned-runtime source of truth for
this behavior and continues to be enforced by
`scripts/dsh-runtime-patches.mjs` (apply + forward/reverse validation) and
`scripts/verify-staged-layout.mjs` (behavioral gate on every `stage:dsh`).
