/**
 * Shared structural client types of the sidebar client plugin
 * (extracted from the former single-file plugin.tsx so the panel, settings,
 * interceptors, and the plugin assembly each import what they need).
 */
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { ReviewSessionsService } from './review/review-comments.ts'
import type { SidebarRuntimeSettingsService } from './runtime-settings.ts'
import type { DesktopSidebarService } from './contract.ts'
import type { WorkspaceMessage } from './i18n.ts'

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface SessionSummary {
  blank?: boolean
  cwd?: string
  /** Latest durable log-backed title, absent until the host projects one. */
  title?: string
  /** Human-facing label: durable title, project basename, then session id. */
  displayTitle?: string
  /** Durable direct parent session id (present on subagent children). */
  parentId?: string
  /** Coarse durable origin for navigation filtering (subagent children). */
  origin?: 'subagent'
  /** Whether the session's agent is currently running. */
  running?: boolean
}

/** One healthy subagent catalog child row (structural mirror of the host). */
export interface SubagentChildEntry {
  kind: 'child'
  id: string
  activity: 'running' | 'inactive'
  hasChildren: boolean
  mode: 'one-shot' | 'continuable'
  label?: string
}

/** The per-parent lazy catalog delivered through the sessions list feed. */
export interface SubagentCatalog {
  entries: Array<SubagentChildEntry | { kind: 'diagnostic'; id: string; reason: string }>
  parentAvailable: boolean
  state: 'loading' | 'ready' | 'error'
  error: { code?: string; message?: string } | null
}

/** One background job as the client mirror sees it (wire `JobView` shape). */
export interface SidebarJobView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

export interface SessionListState {
  current?: string
  byId: Record<string, SessionSummary>
  /**
   * Direct subagent catalogs keyed by their selected parent address
   * (absent on runtime snapshots without the mirror — the panel degrades
   * to the jobs list).
   */
  subagentsByParent?: Readonly<Record<string, SubagentCatalog>>
  /**
   * Background jobs per session, last-wins from the harness's
   * `session/jobs` push (a missing key is an empty set).
   */
  jobsBySession?: Readonly<Record<string, readonly SidebarJobView[]>>
}

export interface RunningToolCall {
  callId: string
  name: string
  argsRaw: string
  subCalls?: readonly RunningToolCall[]
}

export interface ConversationSnapshot {
  runningCalls?: readonly RunningToolCall[]
}

export interface SessionBinding {
  session: ObservableSnapshot<ConversationSnapshot>
}

export interface SessionsService extends ReviewSessionsService {
  list: ObservableSnapshot<SessionListState>
  binding(id: string): SessionBinding | undefined
  fork(options: { sessionId: string; increaseTitle?: boolean }): Promise<string>
  open(id: string): void
  /** Open a healthy catalog child through its exact direct-parent address. */
  setSubagentCatalogOpen?(parentSessionId: string, open: boolean): void
  /** Resolve an already discovered direct-parent address without opening it. */
  refreshSubagents?(parentSessionId: string): Promise<void>
}

export interface WorkspaceView {
  workspaceId: string
}

export interface WorkspacesService {
  create(input: { path: string }): Promise<WorkspaceView>
  openPath(path: string): Promise<void>
  startSession(workspaceId?: string): void
}

export interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

export interface SidebarSettingsState {
  openByDefault: boolean
  revision: number
  tabsEnabled: Record<string, boolean>
  viewersEnabled: Record<string, boolean>
  width: number
  /** Plugin-owned settings blobs keyed by descriptor id (mirrors the prefs). */
  pluginSettings: Record<string, Record<string, unknown>>
}

export interface BoundSidebarSettingsActions {
  sync(
    openByDefault: boolean,
    revision: number,
    tabsEnabled: Record<string, boolean>,
    viewersEnabled: Record<string, boolean>,
    width: number,
    pluginSettings: Record<string, Record<string, unknown>>,
  ): void
}

export interface SidebarSettingsProps {
  reset(): void
  setOpenByDefault(open: boolean): void
  setTabEnabled(id: string, enabled: boolean): void
  setViewerEnabled(id: string, enabled: boolean): void
  setWidth(width: number): void
  updatePluginSetting(id: string, key: string, value: unknown): void
  runtime: SidebarRuntimeSettingsService
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  useStore<T>(selector: (state: SidebarSettingsState) => T): T
}

export interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(actions: BoundSidebarSettingsActions): Omit<SidebarSettingsProps, 't' | 'useStore'>
    locale: string
    label: () => string
    name: string
    order: number
    store: unknown
  }, component: (props: SidebarSettingsProps) => JSX.Element): unknown
  register<P>(options: {
    id: string
    inject?: (...args: never[]) => P
    locale: string
    label: () => string
    name: string
    order: number
    store?: unknown
  }, component: (props: P) => JSX.Element): unknown
}

export interface WorkspaceToolsState {
  maximized: boolean
  open: boolean
  view: string
  width: number
}

export interface WorkspaceTools {
  getSnapshot(): WorkspaceToolsState
  subscribe(listener: () => void): () => void
  isOpen(): boolean
  openBrowser(): void
  openBrowserUrl(url: string): void
  openFile(path: string): void
  openFiles(): void
  openMenu(): void
  openReview(): void
  openSideChat(): Promise<void>
  openTrajectory(): void
  setOpen(open: boolean): void
  toggle(): void
  togglePanelMaximized(): void
  toggleSidePanel(): void
  /** Live drag preview — DOM-only, never touches the store/persist/claims. */
  previewResizeWidth(width: number): void
  /** End of a drag — commits the width through the store. */
  commitResizeWidth(width: number): void
  /** The tab/viewer registry service (open file tabs from list previews). */
  sidebar: DesktopSidebarService
}

export const EMPTY_CONVERSATION: ConversationSnapshot = { runningCalls: [] }
