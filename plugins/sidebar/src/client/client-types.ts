/**
 * Shared structural client types of the sidebar client plugin
 * (extracted from the former single-file plugin.tsx so the panel, settings,
 * interceptors, and the plugin assembly each import what they need).
 */
import type { DesktopBridge } from '../../../shared/desktop-contracts.ts'
import type { Translate } from '../../../shared/i18n.ts'
import type { ReviewSessionsService } from './review/review-comments.ts'
import type { SidebarRuntimeSettingsService } from './runtime-settings.ts'
import type { DesktopSidebar } from './sidebar-service.ts'
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
}

export interface SessionListState {
  current?: string
  byId: Record<string, SessionSummary>
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
}

export interface BoundSidebarSettingsActions {
  sync(
    openByDefault: boolean,
    revision: number,
    tabsEnabled: Record<string, boolean>,
    viewersEnabled: Record<string, boolean>,
    width: number,
  ): void
}

export interface SidebarSettingsProps {
  reset(): void
  setOpenByDefault(open: boolean): void
  setTabEnabled(id: string, enabled: boolean): void
  setViewerEnabled(id: string, enabled: boolean): void
  setWidth(width: number): void
  runtime: SidebarRuntimeSettingsService
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  useStore<T>(selector: (state: SidebarSettingsState) => T): T
}

export interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(actions: BoundSidebarSettingsActions): Omit<
      SidebarSettingsProps,
      't' | 'useStore'
    >
    locale: string
    label: () => string
    name: string
    order: number
    store: unknown
  }, component: (props: SidebarSettingsProps) => JSX.Element): unknown
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
  /** The tab/viewer registry (open file tabs from list previews). */
  sidebar: DesktopSidebar
}

export const EMPTY_CONVERSATION: ConversationSnapshot = { runningCalls: [] }
