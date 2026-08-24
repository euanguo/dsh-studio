/**
 * The desktop sidebar registry service: tabs, file viewers, center-surface
 * renderers and plugin-owned settings, plus the per-session open-tab state.
 *
 * The public contract lives in `./contract.ts` (descriptor vocabulary +
 * service face, shared with the settings seam, the built-in registrations
 * and external consumer plugins). This module implements it.
 *
 * Design notes:
 * - The registry is synchronous-snapshot (Map + listener set) so React can
 *   read it through `useSyncExternalStore` without tearing.
 * - `dedupeKey` unifies the open-tab strategies: single-instance
 *   (`single: true` ≡ `() => id`), per-resource (`tab => tab.resource`) and
 *   per-id. `createTab` lets a descriptor own tab instantiation and state
 *   patching.
 * - `matchViewer` walks descriptors in priority order (desc, stable): per
 *   descriptor it tries `detect` first (when `head` bytes are given), then
 *   `exts`; `exts: []` is a catch-all.
 * - Lifecycle callbacks (onOpen/onActivate/onClose) fire from the SERVICE
 *   paths only; a throwing callback is logged and never breaks the flow.
 * - State is persisted per session (tabs layout) plus the enable maps and
 *   the pluginSettings blobs; writes are throttled through one flush queue.
 */
import type { ReactNode } from 'react'
import { basename } from '@dsh-studio/shared/path'
import type { CenterSurface, CenterSurfaceKind } from './surfaces/types.ts'
import type { PreviewTabsMode } from '@dsh-studio/shared/workbench-contracts'
import type { LayoutScopeMode } from '../sidebar-preferences.ts'
import { GLOBAL_SCOPE_BUCKET } from '@dsh-studio/shared/workbench-contracts'
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_MAX_TABS,
  SIDEBAR_MAX_WORKSPACES,
  type DesktopSidebarPreferences,
  type PersistedSidebarTab,
  type PersistedWorkspaceLayout,
} from '../sidebar-preferences.ts'
import type { SidebarPreferencesStorage } from './sidebar-storage.ts'
import {
  SIDEBAR_FEATURES,
  SIDEBAR_SERVICE_VERSION,
  tabAvailability,
  type DesktopSidebarService as DesktopSidebarServiceContract,
  type OpenTabResult,
  type CapabilitiesScope,
  type SidebarSnapshot,
  type SidebarTab,
  type SidebarTabDescriptor,
  type SidebarTabSeed,
  type SidebarViewerDescriptor,
} from './contract.ts'
import { reorderById } from './tab-drag.ts'

export type {
  OpenTabResult,
  SidebarFeature,
  SidebarFileFetchStrategy,
  SidebarRenderProps,
  CapabilitiesScope,
  SidebarSettingToggle,
  SidebarSettingToggleType,
  SidebarSettingsDeclaration,
  SidebarSettingsRenderProps,
  SidebarSnapshot,
  SidebarSurfaceRenderer,
  SidebarTab,
  SidebarTabDescriptor,
  SidebarTabSeed,
  SidebarViewerDescriptor,
  SidebarViewerRenderInput,
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

function titleOf(descriptor: SidebarTabDescriptor): string {
  return typeof descriptor.title === 'function'
    ? descriptor.title()
    : descriptor.title
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    defaultWidth: clampSidebarWidth(preferences.defaultWidth),
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
  private readonly tabDescriptors = new Map<string, SidebarTabDescriptor>()
  private readonly viewerDescriptors = new Map<string, SidebarViewerDescriptor>()
  private readonly surfaceRenderers = new Map<CenterSurfaceKind, (surface: CenterSurface) => ReactNode>()
  private preferences = freshPreferences()
  private dirty = false
  private disposed = false
  private flushing: Promise<void> | undefined
  private instance = 0
  private readonly storage: SidebarPreferencesStorage
  private readonly onFeatureEnablementChange: ((next: {
    tabsEnabled: Record<string, boolean>
    viewersEnabled: Record<string, boolean>
  }) => void) | undefined
  private tabsEnabled: Record<string, boolean> = {}
  private viewersEnabled: Record<string, boolean> = {}
  private snapshot: SidebarSnapshot = {
    activeId: null,
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
    onFeatureEnablementChange?: (next: {
      tabsEnabled: Record<string, boolean>
      viewersEnabled: Record<string, boolean>
    }) => void,
  ) {
    this.storage = storage
    this.onFeatureEnablementChange = onFeatureEnablementChange
  }

  getSnapshot = (): SidebarSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(): Promise<void> {
    const requestedCwd = this.snapshot.cwd
    try {
      this.preferences = clonePreferences(await this.storage.load())
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
    this.listeners.clear()
  }

  registerTab(descriptor: SidebarTabDescriptor): () => void {
    if (this.tabDescriptors.has(descriptor.id)) {
      throw new Error(`sidebar: duplicate tab "${descriptor.id}"`)
    }
    this.tabDescriptors.set(descriptor.id, descriptor)
    this.touch()
    return () => {
      if (this.tabDescriptors.get(descriptor.id) === descriptor) {
        this.tabDescriptors.delete(descriptor.id)
        this.touch()
      }
    }
  }

  registerViewer(descriptor: SidebarViewerDescriptor): () => void {
    if (this.viewerDescriptors.has(descriptor.id)) {
      throw new Error(`sidebar: duplicate viewer "${descriptor.id}"`)
    }
    this.viewerDescriptors.set(descriptor.id, descriptor)
    this.touch()
    return () => {
      if (this.viewerDescriptors.get(descriptor.id) === descriptor) {
        this.viewerDescriptors.delete(descriptor.id)
        this.touch()
      }
    }
  }

  registerSurfaceRenderer(
    kind: CenterSurfaceKind,
    renderer: (surface: CenterSurface) => ReactNode,
  ): () => void {
    if (this.surfaceRenderers.has(kind)) {
      throw new Error(`sidebar: duplicate surface renderer "${kind}"`)
    }
    this.surfaceRenderers.set(kind, renderer)
    this.touch()
    return () => {
      if (this.surfaceRenderers.get(kind) === renderer) {
        this.surfaceRenderers.delete(kind)
        this.touch()
      }
    }
  }

  renderSurface(surface: CenterSurface): ReactNode {
    const renderer = this.surfaceRenderers.get(surface.kind)
    return renderer === undefined ? null : renderer(surface)
  }

  getTabs(): readonly SidebarTabDescriptor[] {
    return [...this.tabDescriptors.values()].sort(
      (left, right) => (left.order ?? 100) - (right.order ?? 100),
    )
  }

  getViewers(): readonly SidebarViewerDescriptor[] {
    return [...this.viewerDescriptors.values()].sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
    )
  }

  getTab(id: string): SidebarTabDescriptor | undefined {
    return this.tabDescriptors.get(id)
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
  ): SidebarViewerDescriptor | undefined {
    const extension = extensionOf(path)
    for (const viewer of this.getViewers()) {
      if (!this.isViewerEnabled(viewer.id)) continue
      if (head !== undefined && viewer.detect !== undefined) {
        if (viewer.detect(path, head)) return viewer
        // A catch-all with detect is SNIFF-ONLY: it must not blind-claim
        // paths it never sniffed.
        if (viewer.exts.length === 0) continue
      } else if (viewer.exts.length === 0) {
        // Blind catch-all (no detect) claims anything; a sniff-only
        // catch-all (detect defined, no head yet) yields this round.
        if (viewer.detect === undefined) return viewer
        continue
      }
      if (viewer.exts.map(value => value.toLowerCase()).includes(extension)) {
        return viewer
      }
    }
    return undefined
  }

  resolveUrlTarget(url: URL): SidebarTabDescriptor | undefined {
    // Registration order wins (Map iteration is insertion order); a
    // disabled tab type is skipped; a throwing predicate is swallowed.
    for (const descriptor of this.tabDescriptors.values()) {
      if (descriptor.urlTarget === undefined) continue
      if (!this.isTabEnabled(descriptor.id)) continue
      let claimed = false
      try {
        claimed = descriptor.urlTarget(url) === true
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
    const descriptor = this.tabDescriptors.get(seed.type)
    if (descriptor === undefined) return { kind: 'missing' }
    // ONE availability gate: folds `requiresWorkspace`, `available` and the
    // enable map into a single answer, so `openTab` and every UI entry point
    // agree on whether (and why) a tab can open right now.
    const availability = tabAvailability(descriptor, { cwd: target.cwd }, this.snapshot, this.isTabEnabled(seed.type))
    if (!availability.ok) return { kind: 'disabled', reason: availability.reason }
    const tabs = [...this.workspaceOf(target.cwd).tabs]
    // Action-only descriptors run instead of opening a tab.
    if (descriptor.action !== undefined && descriptor.render === undefined) {
      void descriptor.action()
      return { kind: 'focused', tab: {
        id: descriptor.id,
        type: descriptor.id,
        title: titleOf(descriptor),
      } }
    }
    const created = descriptor.createTab?.(seed, tabs)
    if (created === null) return { kind: 'disabled' }
    const tab = created?.tab ?? {
      id: seed.id ?? (descriptor.single === true
        ? descriptor.id
        : `${descriptor.id}:${String(Date.now())}:${String(++this.instance)}`),
      type: descriptor.id,
      title: seed.title ?? titleOf(descriptor),
      ...(seed.resource !== undefined ? { resource: seed.resource } : {}),
      ...(seed.meta !== undefined ? { meta: seed.meta } : {}),
    }
    const key = descriptor.dedupeKey?.(tab)
      ?? (descriptor.single === true ? descriptor.id : undefined)
    const existing = tabs.find(candidate => {
      if (candidate.id === tab.id) return true
      if (candidate.type !== tab.type || key === undefined) return false
      const candidateKey = descriptor.dedupeKey?.(candidate)
        ?? (descriptor.single === true ? descriptor.id : undefined)
      return candidateKey === key
    })
    if (existing !== undefined) {
      // A dedupe/id-safety-net focus is an ACTIVATION, not an open — it
      // fires onActivate even when the tab is already the active one (the
      // user explicitly asked to open it).
      this.focusExisting(target, existing, scope)
      return { kind: 'focused', tab: existing }
    }
    // The bottom workbench holds the same tab vocabulary: a dedupe hit
    // there focuses the DOCKED tab (the pane shows it without duplicating).
    const bottomTabs = this.workspaceOf(target.cwd).bottomTabs ?? []
    const docked = bottomTabs.find(candidate => {
      if (candidate.id === tab.id) return true
      if (candidate.type !== tab.type || key === undefined) return false
      const candidateKey = descriptor.dedupeKey?.(candidate)
        ?? (descriptor.single === true ? descriptor.id : undefined)
      return candidateKey === key
    })
    if (docked !== undefined) {
      this.writeTarget(
        target,
        tabs,
        this.workspaceOf(target.cwd).activeId,
        { activeId: docked.id },
      )
      safeCall(() => descriptor.onActivate?.(docked, scope ?? {
        cwd: target.cwd,
      }))
      return { kind: 'focused', tab: docked }
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
    safeCall(() => descriptor.onOpen?.(tab, callbackScope))
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
    const descriptor = this.tabDescriptors.get(closed.type)
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
        : this.tabDescriptors.get(activated.type)
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

  /* ── bottom workbench + tab drag layout ─────────────────────── */

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
        : this.tabDescriptors.get(activated.type)
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
    const descriptor = this.tabDescriptors.get(closed.type)
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
    const next = clampSidebarWidth(width)
    if (this.snapshot.width === next) return
    if (this.snapshot.cwd !== null) {
      // Remember per workspace bucket; `defaultWidth` stays the fallback for
      // projects (and buckets) without a remembered width. A project whose
      // bucket does not exist yet gets one — a width-only touch must survive
      // project switches.
      const key = this.layoutKey(this.snapshot.cwd)
      const workspace = this.preferences.workspaces[key]
      this.preferences.workspaces[key] = {
        ...(workspace ?? { activeId: null, tabs: [], bottomTabs: [], bottomActiveId: null }),
        lastUsed: Date.now(),
        width: next,
        tabs: (workspace?.tabs ?? []).map(tab => ({ ...tab })),
        bottomTabs: (workspace?.bottomTabs ?? []).map(tab => ({ ...tab })),
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
    await this.flushing
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

  /** The remembered rail width for a project (falls back to the default). */
  private layoutWidth(cwd: string | null): number {
    if (cwd === null) return this.preferences.defaultWidth
    return this.preferences.workspaces[this.layoutKey(cwd)]?.width
      ?? this.preferences.defaultWidth
  }

  private workspaceOf(cwd: string): PersistedWorkspaceLayout {
    return this.preferences.workspaces[this.layoutKey(cwd)] ?? {
      activeId: null,
      lastUsed: 0,
      tabs: [],
      bottomTabs: [],
      bottomActiveId: null,
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
    const descriptor = this.tabDescriptors.get(tab.type)
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
      // The rail width is remembered per workspace bucket.
      width: workspace?.width ?? this.preferences.defaultWidth,
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
    this.dirty = true
    if (this.flushing === undefined) {
      this.flushing = this.flush().finally(() => { this.flushing = undefined })
      void this.flushing.catch(error => {
        this.publish({
          ...this.snapshot,
          error: messageOf(error),
          revision: this.snapshot.revision + 1,
        })
      })
    }
  }

  private async flush(): Promise<void> {
    await Promise.resolve()
    while (this.dirty && !this.disposed) {
      this.dirty = false
      await this.storage.save(clonePreferences(this.preferences))
    }
  }
}
