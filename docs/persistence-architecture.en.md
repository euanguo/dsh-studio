# DSH Studio persistence architecture

> Source comments in several places reference this file
> (`docs/persistence-architecture.md`, `decision B`, storage tiers). It was
> missing for a long time and is now written down. It answers two questions:
>
> 1. Which persistence capabilities does the runtime officially expose, where
>    do they land, and what are their semantics;
> 2. **Which data belongs in which tier** — especially which data is
>    **forbidden** from entering `settings.yaml`.
>
> The goal is to give later implementations (such as decision C's universal
> UI storage) a solid basis so state no longer drifts into the settings file.

## 1. Data root and overview

- Shared state root: `~/.dsh-studio` (stable channel) /
  `~/.dsh-studio-dev` (dev channel).
- `DSH_STUDIO_HOME` is an absolute override; `DSH_STUDIO_CHANNEL` selects the
  channel; single-source definitions live in `src/data-root.ts` and
  `@dsh-studio/shared/data-root-names` (AGENTS.md forbids inventing new data
  roots).
- Electron userData is pinned by `desktopElectronDataRoot()` to
  `{dataRoot}/desktop`, so Chromium caches/storage never leak into system
  defaults (`src/data-root.ts`).

All panel plugins (left rail `desktop-left-rail`, right rail `sidebar`,
center `center-surface`, `pinned-summary`, `plugin-marketplace`,
`desktop-skins`) keep their persisted data under this one data root, spread
across four persistence tiers described below.

## 2. Officially exposed persistence capabilities (by tier)

### 2.1 Tier 1: settings namespaces → `settings.yaml`

| Item | Value |
|---|---|
| Components | `@deepseek-ai/dsh-settings` + `@deepseek-ai/dsh-settings-file` |
| On disk | `<dataRoot>/settings.yaml`; every commit rewrites the whole section atomically (temp + fsync + rename, file lock, hot reload of external edits via watcher) |
| Capabilities | any namespace matching `^[a-z][a-z0-9-]*$`; `register(ns, schema)` yields defaults/validation/settings-page rendering; `get / update / replace / mutate` + `expectedRevision` optimistic lock (409); **only `replace` can express deletion** |
| Host wiring | `plugins/capabilities/src/index.ts` registers schemas; `/capabilities/api settings.*` routes (`routes/settings.ts`) ride the same trust fence; the runtime RPC domain (api-proxy) serves only allowlisted namespaces while plugin namespaces go through their own fenced routes |
| Readers/writers | browser plugins via `/capabilities/api`; hosted processes use `sctx.settings` directly |

**Fits**: user-visible preferences/toggles/configuration (theme, language,
permission presets, model choice, grouping maps, aliases, icons, directory
preferences, terminal fonts …).
**Does not fit**: fast-changing UI transients (expand/collapse, drag order,
panel widths) — see §3.

Namespaces already used in this repo: `dsh-studio-left-rail` (left-rail view
slice), `dsh-better-sidebar` (right-rail feature preferences),
`source-control-ai`; official ones include `ui-theme`, `locale`, `permission`,
`agent-default-model`, `ui-conversation`, `agent-presets`, `llm-pi-ai`, etc.

### 2.2 Tier 2: storageDomain domain storage → `storages/<domain>.json` (official generic KV)

| Item | Value |
|---|---|
| Components | `@deepseek-ai/dsh-storage` (hub `ctx.storage`) + `@deepseek-ai/dsh-storage-domain` (facility `ctx.storageDomain`) + `@deepseek-ai/dsh-storage-json` (backend `json`) |
| On disk | `<dataRoot>/storages/<domain>.json`, format `{ unit:{name,version}, global, tables }`; every write rewrites the whole file atomically (temp + fsync + rename + POSIX directory fsync); reads verify version (`version-mismatch` rejection) and shape (`malformed-medium`) |
| Capabilities | `defineDomain({ name, version, tables, global? })`; table values are **zod-validated**; domain-versioned migrations; synchronous reads (in-memory authority), serialized async writes (single per-domain write chain); **persistence-first** (write to disk → then mutate memory → emit `domain/changed`; on failure memory stays untouched); `open/close` lifecycle, single writer |
| Table ops | `domain.table(n).get/put/delete/update/entries/keys/size`; `domain.global.get/set` |
| Naming | domain/table names match `^[a-z][a-z0-9_]*$`; global schema must not accept `null` (null is the "never written" sentinel) |
| Official use | `workspace` (→ `workspace.json`), `session_projcache` (→ `session_projcache.json`) — plugins treat these as read-only or go through official APIs |

**Fits**: any durable structured data needing strong validation and versioned
migration — especially **plugin UI chrome state**.
This is the repo's target tier for "universal UI storage" (decision C), see §4.

### 2.3 Tier 3: data-root owned files + fenced routes (host plugin file storage)

- Pattern: a host plugin reads `dshStudioSurface.dataRoot` (==
  `DSH_STUDIO_DESKTOP_APP_DATA` == the data root, `src/plugin.ts` +
  `plugins/shared/surface.ts`), writes JSON into its own subdirectory/files,
  and registers same-named HTTP routes (GET/PUT) through `webServer` for
  browser read/write.
- Precedents:
  - `desktop-skins.json` — `plugins/desktop-skins/src/preferences-server.ts`
    (temp+rename atomic write, 0600, same-origin check);
  - `plugin-marketplace/catalog-cache.json`, `rollbacks/`, `previews/`,
    `gitconfig` — `plugins/plugin-marketplace/src/host/platform.ts`;
  - `terminal-sessions/sessions.json` —
    `plugins/capabilities/src/terminal/terminal-session-store.ts`;
  - `environment-cache.json` — `src/main.ts` / `src/user-environment-cache.ts`.
- **Fits**: whole-file data in host-owned formats, large blobs, media unrelated
  to official domains.
- **Note**: this is a *pattern*, not a shared library — each user hand-rolls
  atomic writes + routes. Once it repeats more than twice, extract a
  `@dsh-studio/shared` helper (e.g. `host-json-store`).

### 2.4 Tier 4: localStorage (browser plugin UI session state)

- Location: `{dataRoot}/desktop/Local Storage/leveldb` (Electron userData).
- All chrome keys within this plan's scope are retired; the explicitly
  retained follow-up scope is `dsh-studio.sidebar.diff-comments.v2` and
  `dsh-studio.keymap.v1`.
- **Fits**: browser-plugin UI transients with no host process; positioned as
  "per-browser-session state" — not cross-browser, not cross-surface.
- **Boundary**: keep only features not yet adopted into an official domain or
  settings home; any NEW persistent UI chrome must first enter
  `dsh_studio_ui` domain design.

### 2.5 Holes you must not use

| Hole | Why not |
|---|---|
| `dsh-spill` / `dsh-spill-local` | agent tool output staging, session-scoped, wrong semantics |
| `dsh-attachment` / `-local` | user attachments + image pipeline |
| `dsh-fs` / `dsh-fs-local` | AGENTS.md limits access to the active **Session/Workspace**; writing the data root is not allowed |
| `dsh-credentials-local` | secrets-only; reading pollutes redaction semantics |
| Chromium cache areas (`Cache`/`GPUCache`/`Session Storage`/`blob_storage`) | cache is not data and may be cleared at any time |

### 2.6 Official domain data (read-only)

`storages/workspace.json`, `storages/session_projcache.json`,
`sessions/*.jsonl`, `terminal-sessions/`, `.credentials.yaml` belong to
runtime capabilities; plugins **must not write them directly**, only via
official APIs (`workspaceRegistry`, session persistence, `dsh-credentials`,
…).

## 3. Ownership decision table (anti-miswriting, core)

Principle: **intentional user configuration → tier 1; persistent UI state →
tier 2 (transitionally tier 4); host-owned whole files → tier 3; transient →
memory.** Never write one tier's data into another tier's medium.

| Data category | Tier | Rationale / counter-example |
|---|---|---|
| Feature toggles, preferences, models, permissions, language, theme | 1 | user-visible; needs cross-browser/surface sync |
| Left-rail grouping maps, aliases, icon overrides, directory preferences | 1 | **intentional** configuration slices (`dsh-studio-left-rail`); deletions expressed via whole-section replace |
| **Expand/collapse state, drag order, panel widths, open set, commit drafts** | **2** | UI chrome, not user configuration; **forbidden in tier 1** — write uniformly to the `dsh_studio_ui` domain |
| Marketplace catalog cache, skins, terminal history, environment cache | 3 | host-owned whole-file formats |
| Session in-memory state, live PTY | memory | transient; histories go to `sessions/` / `terminal-sessions/` |
| Secrets | credentials | not settings (redaction scenario) |

> **Red line (read before writing code)**: the `dsh-studio-left-rail`
> namespace keeps only "intentional configuration slices" and never accepts
> chrome fields like expand/collapse or ordering. Chrome belongs to tier 2's
> domain, not layer-1's settings document.

## 4. Decision records

### decision B (landed; explained here)

The left-rail view slice moved out of the merged `dsh-better-sidebar` section
into its own namespace `dsh-studio-left-rail`
(`plugins/shared/left-rail-preferences.ts` +
`plugins/capabilities/src/left-rail-settings-migration.ts`; migration is
idempotent, restart-safe, checked once per launch). Reason: the merged
section had no schema/version of its own and merge cannot express deletion;
the target namespace uses versioned DTOs + whole-section `replace` so
**deletes persist**. Doc references: left-rail client `left-rail-settings.ts`,
host `index.ts`.

### decision C (implemented)

**Goal**: persistent UI chrome state of browser plugins (left rail / right
rail / center) moves into the official domain storage instead of scattered
localStorage and settings documents.

- **Domain**: `dsh_studio_ui`, version 1, backend `json`, file
  `storages/dsh_studio_ui.json`.
  - Five tables recorded under `state`: `left_rail_view`, `center_surfaces`,
    `sidebar_chrome`, `sidebar_layouts`, `flags`.

  - One key holding the whole DTO matches the json backend's whole-file
    atomic write; clients hydrate per table with debounced serialized writes;
    field evolution rides zod defaults and the domain version.
- **Host wiring** (`plugins/capabilities`):
  - `storageDomain` injected, opening `UI_CHROME_DOMAIN`, closed with plugin
    lifecycle;
  - `ui-chrome.get/put/delete` reuse the capabilities API wrapper and accept
    only the fixed table allowlist;
  - **missing fallback**: no `storageDomain` → route 503 → client keeps
    in-memory state, never double-writes.
- **Client side**: left-rail views, center surfaces, right-rail
  chrome/layouts and flags all go through
  `@dsh-studio/shared/ui-chrome-storage`; `tabsEnabled`/`viewersEnabled`
  remain read/written only through `dsh-better-sidebar` settings'
  `runtime-settings`.
- **Old-data policy**: old localStorage data inside this plan's scope is
  discarded outright — no reads, no carrying over, no compatibility, no dual
  writes. Only `keymap.v1` and diff comments remain within their own future
  architecture scopes.

## 5. Appendix: on-disk quick reference

| Path (relative to data root) | Contents | Maintainer |
|---|---|---|
| `settings.yaml` | all tier-1 namespaces | dsh-settings-file (official) |
| `storages/workspace.json`, `session_projcache.json` | official domains | dsh-workspace / dsh-session-projection-cache (official) |
| `storages/dsh_studio_ui.json` | this repo's UI chrome domain | capabilities + `@dsh-studio/*` |
| `desktop-skins.json` | skin preferences | desktop-skins |
| `plugin-marketplace/` | catalog cache / rollbacks / previews | plugin-marketplace |
| `terminal-sessions/sessions.json` | terminal session history | capabilities |
| `sessions/` | session JSONL | official session persistence |
| `environment-cache.json` | user environment cache | src |
| `.credentials.yaml` | secrets | dsh-credentials-local (official) |
| `desktop/Local Storage` | tier-4 browser UI state (transitional) | each browser plugin |
| `worktrees/` | default linked worktree storage root | capabilities (`worktreeDir` overrides) |
