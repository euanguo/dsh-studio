/**
 * The Oh-DSH sidebar public contract: the descriptor vocabulary and service
 * face external plugins use to contribute sidebar tabs, file viewers,
 * center-surface renderers and declarative settings.
 *
 * This module is the single source of truth for the registry protocol — the
 * implementation (`./sidebar-service.ts`), the built-in registrations
 * (`./tabs/*` / `./viewers/*`), the settings seam (`./settings.tsx`) and
 * the desktop enhancement plugin (`plugins/sidebar-desktop`) all import
 * from here. It mirrors the upstream DSH-better-sidebar `ctx.betterSidebar`
 * contract (id/title/icon/order/hidden/available/single/dedupeKey/createTab/
 * urlTarget/settings/badge/onOpen/onActivate/onClose) plus Oh-DSH's own
 * extensions (`action` / `chrome` / `requiresWorkspace` / `shortcut` and the
 * center-surface renderer registry), so a consumer written against one host
 * adapts to the other with minimal changes.
 *
 * Constraints:
 * - CLIENT-REACHABLE ONLY: no Node.js types (`node:*`, `Buffer`), no DOM
 *   types beyond what a browser bundle needs, no value imports from other
 *   plugins. This file must stay importable from browser-only consumer
 *   builds (the `declare module 'cordis'` augmentation rides on it).
 * - TYPE-ONLY by default: every export is a type or a plain constant; the
 *   runtime lives in `sidebar-service.ts`.
 */
import type { ReactNode } from 'react'
import type { CenterSurface, CenterSurfaceKind } from './surfaces/types.ts'

/** One session scope: the conversation id plus its cwd when known. */
export interface SidebarScope {
  sessionId: string
  /** The session's working directory (absent until the session hydrates). */
  cwd?: string
}

/** One open sidebar tab instance (persisted per session). */
export interface SidebarTab {
  id: string
  /** The tab type — the id of the descriptor that rendered it. */
  type: string
  title: string
  /** File path / URL seed the tab was opened with (the `path` analogue). */
  resource?: string
  /** JSON-serializable custom state carried on the tab (persisted across reloads). */
  meta?: unknown
}

/** One `openTab` request. */
export interface SidebarTabSeed {
  type: string
  /** Overrides the descriptor's title when given (the file tab shows the file name). */
  title?: string
  /** A file path / URL the tab is seeded with. */
  resource?: string
  /** Explicit tab id (defaults to the type or a generated instance id). */
  id?: string
  /** JSON-serializable custom state persisted with the tab. */
  meta?: unknown
  /** A URL the tab navigates to on mount (the browser tab's seed). */
  url?: string
}

/** The snapshot the service publishes (geometry + open tabs + prefs). */
export interface SidebarSnapshot {
  activeId: string | null
  error: string | null
  maximized: boolean
  open: boolean
  openByDefault: boolean
  ready: boolean
  revision: number
  /** The session this snapshot belongs to (null before any session). */
  sessionId: string | null
  /** The scope (session + cwd) rendered inside the panel. */
  scope: SidebarScope | null
  tabs: readonly SidebarTab[]
  tabsEnabled: Readonly<Record<string, boolean>>
  viewersEnabled: Readonly<Record<string, boolean>>
  /** Plugin-owned settings blobs keyed by descriptor id. */
  pluginSettings: Readonly<Record<string, Record<string, unknown>>>
  width: number
}

/** The outcome of one `openTab` call. */
export type OpenTabResult =
  | { kind: 'disabled' | 'limit' | 'missing' | 'not-ready' }
  | { kind: 'focused' | 'opened'; tab: SidebarTab }

/** Props every tab render function receives. */
export interface SidebarRenderProps {
  /** Whether this tab is the active one AND the panel is open. */
  active: boolean
  close(): void
  /** Patch the open tab's display fields (title / resource / meta). */
  patch(patch: { resource?: string; title?: string; meta?: unknown }): void
  /** The scope the tab renders against (null before a session is active). */
  scope: SidebarScope | null
  tab: SidebarTab
}

/** The row control a declarative setting renders as in the settings popup. */
export type SidebarSettingToggleType = 'switch' | 'text' | 'number'

/** One declarative setting row of a registered tab/viewer. */
export interface SidebarSettingToggle {
  /** The prefs field this toggle reads and writes. */
  key: string
  /** Row title (i18n friendly: string or () => string). */
  title: string | (() => string)
  /** Row description (i18n friendly). */
  desc?: string | (() => string)
  /** Row control type; defaults to 'switch'. */
  type?: SidebarSettingToggleType
  /** Lower bound for `type: 'number'` rows (clamped on commit). */
  min?: number
  /** Upper bound for `type: 'number'` rows (clamped on commit). */
  max?: number
  /** Input placeholder for `type: 'text'` rows. */
  placeholder?: string
  /** Unit suffix rendered after the input (e.g. 'px'). */
  unit?: string
}

/** Props of a descriptor's custom settings panel (`settings.render`). */
export interface SidebarSettingsRenderProps {
  /** The live preferences document (the open maps included). */
  prefs: Record<string, unknown>
  /** This descriptor's own persisted settings blob (from `pluginSettings[id]`). */
  pluginSettings: Record<string, unknown>
  /** Persist one plugin-owned setting of this descriptor. */
  updatePluginSetting(key: string, value: unknown): void
  /** Close the settings popup. */
  close(): void
}

/** Declarative settings of one registered tab or file viewer. */
export interface SidebarSettingsDeclaration {
  /**
   * Extra settings rows rendered under the feature's own row. Keys must be
   * fields of the host preferences (built-ins: 'agentTerminalTools',
   * 'bottomPanelAutoTerminal', 'browserInterceptLinks', ...); unknown keys
   * are dropped by the settings seam.
   */
  toggles?: readonly SidebarSettingToggle[]
  /**
   * Plugin-owned settings rows: same row controls as `toggles`, but the
   * keys are plugin-local and persisted in `pluginSettings[<descriptor id>]`
   * — no host prefs field needed. Values must be JSON-serializable.
   */
  pluginToggles?: readonly SidebarSettingToggle[]
  /**
   * Custom settings panel: when given, the gear popup renders this instead
   * of the row lists. A throw is swallowed and shown inline.
   */
  render?: (props: SidebarSettingsRenderProps) => ReactNode
}

/** Describes one kind of sidebar tab (built-ins register themselves too). */
export interface SidebarTabDescriptor {
  /** Unique id; also the `SidebarTab.type` value. */
  id: string
  /** Title (i18n friendly). */
  title: string | (() => string)
  /** Icon: ReactNode or (size) => ReactNode. */
  icon?: ReactNode | ((size: number) => ReactNode)
  /** + menu sort order (ascending); default 100. */
  order?: number
  /** Hide from the + menu (the file tab is opened by file-open, not the menu). */
  hidden?: boolean
  /**
   * + menu disabled predicate (e.g. no workspace). Receives the live scope
   * and snapshot. Only gates the menu row — it does not refuse `openTab`.
   */
  available?: (scope: SidebarScope | null, state: SidebarSnapshot) => boolean
  /**
   * Single-instance sugar: `true` is shorthand for `dedupeKey: () => id`
   * (opening the tab focuses an existing one of the same type). An explicit
   * `dedupeKey` always wins when both are given.
   */
  single?: boolean
  /**
   * If provided, opening a tab whose `dedupeKey(tab)` matches an existing
   * tab's key focuses the existing one instead of creating a new one.
   * Returning `undefined` means "no dedup — always open a new tab".
   */
  dedupeKey?: (tab: SidebarTab) => string | undefined
  /**
   * Custom tab creation (minting the `SidebarTab` and any state patch).
   * Return `null` to refuse creation. When omitted, a default
   * `{ id, type, title, resource? }` tab is created.
   */
  createTab?: (
    seed: SidebarTabSeed,
    tabs: readonly SidebarTab[],
  ) => { tab: SidebarTab; patch?: { tabs?: readonly SidebarTab[]; activeId?: string | null } } | null
  /**
   * External-link target claim: when a GUI external-link click is taken
   * over, the first registered tab whose `urlTarget(url)` returns true is
   * opened with the URL as its resource seed. The built-in browser tab
   * declares NO urlTarget — it stays the implicit fallback target.
   */
  urlTarget?: (url: URL) => boolean
  /**
   * Declarative settings shown in the sidebar settings page: every
   * registered tab gets an enable/disable switch, and `settings.toggles`
   * adds nested rows tied to host prefs fields.
   */
  settings?: SidebarSettingsDeclaration
  /**
   * Tab-strip badge: a small pill rendered on the tab next to the icon — a
   * number renders as a count (99+ capped), a string renders as-is,
   * null/undefined hides the badge. A throw is swallowed (no badge shown).
   */
  badge?: (scope: SidebarScope | null, state: SidebarSnapshot) => string | number | null | undefined
  /**
   * Lifecycle callbacks. Fired by the SERVICE paths only: `onOpen` when an
   * open actually creates a tab (a dedupe/id-safety-net focus is NOT an
   * open — it fires `onActivate` instead), `onActivate` when a tab is
   * focused, `onClose` when a tab is closed. A throwing callback is logged
   * and never breaks the open/close/activate flow.
   */
  onOpen?: (tab: SidebarTab, scope: SidebarScope) => void
  onActivate?: (tab: SidebarTab, scope: SidebarScope) => void
  onClose?: (tab: SidebarTab, scope: SidebarScope) => void
  /**
   * The tab body renderer. `action`-only descriptors (no render) are menu
   * shortcuts: opening them runs the action instead of opening a tab.
   */
  render?: (props: SidebarRenderProps) => ReactNode
  /** Run an action instead of opening a tab (menu shortcut entries). */
  action?: () => void | Promise<void>
  /** 'custom' renders the body with no chrome; 'standard' adds tab chrome. */
  chrome?: 'custom' | 'standard'
  /** Disable the + menu row while no workspace is active. */
  requiresWorkspace?: boolean
  /** Keyboard hint shown in the + menu row (display only). */
  shortcut?: string
}

/** How the host loads a file's bytes for one viewer. */
export type SidebarFileFetchStrategy =
  | 'none'               // no bytes needed (the viewer fetches through mediaUrl itself)
  | 'fsRead'             // text read through the host fs.read API
  | 'mediaUrl'           // the viewer gets a media URL string
  | 'custom'             // the viewer's render() fetches its own bytes (scope provided)
  | 'binary-download'    // show a download button (no client-side renderer)

/** The render input of one file viewer. */
export interface SidebarViewerRenderInput {
  /** fsRead text content (fetchStrategy='fsRead'). */
  content?: string
  /** The absolute path of the opened file. */
  path: string
  /** mediaUrl for the path (fetchStrategy='mediaUrl'). */
  resourceUrl?: string
  /** The scope of the owning session (custom viewers). */
  scope?: SidebarScope
  title: string
  /** fsRead truncation flag. */
  truncated?: boolean
}

/** Describes one file previewer (built-ins register themselves too). */
export interface SidebarViewerDescriptor {
  /** Unique id ('markdown', 'my-plugin:csv'). */
  id: string
  /** Display name for the settings inventory (falls back to `id` when absent). */
  title?: string | (() => string)
  /** Icon shown in the settings inventory. */
  icon?: ReactNode | ((size: number) => ReactNode)
  /** Lowercase extensions without leading dot; `[]` = catch-all. */
  exts: readonly string[]
  /** Higher wins; default 0. Built-ins use 0; the catch-all text viewer uses -100. */
  priority?: number
  fetchStrategy: SidebarFileFetchStrategy
  /** Content sniff: when `head` bytes are available, `detect` is consulted
   *  before `exts` (per descriptor, in priority order). */
  detect?: (path: string, head: Uint8Array) => boolean
  /** Declarative settings shown in the sidebar settings page. */
  settings?: SidebarSettingsDeclaration
  /** The preview renderer. */
  render?: (input: SidebarViewerRenderInput) => ReactNode
}

/** One center-surface renderer (Oh-DSH extension: the middle workbench). */
export type SidebarSurfaceRenderer = (surface: CenterSurface) => ReactNode

/**
 * The registry service published as `ctx.desktopSidebar`. External plugins
 * contribute tabs / viewers / surface renderers through it; every method is
 * synchronous-snapshot so React reads it via `useSyncExternalStore`.
 */
export interface DesktopSidebarService {
  /* ── registry ─────────────────────────────────────────────── */
  registerTab(descriptor: SidebarTabDescriptor): () => void
  registerViewer(descriptor: SidebarViewerDescriptor): () => void
  /** Register a center-surface kind renderer (Oh-DSH extension). */
  registerSurfaceRenderer(kind: CenterSurfaceKind, renderer: SidebarSurfaceRenderer): () => void
  getTabs(): readonly SidebarTabDescriptor[]
  getViewers(): readonly SidebarViewerDescriptor[]
  getTab(id: string): SidebarTabDescriptor | undefined
  subscribe(listener: () => void): () => void

  /* ── enablement ───────────────────────────────────────────── */
  isTabEnabled(id: string): boolean
  isViewerEnabled(id: string): boolean
  setTabEnabled(id: string, enabled: boolean): void
  setViewerEnabled(id: string, enabled: boolean): void

  /* ── matching ─────────────────────────────────────────────── */
  /** Find a viewer for a path (priority desc; detect first, then exts). */
  matchViewer(path: string, head?: Uint8Array): SidebarViewerDescriptor | undefined
  /** The first ENABLED tab whose `urlTarget` claims the URL (registration
   *  order; a throwing predicate is skipped). */
  resolveUrlTarget(url: URL): SidebarTabDescriptor | undefined
  /** Render a center surface through the registered renderers. */
  renderSurface(surface: CenterSurface): ReactNode

  /* ── open / close / activate ──────────────────────────────── */
  /**
   * Open a tab (+ menu and external triggers both use it). `scope` targets
   * a specific session: the open lands in THAT session's state without
   * switching the UI's active session; absent, the open lands in the
   * currently active session. A disabled tab type is a no-op.
   */
  openTab(seed: SidebarTabSeed, scope?: SidebarScope): OpenTabResult
  /** Close a tab by id (fires descriptor.onClose). Unknown ids are a no-op. */
  closeTab(tabId: string, scope?: SidebarScope): void
  /** Activate an open tab (fires descriptor.onActivate). Unknown ids are a no-op. */
  activateTab(tabId: string | null, scope?: SidebarScope): void
  /** Patch an open tab's display fields; a missing tab id is a no-op. */
  updateTab(tabId: string, patch: { resource?: string; title?: string; meta?: unknown }): void
  /** Open a file in the sidebar of `scope`'s session (title defaults to the file name). */
  openFile(scope: SidebarScope, path: string, title?: string): void

  /* ── state ────────────────────────────────────────────────── */
  getSnapshot(): SidebarSnapshot

  /* ── capability contract ──────────────────────────────────── */
  /** The plugin version this service instance was built from. */
  readonly version: string
  /** Monotonic capability list (never removed). */
  readonly features: readonly string[]

  /* ── plugin-owned settings ────────────────────────────────── */
  /** The persisted settings blob of one descriptor id. */
  getPluginSettings(id: string): Record<string, unknown>
  /** Persist one plugin-owned setting of one descriptor id. */
  updatePluginSetting(id: string, key: string, value: unknown): void

  /* ── panel geometry ───────────────────────────────────────── */
  setOpen(open: boolean): void
  setMaximized(maximized: boolean): void
  setWidth(width: number): void
  setOpenByDefault(open: boolean): void
  /** Bind the snapshot to a session (optionally with its cwd). */
  setSession(sessionId: string | null, cwd?: string): void
}

/**
 * The plugin version this service instance reports. Keep in lockstep with
 * `package.json`'s version — the contract spec asserts the pair.
 */
export const SIDEBAR_SERVICE_VERSION = '0.1.2'

/**
 * Monotonic capability list consumers use to gate new API usage (features
 * are never removed). Each string names a contract capability:
 * - 'badge': SidebarTabDescriptor.badge
 * - 'tabLifecycle': onOpen/onActivate/onClose
 * - 'updateTab': DesktopSidebarService.updateTab
 * - 'openFile': DesktopSidebarService.openFile
 * - 'targetedOpen': openTab/closeTab/activateTab with a scope
 * - 'stateSubscription': getSnapshot/subscribe
 * - 'tabMeta': SidebarTab.meta (seeds, createTab, updateTab, persistence)
 * - 'pluginSettings': SidebarSettingsDeclaration.pluginToggles/render
 * - 'urlTarget': SidebarTabDescriptor.urlTarget (external-link claims)
 * - 'surfaceRenderer': registerSurfaceRenderer (Oh-DSH extension)
 */
export const SIDEBAR_FEATURES = [
  'badge',
  'tabLifecycle',
  'updateTab',
  'openFile',
  'targetedOpen',
  'stateSubscription',
  'tabMeta',
  'pluginSettings',
  'urlTarget',
  'surfaceRenderer',
] as const

export type SidebarFeature = typeof SIDEBAR_FEATURES[number]

/**
 * Cordis augmentation for real DSH/cordis environments: a consumer plugin
 * that lives inside a cordis runtime gets `ctx.desktopSidebar` typed after
 * `import type {} from '@oh-dsh/sidebar/client/contract'` (the type-only
 * import is erased at compile time). The empty type-import of cordis below
 * only triggers module resolution so the augmentation is legal — it is
 * erased at compile time, keeping the bundle cordis-free. In a non-cordis
 * bundle the declaration is inert: `declare module` for a module that is
 * never imported is a no-op.
 */
import type {} from 'cordis'

declare module 'cordis' {
  interface Context {
    desktopSidebar: DesktopSidebarService
  }
}
