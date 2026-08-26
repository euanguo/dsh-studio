/**
 * The desktop sidebar registry service: tabs, file viewers, center-surface
 * renderers and plugin-owned settings, plus the per-session open-tab state.
 *
 * The public contract lives in `./contract.ts` (descriptor vocabulary +
 * service face, shared with the settings seam, the built-in registrations
 * and external consumer plugins). This module implements it.
 *
 * Design notes:
 * - One sidebar descriptor table (`Map<kind, SidebarSurfaceDescriptor>`): the
 *   former tab / viewer / surface-renderer registrations are aspects of a
 *   single descriptor, registered through `register()` alone. Each accepted
 *   registration projects its routing metadata into the injected kernel
 *   `workbench.registry`; no caller maintains a second routing list.
 * - The sidebar view is a synchronous snapshot (Map + listener set) so React
 *   can read it through `useSyncExternalStore` without tearing.
 * - `dedupeKey` unifies the open-tab strategies: single-instance
 *   (`single: true` ≡ `() => kind`), per-resource (`tab => tab.resource`) and
 *   per-id. `createTab` lets a descriptor own tab instantiation and state
 *   patching.
 * - `matchViewer` walks viewer specs in priority order (desc, stable): per
 *   descriptor it tries `detect` first (when `head` bytes are given), then
 *   `exts`; `exts: []` is a catch-all.
 * - Lifecycle callbacks (onOpen/onActivate/onClose) fire from the SERVICE
 *   paths only; a throwing callback is logged and never breaks the flow.
 * - State is persisted per session (tabs layout) plus the enable maps and
 *   the pluginSettings blobs; writes are throttled through one flush queue.
 */
import type { ReactNode } from 'react'
import { basename } from '@dsh-studio/shared/path'
import type { CenterSurface } from './surfaces/types.ts'
import type {
  PreviewTabsMode,
  SurfaceDescriptor,
  SurfaceRegistry,
} from '@dsh-studio/shared/workbench-contracts'
import type { LayoutScopeMode } from '../sidebar-preferences.ts'
import { GLOBAL_SCOPE_BUCKET } from '@dsh-studio/shared/workbench-contracts'
import {
  clampPersistedWidth,
  clampSidebarWidth,
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_MAX_TABS,
  SIDEBAR_MAX_WORKSPACES,
  type DesktopSidebarPreferences,
  type PersistedSidebarTab,
  type PersistedWorkspaceLayout,
} from '../sidebar-preferences.ts'
import type { SidebarPreferencesStorage } from './sidebar-storage.ts'
import { persistVia, type PersistViaHandle } from '@dsh-studio/shared/store-persistence'
import { errorMessage } from '@dsh-studio/shared/errors'
import {
  SIDEBAR_FEATURES,
  SIDEBAR_SERVICE_VERSION,
  tabAvailability,
  type DesktopSidebarService as DesktopSidebarServiceContract,
  type OpenTabResult,
  type CapabilitiesScope,
  type SidebarSnapshot,
  type SidebarSurfaceDescriptor,
  type SidebarTab,
  type SidebarTabSeed,
} from './contract.ts'
import { reorderById } from './tab-drag.ts'

export type {
  OpenTabResult,
  SidebarFeature,
  SidebarCenterSpec,
  SidebarFileFetchStrategy,
  SidebarRailSpec,
  SidebarRenderProps,
  CapabilitiesScope,
  SidebarSettingToggle,
  SidebarSettingToggleType,
  SidebarSettingsDeclaration,
  SidebarSettingsRenderProps,
  SidebarSnapshot,
  SidebarSurfaceDescriptor,
  SidebarTab,
  SidebarTabSeed,
  SidebarViewerRenderInput,
  SidebarViewerSpec,
} from './contract.ts'

export { SIDEBAR_FEATURES, SIDEBAR_SERVICE_VERSION } from './contract.ts'

/** Re-exported for the panel: the persisted tab shape is the live tab shape. */
export interface DesktopSidebarTab extends PersistedSidebarTab {}

/** One request's target workspace; absent means the active project. */
interface WorkspaceTarget {
  cwd: string
  /** True when the target is NOT the project on screen (no UI publish). */
  inactive: boolean
}

function extensionOf(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  return dot > separator ? path.slice(dot + 1).toLowerCase() : ''
}

function titleOf(descriptor: SidebarSurfaceDescriptor): string {
  const title = descriptor.rail?.title
  if (title === undefined) return descriptor.kind
  return typeof title === 'function' ? title() : title
}

/**
 * Project the React-bearing sidebar descriptor into the React-free kernel
 * vocabulary. The sidebar keeps the presentation payload; the workbench
 * registry owns the routing facts used by every open request.
 */
function toKernelDescriptor(
  descriptor: SidebarSurfaceDescriptor,
  kind: string,
): SurfaceDescriptor {
  const rail = descriptor.rail === undefined
    ? undefined
    : {
      ...(descriptor.rail.order === undefined ? {} : { order: descriptor.rail.order }),
      ...(descriptor.rail.single === undefined ? {} : { single: descriptor.rail.single }),
      ...(descriptor.rail.single === true ? { dedupeKey: kind } : {}),
    }
  const center = descriptor.center === undefined
    ? undefined
    : {
      ...(descriptor.center.dedupeKey === undefined
        ? {}
        : { dedupeKey: descriptor.center.dedupeKey }),
    }
  const viewer = descriptor.viewer === undefined
    ? undefined
    : {
      exts: descriptor.viewer.exts,
      ...(descriptor.viewer.priority === undefined
        ? {}
        : { priority: descriptor.viewer.priority }),
    }
  return {
    kind,
    ...(rail === undefined ? {} : { rail }),
    ...(center === undefined ? {} : { center }),
    ...(viewer === undefined ? {} : { viewer }),
    scopeNeed: descriptor.scopeNeed,
    previewable: descriptor.previewable,
    focusPolicy: descriptor.focusPolicy,
  }
}

function messageOf(error: unknown): string {
  return errorMessage(error)
}

/** Window width for the live rail cap; absent in pure / node contexts. */
function currentViewportWidth(): number | undefined {
  return typeof window === 'undefined' ? undefined : window.innerWidth
}

/** Clamp a reorder destination into `0..limit-1` (limit 0 → 0). */
function clampIndex(index: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(limit - 1, Math.max(0, Math.round(index)))
}

/** Run one plugin callback; a throw is logged and never breaks the caller. */
function safeCall(fn: () => void): void {
  try {
    fn()
  } catch (error) {
    console.error('[sidebar] plugin callback error:', error)
  }
}

function freshPreferences(): DesktopSidebarPreferences {
  return {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    workspaces: {},
    pluginSettings: {},
  }
}

function clonePreferences(
  preferences: DesktopSidebarPreferences,
): DesktopSidebarPreferences {
  return {
    ...preferences,
    // Document-bound defense only: the LIVE viewport cap is applied when a
    // width is read out (layoutWidth), never at persist time — otherwise a
    // width saved on a larger display would silently shrink here.
    defaultWidth: clampPersistedWidth(preferences.defaultWidth),
    workspaces: Object.fromEntries(Object.entries(preferences.workspaces).map(
      ([cwd, workspace]) => [cwd, cloneWorkspace(workspace)],
    )),
    pluginSettings: Object.fromEntries(
      Object.entries(preferences.pluginSettings).map(
        ([id, blob]) => [id, { ...blob }],
      ),
    ),
  }
}

/** Shallow-per-tab clone of a single workspace layout. */
function cloneWorkspace(workspace: PersistedWorkspaceLayout): PersistedWorkspaceLayout {
  return {
    ...workspace,
    tabs: workspace.tabs.map(tab => ({ ...tab })),
    ...(workspace.bottomTabs === undefined
      ? {}
      : { bottomTabs: workspace.bottomTabs.map(tab => ({ ...tab })) }),
  }
}

export class DesktopSidebarService implements DesktopSidebarServiceContract {
  private readonly listeners = new Set<() => void>()
  /** The sidebar presentation table; registration projects into the kernel table. */
  private readonly surfaces = new Map<string, SidebarSurfaceDescriptor>()
  private readonly kernelRegistry: SurfaceRegistry
  private readonly kernelDisposers = new Map<string, () => void>()
  private preferences = freshPreferences()
  private disposed = false
  private instance = 0
  private readonly storage: SidebarPreferencesStorage
  /** Template-C persistence pump: hydrate is driven by `start()`; the facade
   *  owns the single-flight flush and the teardown drain. */
  private readonly persist: PersistViaHandle
  /** Serializes saves so `settle()` can drain before host teardown. */
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly onFeatureEnablementChange: ((next: {
    tabsEnabled: Record<string, boolean>
    viewersEnabled: Record<string, boolean>
  }) => void) | undefined
  private tabsEnabled: Record<string, boolean> = {}
  private viewersEnabled: Record<string, boolean> = {}
  private snapshot: SidebarSnapshot = {
    activeId: null,
    // BOTTOM workbench snapshot fields are published dormant contract — the
    // workbench is not mounted pending a product decision, so they stay
    // null/empty until a dock UI re-wires the bottom methods below.
    bottomActiveId: null,
    bottomTabs: [],
    error: null,
    maximized: false,
    open: false,
    openByDefault: false,
    ready: false,
    revision: 0,
    cwd: null,
    scope: null,
    tabs: [],
    tabsEnabled: {},
    viewersEnabled: {},
    pluginSettings: {},
    centerPreviewTabs: DEFAULT_SIDEBAR_PREFERENCES.centerPreviewTabs,
    layoutScope: DEFAULT_SIDEBAR_PREFERENCES.layoutScope,
    width: DEFAULT_SIDEBAR_PREFERENCES.defaultWidth,
  }

  readonly version = SIDEBAR_SERVICE_VERSION
  readonly features = SIDEBAR_FEATURES

  constructor(
    storage: SidebarPreferencesStorage,
    onFeatureEnablementChange: ((next: {
      tabsEnabled: Record<string, boolean>
      viewersEnabled: Record<string, boolean>
    }) => void) | undefined,
    kernelRegistry: SurfaceRegistry,
  ) {
    this.storage = storage
    this.onFeatureEnablementChange = onFeatureEnablementChange
    this.kernelRegistry = kernelRegistry
    this.persist = persistVia<DesktopSidebarPreferences>(
      {
        // Pull-driven: schedulePersist() fires at the same mutators that used
        // to call the hand-written flush pump.
        subscribe: () => () => {},
        snapshot: () => clonePreferences(this.preferences),
        apply: () => {}, // hydration is owned by `start()` (awaited load)
      },
      {
        // `DomainSidebarPreferencesStorage.save` flushes the ui-chrome table
        // internally; a write queue still gives `settle()` a drain handle so
        // teardown never returns before the last write lands.
        backend: {
          load: () => storage.load(),
          save: value => {
            this.writeQueue = this.writeQueue.then(() => storage.save(value))
          },
          flush: () => this.writeQueue.catch(() => {}),
        },
        merge: (stored, current) => current,
        hydrate: false,
      },
    )
  }

  getSnapshot = (): SidebarSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(): Promise<void> {
    const requestedCwd = this.snapshot.cwd
    try {
      let storedPreferences = await this.storage.load()
      // A transport hiccup resolves to defaults; retry briefly before
      // adopting them, so a short outage cannot later persist defaults over
      // the intact host record.
      for (let attempt = 0; attempt < 5 && this.storage.availability?.() === 'unavailable'; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)))
        storedPreferences = await this.storage.load()
      }
      this.preferences = clonePreferences(storedPreferences)
      this.publish({
        ...this.workspaceSnapshot(requestedCwd),
        error: null,
        maximized: false,
        open: this.preferences.openByDefault,
        openByDefault: this.preferences.openByDefault,
        ready: true,
        revision: this.snapshot.revision + 1,
        cwd: requestedCwd,
        scope: requestedCwd === null
          ? null
          : { cwd: requestedCwd },
        tabsEnabled: { ...this.tabsEnabled },
        viewersEnabled: { ...this.viewersEnabled },
        pluginSettings: this.pluginSettingsSnapshot(),
        centerPreviewTabs: this.preferences.centerPreviewTabs,
        layoutScope: this.preferences.layoutScope,
        width: this.layoutWidth(requestedCwd),
      })
    } catch (error) {
      this.publish({
        ...this.snapshot,
        error: messageOf(error),
        ready: true,
        revision: this.snapshot.revision + 1,
      })
    }
  }

  dispose(): void {
    this.disposed = true
    for (const dispose of this.kernelDisposers.values()) dispose()
    this.kernelDisposers.clear()
    this.surfaces.clear()
    this.listeners.clear()
  }

  register(descriptor: SidebarSurfaceDescriptor): () => void {
    const kind = typeof descriptor.kind === 'string' ? descriptor.kind.trim() : ''
    if (kind === '') {
      throw new Error('sidebar: surface descriptor requires a non-empty kind')
    }
    if (descriptor.rail === undefined
      && descriptor.center === undefined
      && descriptor.viewer === undefined) {
      throw new Error(`surface ${kind} must declare a rail, center or viewer spec`)
    }
    // Kernel parity: only center-class surfaces can be replaceable previews.
    if (descriptor.previewable && descriptor.center === undefined) {
      throw new Error(`surface ${kind} is previewable but declares no center spec`)
    }
    if (this.surfaces.has(kind)) {
      throw new Error(`sidebar: duplicate surface "${kind}"`)
    }
    const disposeKernel = this.kernelRegistry.register(toKernelDescriptor(descriptor, kind))
    this.surfaces.set(kind, descriptor)
    this.kernelDisposers.set(kind, disposeKernel)
    this.touch()
    return () => {
      if (this.surfaces.get(kind) === descriptor) {
        this.surfaces.delete(kind)
        this.kernelDisposers.get(kind)?.()
        this.kernelDisposers.delete(kind)
        this.touch()
      }
    }
  }

  renderSurface(surface: CenterSurface): ReactNode {
    const renderer = this.surfaces.get(surface.kind)?.center?.render
    return renderer === undefined ? null : renderer(surface)
  }

  getTabs(): readonly SidebarSurfaceDescriptor[] {
    return [...this.surfaces.values()]
      .filter(descriptor => descriptor.rail !== undefined)
      .sort(
        (left, right) => (left.rail!.order ?? 100) - (right.rail!.order ?? 100),
      )
  }

  getViewers(): readonly SidebarSurfaceDescriptor[] {
    return [...this.surfaces.values()]
      .filter(descriptor => descriptor.viewer !== undefined)
      .sort(
        (left, right) => (right.viewer!.priority ?? 0) - (left.viewer!.priority ?? 0),
      )
  }

  getTab(id: string): SidebarSurfaceDescriptor | undefined {
    return this.surfaces.get(id)
  }

  isTabEnabled(id: string): boolean {
    return this.tabsEnabled[id] !== false
  }

  isViewerEnabled(id: string): boolean {
    return this.viewersEnabled[id] !== false
  }

  setFeatureEnablement(
    tabsEnabled: Readonly<Record<string, boolean>>,
    viewersEnabled: Readonly<Record<string, boolean>>,
  ): void {
    this.tabsEnabled = { ...tabsEnabled }
    this.viewersEnabled = { ...viewersEnabled }
    this.publish({
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      tabsEnabled: { ...this.tabsEnabled },
      viewersEnabled: { ...this.viewersEnabled },
    })
  }

  matchViewer(
    path: string,
    head?: Uint8Array,
  ): SidebarSurfaceDescriptor | undefined {
    const extension = extensionOf(path)
    for (const descriptor of this.getViewers()) {
      if (!this.isViewerEnabled(descriptor.kind)) continue
      const viewer = descriptor.viewer!
      if (head !== undefined && viewer.detect !== undefined) {
        if (viewer.detect(path, head)) return descriptor
        // A catch-all with detect is SNIFF-ONLY: it must not blind-claim
        // paths it never sniffed.
        if (viewer.exts.length === 0) continue
      } else if (viewer.exts.length === 0) {
        // Blind catch-all (no detect) claims anything; a sniff-only
        // catch-all (detect defined, no head yet) yields this round.
        if (viewer.detect === undefined) return descriptor
        continue
      }
      if (viewer.exts.map(value => value.toLowerCase()).includes(extension)) {
        return descriptor
      }
    }
    return undefined
  }

  resolveUrlTarget(url: URL): SidebarSurfaceDescriptor | undefined {
    // Registration order wins (Map iteration is insertion order); a
    // disabled tab type is skipped; a throwing predicate is swallowed.
    for (const descriptor of this.surfaces.values()) {
      if (descriptor.rail?.urlTarget === undefined) continue
      if (!this.isTabEnabled(descriptor.kind)) continue
      let claimed = false
      try {
        claimed = descriptor.rail.urlTarget(url) === true
      } catch (error) {
        console.error('[sidebar] urlTarget error:', error)
        continue
      }
      if (claimed) return descriptor
    }
    return undefined
  }

  getPluginSettings(id: string): Record<string, unknown> {
    return { ...(this.preferences.pluginSettings[id] ?? {}) }
  }

  updatePluginSetting(id: string, key: string, value: unknown): void {
    if (this.preferences.pluginSettings[id]?.[key] === value
      && Object.hasOwn(this.preferences.pluginSettings[id] ?? {}, key)) return
    const blob = { ...(this.preferences.pluginSettings[id] ?? {}) }
    blob[key] = value
    this.preferences.pluginSettings[id] = blob
    this.publish({
      ...this.snapshot,
      pluginSettings: this.pluginSettingsSnapshot(),
      revision: this.snapshot.revision + 1,
    })
    this.schedulePersist()
  }

  setWorkspace(cwd: string | null): void {
    if (cwd === this.snapshot.cwd) return
    this.publish({
      ...this.snapshot,
      ...this.workspaceSnapshot(cwd),
      revision: this.snapshot.revision + 1,
      cwd,
      scope: cwd === null ? null : { cwd },
    })
  }

  openTab(seed: SidebarTabSeed, scope?: CapabilitiesScope): OpenTabResult {
    if (!this.snapshot.ready) return { kind: 'not-ready' }
    const target = this.targetOf(scope)
    if (target === null) return { kind: 'not-ready' }
    const descriptor = this.surfaces.get(seed.type)
    // Only rail-mounted surfaces can host an open tab.
    const rail = descriptor?.rail
    if (descriptor === undefined || rail === undefined) return { kind: 'missing' }
    // ONE availability gate: folds `scopeNeed`, the rail `available`
    // predicate and the enable map into a single answer, so `openTab` and
    // every UI entry point agree on whether (and why) a tab can open now.
    const availability = tabAvailability(descriptor, { cwd: target.cwd }, this.snapshot, this.isTabEnabled(seed.type))
    if (!availability.ok) return { kind: 'disabled', reason: availability.reason }
    const tabs = [...this.workspaceOf(target.cwd).tabs]
    // Action-only descriptors run instead of opening a tab.
    if (rail.action !== undefined && rail.render === undefined) {
      void rail.action()
      return { kind: 'focused', tab: {
        id: descriptor.kind,
        type: descriptor.kind,
        title: titleOf(descriptor),
      } }
    }
    const created = rail.createTab?.(seed, tabs)
    if (created === null) return { kind: 'disabled' }
    const tab = created?.tab ?? {
      id: seed.id ?? (rail.single === true
        ? descriptor.kind
        : `${descriptor.kind}:${String(Date.now())}:${String(++this.instance)}`),
      type: descriptor.kind,
      title: seed.title ?? titleOf(descriptor),
      ...(seed.resource !== undefined ? { resource: seed.resource } : {}),
      ...(seed.meta !== undefined ? { meta: seed.meta } : {}),
    }
    const key = rail.dedupeKey?.(tab)
      ?? (rail.single === true ? descriptor.kind : undefined)
    const existing = tabs.find(candidate => {
      if (candidate.id === tab.id) return true
      if (candidate.type !== tab.type || key === undefined) return false
      const candidateKey = rail.dedupeKey?.(candidate)
        ?? (rail.single === true ? descriptor.kind : undefined)
      return candidateKey === key
    })
    if (existing !== undefined) {
      // A dedupe/id-safety-net focus is an ACTIVATION, not an open — it
      // fires onActivate even when the tab is already the active one (the
      // user explicitly asked to open it).
      this.focusExisting(target, existing, scope)
      return { kind: 'focused', tab: existing }
    }
    if (tabs.length >= SIDEBAR_MAX_TABS) return { kind: 'limit' }
    const nextTabs = created?.patch?.tabs !== undefined
      ? [...created.patch.tabs]
      : [...tabs, tab]
    const nextActive = created?.patch?.activeId !== undefined
      ? created.patch.activeId
      : tab.id
    this.writeTarget(target, nextTabs, nextActive)
    // The callback scope carries the caller's explicit scope or the target
    // workspace (project cwd).
    const callbackScope: CapabilitiesScope = scope ?? { cwd: target.cwd }
    safeCall(() => rail.onOpen?.(tab, callbackScope))
    return { kind: 'opened', tab }
  }

  closeTab(tabId: string, scope?: CapabilitiesScope): void {
    const target = this.targetOf(scope)
    if (target === null) return
    const tabs = [...this.workspaceOf(target.cwd).tabs]
    const index = tabs.findIndex(tab => tab.id === tabId)
    if (index === -1) return
    const closed = tabs[index]!
    const next = tabs.filter(tab => tab.id !== tabId)
    const activeId = this.workspaceOf(target.cwd).activeId === tabId
      ? next[Math.min(index, next.length - 1)]?.id ?? null
      : this.workspaceOf(target.cwd).activeId
    this.writeTarget(target, next, activeId)
    const descriptor = this.surfaces.get(closed.type)?.rail
    const callbackScope: CapabilitiesScope = scope ?? { cwd: target.cwd }
    safeCall(() => descriptor?.onClose?.(closed, callbackScope))
  }

  activateTab(tabId: string | null, scope?: CapabilitiesScope): void {
    const target = this.targetOf(scope)
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    if (tabId !== null && !workspace.tabs.some(tab => tab.id === tabId)) return
    if (workspace.activeId === tabId) return
    this.writeTarget(target, workspace.tabs, tabId)
    if (tabId !== null) {
      const activated = workspace.tabs.find(tab => tab.id === tabId)
      const descriptor = activated === undefined
        ? undefined
        : this.surfaces.get(activated.type)?.rail
      const callbackScope: CapabilitiesScope = scope ?? { cwd: target.cwd }
      safeCall(() => descriptor?.onActivate?.(activated!, callbackScope))
    }
  }

  updateTab(
    tabId: string,
    patch: { resource?: string; title?: string; meta?: unknown },
  ): void {
    const cwd = this.snapshot.cwd
    if (cwd === null) return
    let changed = false
    const tabs = this.workspaceOf(cwd).tabs.map(tab => {
      if (tab.id !== tabId) return tab
      changed = true
      return {
        ...tab,
        ...(patch.title !== undefined ? { title: patch.title.slice(0, 240) } : {}),
        ...(patch.resource !== undefined
          ? { resource: patch.resource.slice(0, 4096) }
          : {}),
        ...(patch.meta !== undefined ? { meta: patch.meta } : {}),
      }
    })
    if (changed) {
      this.writeTarget(
        { cwd, inactive: false },
        tabs,
        this.workspaceOf(cwd).activeId,
      )
    }
  }

  openFile(scope: CapabilitiesScope, path: string, title?: string): void {
    this.openTab({
      type: 'file',
      resource: path,
      title: title ?? basename(path),
      id: `file:${path}`,
    }, scope)
  }

  /* ── tab drag layout ─────────────────────────────────────────── */

  reorderTabs(sourceId: string, targetId: string | null | undefined, side: 'before' | 'after' = 'after'): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const nextTabs = reorderById(workspace.tabs, sourceId, targetId, side)
    this.writeTarget(target, nextTabs, workspace.activeId)
  }

  moveTab(tabId: string, toIndex: number): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const tabs = [...workspace.tabs]
    const index = tabs.findIndex(tab => tab.id === tabId)
    if (index === -1) return
    const clamped = clampIndex(toIndex, tabs.length)
    if (clamped === index) return
    const [moved] = tabs.splice(index, 1)
    tabs.splice(clamped, 0, moved!)
    this.writeTarget(target, tabs, workspace.activeId)
  }

  // The BOTTOM workbench methods are dormant contract — the workbench is
  // not mounted pending a product decision, so nothing calls these yet.
  // The service face matches `DesktopSidebarService`; wiring them up
  // (dock/drag/close UI) re-enables the capability without a contract
  // // change. `workspaceOf`/`writeTarget` already persist the bottom bucket.
  dockTabToBottom(tabId: string, targetId: string | null | undefined, side: 'before' | 'after' = 'after'): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const fromIndex = workspace.tabs.findIndex(tab => tab.id === tabId)
    if (fromIndex === -1) return

    const tabs = [...workspace.tabs]
    const [moved] = tabs.splice(fromIndex, 1)
    if (!moved) return

    const nextActive = workspace.activeId === tabId
      ? tabs[Math.min(fromIndex, tabs.length - 1)]?.id ?? null
      : workspace.activeId

    const bottomTabs = reorderById([...(workspace.bottomTabs ?? [])], moved.id, targetId, side)
    // If not inserted by reorderById (newly docked), place it
    if (!bottomTabs.some(t => t.id === moved.id)) {
      if (targetId) {
        const tIndex = bottomTabs.findIndex(t => t.id === targetId)
        const ins = side === 'before' ? (tIndex === -1 ? bottomTabs.length : tIndex) : (tIndex === -1 ? bottomTabs.length : tIndex + 1)
        bottomTabs.splice(ins, 0, moved)
      } else {
        bottomTabs.push(moved)
      }
    }

    this.writeTarget(target, tabs, nextActive, { tabs: bottomTabs, activeId: moved.id })
  }

  moveTabToBottom(tabId: string, toIndex?: number): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const tabs = [...workspace.tabs]
    const index = tabs.findIndex(tab => tab.id === tabId)
    if (index === -1) return
    const [moved] = tabs.splice(index, 1)
    if (moved === undefined) return
    // The rail activates the moved tab's neighbor when the mover was its
    // active tab.
    const nextActive = workspace.activeId === tabId
      ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null
      : workspace.activeId
    const bottomTabs = [...(workspace.bottomTabs ?? [])]
    const at = toIndex === undefined
      ? bottomTabs.length
      : clampIndex(toIndex, bottomTabs.length + 1)
    bottomTabs.splice(at, 0, moved)
    // The dropped tab becomes the workbench's active tab (the split
    // gesture lands the user on the moved content).
    this.writeTarget(target, tabs, nextActive, { tabs: bottomTabs, activeId: moved.id })
  }

  undockTabToSide(bottomTabId: string, targetId: string | null | undefined, side: 'before' | 'after' = 'after'): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const bottomTabs = [...(workspace.bottomTabs ?? [])]
    const fromIndex = bottomTabs.findIndex(tab => tab.id === bottomTabId)
    if (fromIndex === -1) return

    const [moved] = bottomTabs.splice(fromIndex, 1)
    if (!moved) return

    const nextBottomActive = workspace.bottomActiveId === bottomTabId
      ? bottomTabs[Math.min(fromIndex, bottomTabs.length - 1)]?.id ?? null
      : workspace.bottomActiveId

    const tabs = reorderById([...workspace.tabs], moved.id, targetId, side)
    if (!tabs.some(t => t.id === moved.id)) {
      if (targetId) {
        const tIndex = tabs.findIndex(t => t.id === targetId)
        const ins = side === 'before' ? (tIndex === -1 ? tabs.length : tIndex) : (tIndex === -1 ? tabs.length : tIndex + 1)
        tabs.splice(ins, 0, moved)
      } else {
        tabs.push(moved)
      }
    }

    this.writeTarget(target, tabs, moved.id, {
      tabs: bottomTabs,
      activeId: nextBottomActive ?? null,
    })
  }

  moveBottomTabToSide(bottomTabId: string, toIndex?: number): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const bottomTabs = [...(workspace.bottomTabs ?? [])]
    const index = bottomTabs.findIndex(tab => tab.id === bottomTabId)
    if (index === -1) return
    const [moved] = bottomTabs.splice(index, 1)
    if (moved === undefined) return
    const nextBottomActive = workspace.bottomActiveId === bottomTabId
      ? bottomTabs[Math.min(index, bottomTabs.length - 1)]?.id ?? null
      : workspace.bottomActiveId
    const tabs = [...workspace.tabs]
    const at = toIndex === undefined
      ? tabs.length
      : clampIndex(toIndex, tabs.length + 1)
    tabs.splice(at, 0, moved)
    // Undocking lands the user on the moved tab in the rail.
    this.writeTarget(target, tabs, moved.id, {
      tabs: bottomTabs,
      activeId: nextBottomActive ?? null,
    })
  }

  reorderBottomTabs(sourceId: string, targetId: string | null | undefined, side: 'before' | 'after' = 'after'): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const nextTabs = reorderById(workspace.bottomTabs ?? [], sourceId, targetId, side)
    this.writeTarget(target, workspace.tabs, workspace.activeId, {
      tabs: nextTabs,
      activeId: workspace.bottomActiveId ?? null,
    })
  }

  moveBottomTab(bottomTabId: string, toIndex: number): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const bottomTabs = [...(workspace.bottomTabs ?? [])]
    const index = bottomTabs.findIndex(tab => tab.id === bottomTabId)
    if (index === -1) return
    const clamped = clampIndex(toIndex, bottomTabs.length)
    if (clamped === index) return
    const [moved] = bottomTabs.splice(index, 1)
    bottomTabs.splice(clamped, 0, moved!)
    this.writeTarget(target, workspace.tabs, workspace.activeId, {
      tabs: bottomTabs,
      activeId: workspace.bottomActiveId ?? null,
    })
  }

  activateBottomTab(bottomTabId: string | null): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const bottomTabs = workspace.bottomTabs ?? []
    if (bottomTabId !== null
      && !bottomTabs.some(tab => tab.id === bottomTabId)) return
    if (workspace.bottomActiveId === bottomTabId) return
    this.writeTarget(target, workspace.tabs, workspace.activeId, {
      tabs: bottomTabs,
      activeId: bottomTabId,
    })
    if (bottomTabId !== null) {
      const activated = bottomTabs.find(tab => tab.id === bottomTabId)
      const descriptor = activated === undefined
        ? undefined
        : this.surfaces.get(activated.type)?.rail
      const callbackScope: CapabilitiesScope = { cwd: target.cwd }
      safeCall(() => descriptor?.onActivate?.(activated!, callbackScope))
    }
  }

  closeBottomTab(bottomTabId: string): void {
    const target = this.targetOf()
    if (target === null) return
    const workspace = this.workspaceOf(target.cwd)
    const bottomTabs = [...(workspace.bottomTabs ?? [])]
    const index = bottomTabs.findIndex(tab => tab.id === bottomTabId)
    if (index === -1) return
    const closed = bottomTabs[index]!
    const next = bottomTabs.filter(tab => tab.id !== bottomTabId)
    const nextActive = workspace.bottomActiveId === bottomTabId
      ? next[Math.min(index, next.length - 1)]?.id ?? null
      : workspace.bottomActiveId
    this.writeTarget(target, workspace.tabs, workspace.activeId, {
      tabs: next,
      activeId: nextActive ?? null,
    })
    const descriptor = this.surfaces.get(closed.type)?.rail
    const callbackScope: CapabilitiesScope = { cwd: target.cwd }
    safeCall(() => descriptor?.onClose?.(closed, callbackScope))
  }

  setOpen(open: boolean): void {
    if (this.snapshot.open === open) return
    this.publish({
      ...this.snapshot,
      maximized: open ? this.snapshot.maximized : false,
      open,
      revision: this.snapshot.revision + 1,
    })
  }

  setMaximized(maximized: boolean): void {
    if (!this.snapshot.open || this.snapshot.maximized === maximized) return
    this.publish({
      ...this.snapshot,
      maximized,
      revision: this.snapshot.revision + 1,
    })
  }

  setWidth(width: number): void {
    const next = clampSidebarWidth(width, currentViewportWidth())
    if (this.snapshot.width === next) return
    if (this.snapshot.cwd !== null) {
      // Remember per workspace bucket; `defaultWidth` stays the fallback for
      // projects (and buckets) without a remembered width. A project whose
      // bucket does not exist yet gets one — a width-only touch must survive
      // project switches.
      const key = this.layoutKey(this.snapshot.cwd)
      const workspace = this.preferences.workspaces[key]
      this.preferences.workspaces[key] = {
        ...(workspace ?? { activeId: null, tabs: [] }),
        lastUsed: Date.now(),
        width: next,
        tabs: (workspace?.tabs ?? []).map(tab => ({ ...tab })),
      }
      this.schedulePersist()
    } else {
      this.preferences.defaultWidth = next
    }
    this.publish({ ...this.snapshot, width: next, revision: this.snapshot.revision + 1 })
  }
  setCenterPreviewTabs(mode: PreviewTabsMode): void {
    if (this.preferences.centerPreviewTabs === mode) return
    this.preferences.centerPreviewTabs = mode
    this.publish({
      ...this.snapshot,
      centerPreviewTabs: mode,
      revision: this.snapshot.revision + 1,
    })
    this.schedulePersist()
  }
  setLayoutScope(mode: LayoutScopeMode): void {
    if (this.preferences.layoutScope === mode) return
    const previousKey = this.layoutKey(this.snapshot.cwd ?? '')
    this.preferences.layoutScope = mode
    const nextKey = this.layoutKey(this.snapshot.cwd ?? '')
    // Adoption on switch: carry the CURRENT layout into the destination
    // bucket when that bucket is empty, so a user switching scope keeps the
    // layout they are looking at instead of losing it. An existing
    // destination always wins — adoption never overwrites.
    if (
      this.snapshot.cwd !== null && previousKey !== nextKey
      && !this.bucketHasLayout(nextKey) && this.bucketHasLayout(previousKey)
    ) {
      this.preferences.workspaces[nextKey] = cloneWorkspace(
        this.preferences.workspaces[previousKey]!,
      )
    }
    this.publish({
      ...this.snapshot,
      layoutScope: mode,
      // Re-scope immediately: the newly selected layout takes over the rail.
      ...this.workspaceSnapshot(this.snapshot.cwd),
      revision: this.snapshot.revision + 1,
    })
    this.schedulePersist()
  }

  /** Whether a persisted bucket holds any tab state worth adopting. */
  private bucketHasLayout(key: string): boolean {
    return (this.preferences.workspaces[key]?.tabs.length ?? 0) > 0
  }

  setOpenByDefault(open: boolean): void {
    if (this.preferences.openByDefault === open) return
    this.preferences.openByDefault = open
    this.publish({
      ...this.snapshot,
      openByDefault: open,
      revision: this.snapshot.revision + 1,
    })
    this.schedulePersist()
  }

  setTabEnabled(id: string, enabled: boolean): void {
    if (this.isTabEnabled(id) === enabled && Object.hasOwn(this.tabsEnabled, id)) return
    this.tabsEnabled = { ...this.tabsEnabled, [id]: enabled }
    this.publish({
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      tabsEnabled: { ...this.tabsEnabled },
    })
    this.publishFeatureEnablement()
  }

  setViewerEnabled(id: string, enabled: boolean): void {
    if (this.isViewerEnabled(id) === enabled && Object.hasOwn(this.viewersEnabled, id)) return
    this.viewersEnabled = { ...this.viewersEnabled, [id]: enabled }
    this.publish({
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      viewersEnabled: { ...this.viewersEnabled },
    })
    this.publishFeatureEnablement()
  }

  private publishFeatureEnablement(): void {
    this.onFeatureEnablementChange?.({
      tabsEnabled: { ...this.tabsEnabled },
      viewersEnabled: { ...this.viewersEnabled },
    })
  }

  async settle(): Promise<void> {
    await this.persist.flush()
  }

  /** The target workspace of an operation: the explicit scope or the active
   *  project. Null while no project is bound (or the service is not ready). */
  private targetOf(scope?: CapabilitiesScope): WorkspaceTarget | null {
    if (!this.snapshot.ready) return null
    const cwd = scope?.cwd ?? this.snapshot.cwd ?? (process.env.PWD || process.cwd?.() || '/')
    return {
      cwd,
      inactive: scope !== undefined && scope.cwd !== this.snapshot.cwd,
    }
  }

  /** A shallow copy of the pluginSettings map (blobs are immutable). */
  private pluginSettingsSnapshot(): Readonly<Record<string, Record<string, unknown>>> {
    return Object.fromEntries(
      Object.entries(this.preferences.pluginSettings).map(
        ([id, blob]) => [id, { ...blob }],
      ),
    )
  }

  /**
   * The persisted-bucket key for a workspace's rail layout (A2/D5a):
   * `workspace` scope buckets by cwd, `global` collapses onto one bucket so
   * every project shares a single rail layout and remembered width.
   */
  private layoutKey(cwd: string): string {
    return this.preferences.layoutScope === 'global' ? GLOBAL_SCOPE_BUCKET : cwd
  }

  /**
   * The rail width for a project (falls back to the default), clamped to the
   * LIVE viewport cap. The persisted bucket keeps its raw document-bounded
   * value, so a width saved on a larger display comes back when the window
   * grows again.
   */
  private layoutWidth(cwd: string | null): number {
    return clampSidebarWidth(
      cwd === null
        ? this.preferences.defaultWidth
        : this.preferences.workspaces[this.layoutKey(cwd)]?.width
          ?? this.preferences.defaultWidth,
      currentViewportWidth(),
    )
  }

  private workspaceOf(cwd: string): PersistedWorkspaceLayout {
    return this.preferences.workspaces[this.layoutKey(cwd)] ?? {
      activeId: null,
      lastUsed: 0,
      tabs: [],
    }
  }

  private writeTarget(
    target: WorkspaceTarget,
    tabs: readonly SidebarTab[],
    activeId: string | null,
    bottom?: {
      tabs?: readonly SidebarTab[]
      activeId?: string | null
    },
  ): void {
    const workspace = this.workspaceOf(target.cwd)
    const bottomTabs = bottom?.tabs ?? workspace.bottomTabs ?? []
    const bottomActiveId = bottom?.activeId !== undefined
      ? bottom.activeId
      : workspace.bottomActiveId ?? null
    this.preferences.workspaces[this.layoutKey(target.cwd)] = {
      activeId,
      lastUsed: Date.now(),
      tabs: tabs.map(tab => ({ ...tab })),
      bottomTabs: bottomTabs.map(tab => ({ ...tab })),
      ...(bottomActiveId === null ? {} : { bottomActiveId }),
    }
    this.pruneWorkspaces()
    this.schedulePersist()
    if (!target.inactive) {
      this.publish({
        ...this.snapshot,
        activeId,
        bottomActiveId,
        bottomTabs: bottomTabs.map(tab => ({ ...tab })),
        revision: this.snapshot.revision + 1,
        tabs: tabs.map(tab => ({ ...tab })),
      })
    }
  }

  /** Focus an existing tab through the service path (fires onActivate). A
   *  focus of the already-active tab still fires the callback — the user
   *  explicitly asked to open it. */
  private focusExisting(
    target: WorkspaceTarget,
    tab: SidebarTab,
    scope?: CapabilitiesScope,
  ): void {
    const workspace = this.workspaceOf(target.cwd)
    if (workspace.activeId !== tab.id) {
      this.writeTarget(target, workspace.tabs, tab.id)
    }
    const descriptor = this.surfaces.get(tab.type)?.rail
    const callbackScope: CapabilitiesScope = scope ?? { cwd: target.cwd }
    safeCall(() => descriptor?.onActivate?.(tab, callbackScope))
  }

  private workspaceSnapshot(cwd: string | null): Pick<
    SidebarSnapshot,
    'activeId' | 'bottomActiveId' | 'bottomTabs' | 'tabs' | 'width'
  > {
    const workspace = cwd === null
      ? undefined
      : this.preferences.workspaces[this.layoutKey(cwd)]
    return {
      activeId: workspace?.activeId ?? null,
      bottomActiveId: workspace?.bottomActiveId ?? null,
      bottomTabs: workspace?.bottomTabs?.map(tab => ({ ...tab })) ?? [],
      tabs: workspace?.tabs.map(tab => ({ ...tab })) ?? [],
      // The rail width is remembered per workspace bucket, live-clamped.
      width: this.layoutWidth(cwd),
    }
  }

  private pruneWorkspaces(): void {
    const entries = Object.entries(this.preferences.workspaces)
    if (entries.length <= SIDEBAR_MAX_WORKSPACES) return
    entries.sort((left, right) => right[1].lastUsed - left[1].lastUsed)
    this.preferences.workspaces = Object.fromEntries(
      entries.slice(0, SIDEBAR_MAX_WORKSPACES),
    )
  }

  private touch(): void {
    this.publish({ ...this.snapshot, revision: this.snapshot.revision + 1 })
  }

  private publish(snapshot: SidebarSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }

  private schedulePersist(): void {
    if (!this.snapshot.ready || this.disposed) return
    this.persist.fire()
  }
}
