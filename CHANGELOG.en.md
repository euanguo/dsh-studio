# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows SemVer. 中文版：[CHANGELOG.md](./CHANGELOG.md)

## [Unreleased] — since `v0.1.2` (branch `feat/desktop-verify-skill`)

- Range: `v0.1.2..HEAD` (`3e28cb0..6728fb7`), 2026-08-22 through 2026-08-25
- Scale: 92 commits, 478 files changed, +30,954 / −18,321 lines

The centerpiece of this release is the new **WorkTree orchestration and
cross-project delegation** capability. After landing, it went through a full
live-verification and hardening loop on the DEV channel; this document
describes the shipped end state rather than the intermediate commits.

---

### WorkTree orchestration and cross-project delegation (new, off by default)

A strictly scoped orchestration gateway around WorkTrees, with two tiers of
authorization:

- **Topology and lifecycle tools**: `list` / `branches` / `status` / `create`
  / `remove`, enabled via the `agentWorktreeTools` switch.
- **Cross-project delegation tools**: `delegate` / `status` / `wait` / `stop`
  / `result`, authorized by a separate `agentWorktreeDelegationTools` switch
  (default off) — handing a task to an independent Agent conversation in
  another WorkTree is a heavier capability than inspecting local worktrees.
- **Result flow-back**: child progress and results return to the initiating
  conversation as structured notices; callback summaries respect the upstream
  notice length bound, and settled delegation records are pruned
  automatically.
- **Delegation as normal sessions**: delegated conversations group under
  their owning WorkTree row and open like any session; delegation depth is
  hard-capped so chains cannot spread unbounded.
- **Reliability**: waits reliably observe task settlement; failed workspace
  registration rolls back the created session without orphans; stopping
  races safely against task startup; model-supplied branch/base arguments are
  validated before spawn, rejecting option-shaped injection; status queries
  work on worktrees without an upstream or with detached HEAD. All of these
  scenarios carry regression tests.

---

### Desktop UI/UX rework

A cohesive refresh across the right rail and center surfaces:

- **Selection action bar**: selecting text on file, diff, and commit surfaces
  raises a unified floating bar — add-to-chat (with a recent-first
  conversation picker), ask-in-side-chat, full comment card, inline edit
  instruction, and copy-reference; references land in the composer as inline
  slash chips.
- **Unified hover comments**: the pierre file viewer, its editor surface,
  single-file diff, and diff-all share one gutter "+" hover-comment
  interaction; comments upgrade to a v2 model (anchor path + line range +
  content hash, optional branch stamp, resolve lifecycle) with KaTeX math
  support and automatic migration of existing comments.
- **Scroll and toolbar contract**: ScrollArea converges into a single
  implementation with a floating slim thumb; canvas surfaces run flush on all
  four sides while list surfaces opt in to insets; SurfaceToolbar owns slot
  typography for titles/meta/chips; ToolbarAction becomes a 28x28 ghost
  icon-button base class. The file surface view/edit swap converges on a
  single icon toggle (autosave, Mod+S, and toggle-exit flush remain the only
  write paths); the browser address bar rebuilds as an omnibox where Enter
  navigates.
- **Session awareness**: folded collection rows surface hidden session
  activity as a breathing dot; conversation tabs use a dialogue icon that
  swaps to the official StateDot while active; subagent sessions no longer
  become center tabs; the flat session list renders virtualized, so large
  cross-workspace streams stay fast.
- **Files surface and rail layout**: the Files search box and inline create
  row adapt to the official Input's wrapper structure — the search field
  stretches to full width and the create row reads as a flat tree row;
  creates, renames, copies, and deletes at the workspace root refresh the
  tree immediately; the right rail's maximum width grows from a fixed 640px
  to 75% of the window (220px minimum unchanged); the desktop shell drops the
  sidebar brand row, reclaiming its dead space (Web/TUI keep official
  branding).
- **Unified open pipeline**: every surface open funnels through one decision
  table honoring the centerPreviewTabs preference; layout details such as Git
  review panel insets, tool-menu row widths, and the shared 2px list-row
  rhythm are aligned across both rails.
- **Plugin marketplace**: the client rewrites onto a zustand store with a
  host-pushed change channel; background changes no longer strand in-flight
  operations, and filter selections persist across close/open.

### Settings experience

- New **Agent capabilities settings page**: model-facing capability switches
  and the Source Control AI entry get their own page with clear per-page
  reset semantics.
- The Side panel page regroups into labeled layout / opening-behavior /
  agent-capabilities sections; html sandbox and subagent/jobs auto-open
  switches surface from feature gear popups, and browser HTTP/HTTPS
  interception splits into independently controlled sub-switches.
- The Source Control AI panel folds into the shared settings seam, its bespoke
  RPC pair deleted; four never-consumed legacy preference fields are removed.

---

### UI state persistence migration

Left-rail view state, center-surface open sets, sidebar chrome/layouts, and
plugin open flags move from browser localStorage onto the host storage domain
**`dsh_studio_ui`** (zod-typed tables behind the official storageDomain
fence) with a client featuring memory fallback and retry on failed writes.
Table schemas derive through one recursive path, so nested objects, nullable,
and optional markers apply at every level; domain-open failures log visibly,
with incident shapes locked by regression tests. **Note**: old localStorage
data is discarded once — the first launch after upgrade resets sidebar layout
and open state to defaults.

---

### Desktop runtime

- **User-first cached environment resolution**: user-visible subprocesses keep
  the login-shell PATH on top (bundled Node adapters as fallback) while
  marketplace previews stay bundled-first for consistent builds; resolved
  environments cache under the DSH data root keyed by platform/shell/rc
  fingerprints, excluding session transport variables such as SSH_AUTH_SOCK.
- **Platform adapter split**: POSIX login-shell discovery and Windows GUI
  environment handling live behind one shared facade with Windows
  Path/PATHEXT/ComSpec regression coverage.
- **Interpreter boundary governance**: `ELECTRON_RUN_AS_NODE` no longer leaks
  into agent tool shells — Electron apps launched by agents (including
  `pnpm run dev`) no longer silently degrade to plain-Node mode; governance
  guard tests prevent regressions.

---

### Engineering and architecture (contributors only, no behavior change)

- **CSS Modules styling pipeline**: lightningcss-driven plugin stylesheet
  processing (per-file hashed scoping) with type-safe generated class maps
  and a build-time drift gate keeping generated tables in sync; shared ui.css
  splits into order-preserving slices; marketplace/skins/pinned-summary CSS
  externalizes.
- **Module reorganization**: `@dsh-studio/shared` groups by git / contracts /
  runtime / terminal; capabilities groups by terminal / worktree / routes
  with the route table split into handler modules; a dozen thousand-line
  components split systematically (WorkspaceBrowser, SideToolsPanel, settings
  section, marketplace client, ...); `src/` single-sources the command
  whitelist, channel names, and launcher arg parsing.
- **Dependency convergence**: clsx / papaparse / pathe / lightningcss replace
  four hand-written implementations; keep-hand-written decisions for parser
  and state code are recorded with evidence.
- **Guards and cleanup**: build-time validation of the shared exports map;
  removal of bottom terminal dock leftovers, compatibility shims, and
  zero-consumer exports.

---

### Documentation and governance

- Data/state discipline lands: six spec entries (S1–S6), three CI guard
  scripts, AGENTS/plugins-AGENTS data-discipline sections, and a bilingual
  data-flow chapter in the design docs.
- `docs/` becomes fully tracked; five new documents cover persistence
  architecture, interaction model, comment architecture, workbench
  architecture, and the ui-chrome storage plan, maintained bilingually.

### Development and verification tooling

- New repo-owned skill **dsh-desktop-verify**: launches the DEV desktop via
  the dev launcher and verifies features end-to-end over CDP through
  chrome-use, shipping a smoke suite and a mandated pitfall ledger
  (self-improvement loop). Affects the DEV channel only
  (`~/.dsh-studio-dev`); the installed production app is never touched.

---

### Upgrade notes

1. Old localStorage UI chrome state is discarded once: the first launch after
   upgrade resets sidebar layout/open state to defaults.
2. The bottom terminal dock remains removed (leftover modules fully cleaned);
   consult git history if it ever needs reviving.
3. WorkTree orchestration and delegation default to off: enable
   `agentWorktreeTools` and separately `agentWorktreeDelegationTools` in
   settings.
4. File-surface view/edit toggling and browser address-bar interaction
   changed: the Save/View capsules and the browser Go button are gone — write
   paths converge to autosave / Mod+S / toggle-exit flush, navigation happens
   on Enter.
