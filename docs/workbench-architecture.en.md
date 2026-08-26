# Workbench architecture evolution: from "plugin patches" to a Workbench kernel

> Status: **implemented** · Proposal 2026-08-23 · Committed 2026-08-24 ·
> Landed (kernel-refactor, W1–W8)
> Deviation records: the implementation follows four runtime services in
> `plugins/workbench` + `@dsh-studio/shared/workbench-contracts` —
> SurfaceRegistry / OpenPipeline / LayoutService / WorkspaceEvents. The proposal's
> `StateStore`/`ScopeService` were not shipped as runtime services; slice schema/version
> vocabulary remains in shared contracts and actual persistence goes through `persistVia`
> onto host-owned backends. The identity event source is the runtime's
> `currentProvideInfo` projection (this paper originally assumed per-consumer
> subscription-point rewrites). GitWatch/websocket freshness events intentionally stay
> in the source-control domain and are NOT folded into WorkspaceEvents; localStorage
> remains a legacy read-only migration source.
> Prerequisite: `docs/interaction-model.md` (interaction decisions D1–D7).
> This document answers: **how to restructure so these optimizations become
> kernel capabilities instead of per-item patches.**
>
> External references: VS Code Workbench services (layoutService /
> editorService / editorGroupsService / openerService / StorageScope), Zed
> `crates/workspace` (workspace/dock/pane), JetBrains
> PersistentStateComponent + Workspace Model, Eclipse workbench
> parts/perspectives. Internal evidence: checklist at the end (file:line all
> verified).

---

## 1. Current-state map: how capabilities grew

Every capability of the three-panel workbench was a combination of "plugin +
fixed overlay + its own storage":

```
desktop-left-rail ── slots injects official sidebar.workspaces (fork replace)
sidebar(SideToolsPanel) ── fixed body overlay #dsh-studio-sidebar-root
sidebar(center-surface-host) ── fixed body overlay #dsh-studio-center-tabs-root
pinned-summary ── fixed <aside> + <style> under body; claimRightPanel squeezes #root
panel-controls ── right-panel footprint coordinator (writes #root padding-right + data attrs)
plugin-marketplace ── own div + createRoot overlay
```

The open path relied on hijacking: `intercept.ts` replaces the official
`workspaces.openPath` via `acquireOpenPathPatch` and registers link-protocol
interception; session file links and right-rail clicks each did their own
thing.

State storage (8 localStorage stores, ≥4 scoping dimensions):

| Store key | Scope dimension | Owner |
| --- | --- | --- |
| `dsh-studio.sidebar-preferences.v2` | cwd (workspace bucketing) | sidebar-storage |
| `dsh-studio.center-surfaces.v2` | cwd (byCwd) | center-surface-persistence |
| `dsh-studio.sidebar.review-comments.v1` | **mixed**: sessionId\0cwd\0branch + seeded workspacePath\0branch | review-comments |
| `dsh-sidebar:v1:<sessionId>` | **sessionId** | capabilities/src/client/state.ts:611 |
| diff-comments-store KEY | an independent third comment store | diff-comments-store.ts |
| `dsh-studio.keymap.v1` | global | kit/keymap.ts |
| `dsh-studio.terminal-panel` | global (dock CUT) | panel-controls/panel-store |
| panel-controls OPEN_KEY | global | panel-controls/client.ts |

DOM probes scattered: `[data-slot=...]` queries in 11 places
(skins/marketplace/center-surface-host/dsh-dom.ts);
`centerColumnElement/leftRailToggleButton/readLeftRailOpen` read the official
DOM directly. Only sidebar had a service version (`SIDEBAR_SERVICE_VERSION
'0.1.2'` + `SIDEBAR_FEATURES`).

## 2. Structural diagnosis (why it was patch-shaped)

- **P1 No scope primitive**: cwd / sessionId / branch / global were
  interpreted independently by each store; "which state follows what" had no
  unified answer → comment splitting (interaction-model D5b) and nowhere to
  put the layoutScope switch (D5a) both stem from this.
- **P2 No open pipeline**: there was no unified openRequest flow. Anyone could
  createRoot a tab, anyone could hijack openPath; the focus invariant (D2/D3)
  and preview semantics (D4) had no central enforcement point.
- **P3 Layout by side effects**: panel geometry worked by "writing another
  surface's DOM padding" (`claimRightPanel` writing `#root` padding-right);
  region ownership, z-layers, and widths knew nothing of each other.
- **P4 Persistence everyone-managed**: schema version formats varied
  (v1/v2/v4 mixed), migration logic duplicated, and every new preference
  meant a new key.
- **P5 Event sources fragmented**: worktree/session-change awareness was
  scattered across sessions snapshot subscriptions; no WorkspaceEvents.

## 3. Target architecture: the Workbench kernel

Add a **pure cordis service plugin** `@dsh-studio/workbench`
(host+client): no new loader, no violation of "no cross-plugin value
imports" — everything flows through `ctx.get()/ctx.reflect.provide()`.
Four runtime kernel services (the proposal-era StateStore/ScopeService divergence is
noted below):

1. **SurfaceRegistry** — registry of surface kinds
   (conversation/file/diff/browser/terminal/review/subagent…): descriptors
   carry `{ scopeNeed: 'workspace'|'session'|null, previewable, pinnable,
   focusPolicy, renderer }`. Both right-rail tabs and center tabs render
   registry entries, eliminating descriptor duplication.
2. **OpenPipeline** — the single open entry:
   `open({kind, target, intent: 'preview'|'pin'|'background', area?: 'auto'})`
   → area adjudication (right-rail quick
   preview vs center tab) → FocusPolicy enforcement (never steals focus unless
   the user explicitly acts) → render. D2/D3/D4 become "pipeline parameters"
   instead of behaviors scattered around: agent file chips, session links,
   right-rail clicks, marketplace opens all go through it; the `previewTabs`
   preference takes effect inside the pipeline. intercept's monkey-patch
   becomes a registered pipeline handler (official openPath hijacking
   collapses to one place and can be removed wholesale).
3. **LayoutService** — region ownership and geometry: declares the region tree
   (left-rail / right-panel / center-tabs / bottom-reserved); claim/release of
   panel footprints becomes layout-tree negotiation (replacing the write-
   `#root`-padding side effect); carries `layoutScope: 'workspace'|'global'`
   (D5a) and per-worktree width memory (D7); the bottom region keeps its
   declaration but defaults off (explicit CUT semantics).
Implementation note (not a runtime service): shared persistence vocabulary:
   `StateSliceDefinition` retains schema/version and migration vocabulary, while
   actual persistence goes through `persistVia` onto host-owned backends. Each
   domain keeps its workspace/session/global bucketing contract; the proposal's
   ScopeService + StateStore were not shipped because the landed kernel had no
   real consumer for that runtime service.

   The shipped kernel cut the `workbench.state` service
   (zero consumers); slice vocabulary survives as `StateSliceDefinition`
   consumed by the shared `persistVia` layer, and per-slice ownership rules
   remain documented in docs/persistence-architecture.md.
4. **WorkspaceEvents** — the switching event source: two events,
   worktree(cwd)-changed and session-changed; every component that must follow
   switches subscribes here instead of watching sessions snapshots.

External precedent support: VS Code splits the same problem into layoutService
(parts geometry) + editorGroups/editor service (tab model and opening) +
openerService (navigation entries) + StorageScope (scoped storage; recently
added APPLICATION_SHARED, PR #311317); Zed holds dock/pane in one `workspace`
crate; JetBrains declares persistence tiers per component (project vs
application). Eclipse perspectives are the cautionary tale: layout semantics
that over-centralize go rigid and get abandoned — hence our LayoutService owns
only "regions and footprints", never content orchestration.

## 4. Historical proposal migration route (strangler; four independently shippable/reversible phases; the shipped implementation follows the deviation record above)

| Phase | Content | Optimization | Rollback |
| --- | --- | --- | --- |
| P0 contract week | define four runtime-service interfaces plus shared persistence vocabulary; freeze new stores/keys; add focus-invariant smoke | — | purely additive |
| P1 Persistence | `StateSliceDefinition`/`persistVia` vocabulary and host-owned storage; review-comments v1→v2 re-homing migration; center/sidebar-preferences onto the adapter; prune duplicate comment blocks and CUT dead code | D5b | migration rollback / previous-value snapshot |
| P2 OpenPipeline | intercept hijack → pipeline handler; right-rail quick-preview short path; previewTabs preference; agent file chips; delete openPath patch | D2/D3/D4 | flag `workbench.open` |
| P3 Layout | claims → layout-tree negotiation; geometry into PreferenceService; layoutScope switch; bottom region explicitly reserved | D5a/D7 | flag `workbench.layout` |
| P4 closeout | SurfaceRegistry absorbs dual descriptors; legacy paths deleted; design.md/design.en.md bilingual update; SIDEBAR_SERVICE_VERSION → WORKBENCH_CONTRACT_VERSION | D1 solidified | remove flags |

Each phase's acceptance reuses interaction-model.md §3 highlights (focus
invariant smoke, worktree round-trip recovery, cross-session comment
visibility, idempotent migrations) and obeys repo test discipline: test
behavior and contract structure — no source-string greps.

## 5. Risks and mitigations

- **upstream bump conflicts**: DOM probes collapse into the single
  `dsh-dom.ts` module + selector tripwire tests (mirroring desktop-skins'
  generated-selectors re-pin mechanism); a bump re-pins exactly one place.
- **web parity**: kernel capabilities that are Electron-only are annotated
  with capability gates (aligned with the dshStudioSurface contract); the Web
  surface uses the same pipeline with a restricted area set; TUI consumes no
  browser graph.
- **performance regressions**: retained runtime cache (LRU 16/32) semantics
  remain in the shared/runtime registry; zero-refresh-on-switch behavior is
  locked behind smoke tests.
- **migration destroying user data**: every v(n)→v(n+1) migration is
  idempotent, non-destructive, restart-safe (AGENTS.md hard constraint), and
  snapshots the previous value one generation deep to `<key>.bak`.
- **scope creep**: explicitly out of scope — infinite canvas, perspective-like
  multi-layout presets, command palette (separate proposal).

## 6. Internal evidence index (key spots)

- Scope fragmentation: plugins/sidebar/src/client/runtimes/registry.ts:40-46
  (cwd), surfaces/center-surface-store.ts:57-59 (byCwd),
  review/review-comments.ts:245-247 + :455 (mixed vs seeded),
  capabilities/src/client/state.ts:611 (sessionId)
- Open hijack: plugins/sidebar/src/client/intercept.ts
  (acquireOpenPathPatch / registerLinkHandler / registerLinkInterception /
  registerOpenPathHandler)
- Geometry side effects: plugins/panel-controls/src/client.ts:151-209
  (claimRightPanel writes #root padding), pinned-summary/src/client.ts:347
- Mount points: workspace-tools.tsx:281-302,
  center-surface-host.tsx:565-567, plugin-marketplace/client/plugin.tsx:258-261
- Store inventory: see §1 table (all keys grep-verified)

## 7. External references

- VS Code: deepwiki.com/microsoft/vscode "3.1 Layout and Parts", "3.2 Editor
  Groups and Editor Service"; src/vs/platform/storage/common/storage.ts
  (StorageScope); microsoft/vscode#311317 (APPLICATION_SHARED);
  src/vs/platform/opener/common/opener.ts
- Zed: crates/workspace/{workspace.rs,dock.rs,pane.rs}; deepwiki zed
  "3.5 Panels and Sidebar"
- JetBrains: Persisting State of Components (plugins.jetbrains.com/docs),
  Workspace Model
- Eclipse: Inside the Workbench (eclipse.org articles); the Perspectives
  deprecation lesson
