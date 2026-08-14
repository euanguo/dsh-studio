/**
 * Minimal type shims for the official client packages consumed by the forked
 * ui-workspace code. These packages are NOT resolvable from npm in this
 * workspace: at runtime the official web bundle provides them through the
 * client module loader (externalized), and here we declare just the surface
 * the fork touches. Types are intentionally loose — they gate compilation
 * only; runtime behavior comes from the official modules.
 */

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export type SessionId = string
  export type WorkspaceId = string

  export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

  export interface SubagentDescendantSummary {
    id: SessionId
    running: boolean
    runningCount: number
    completed: boolean
  }

  export interface SessionSummary {
    id: SessionId
    title: string
    displayTitle: string
    origin?: 'main' | 'subagent' | string
    cwd?: string
    blank: boolean
    updatedAt: number
    running: boolean
    runningSubagentCount: number
    completed: boolean
    pendingInteraction?: PendingInteractionStatus
    archived?: boolean
  }

  export interface SessionListState {
    phase: 'loading' | 'ready' | string
    current: SessionId | undefined
    byId: Record<SessionId, SessionSummary>
    ids: SessionId[]
    order: SessionId[]
    archived: ReadonlySet<SessionId>
  }

  export interface SessionSearchResultItem {
    id: SessionId
    sessionId: SessionId
    title: string
    updatedAt: number
    cwd?: string
    snippet?: string
  }

  export interface DirectoryEntry {
    name: string
    path: string
    isDir: boolean
    hidden?: boolean
  }

  export interface DirectoryListing {
    path: string
    entries: DirectoryEntry[]
    truncated?: boolean
  }

  export interface WorkspaceView {
    workspaceId: WorkspaceId
    cwd: string
    path: string
    title: string
    createdAt: string
    sessionIds: SessionId[]
  }

  export interface WorkspaceListState {
    phase: 'loading' | 'ready' | string
    items: WorkspaceView[]
    archivedSessionIds: readonly SessionId[]
  }

  export interface ObservableSnapshot<T> {
    subscribe(listener: () => void): () => void
    getSnapshot(): T
  }

  export interface IWorkspaces {
    list: ObservableSnapshot<WorkspaceListState>
    connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
    startSession(workspaceId?: WorkspaceId): void
    create(input: { path: string }): Promise<WorkspaceView>
    pickDirectory(): Promise<string | null>
    listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
    renameWorkspace(workspaceId: WorkspaceId, title: string): Promise<void>
    deleteWorkspace(workspaceId: WorkspaceId): Promise<void>
    rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
    delete(workspaceId: WorkspaceId): Promise<void>
    insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
    insertSessionBefore(
      workspaceId: WorkspaceId,
      sessionId: SessionId,
      beforeSessionId?: SessionId,
    ): Promise<void>
    archiveSession(sessionId: SessionId): Promise<void>
  }

  export interface EngineStoreHandle<State, Actions = Record<string, never>> {
    readonly __state?: State
    readonly __actions?: Actions
  }

  export interface EngineStoreInstance<State, Actions = Record<string, never>>
    extends EngineStoreHandle<State, Actions> {
    subscribe(listener: () => void): () => void
    getSnapshot(): State
    setState(state: State): void
  }

  export function defineStore<State, Actions = unknown>(
    definition: {
      init: () => State
      persist?: string
      actions: Actions
    },
  ): EngineStoreHandle<State, Actions>

  export function indexSubagentDescendants(
    sessions: Record<SessionId, SessionSummary>,
  ): ReadonlyMap<SessionId, SubagentDescendantSummary>

  export interface ClientSessionFace {
    rename(title: string): Promise<{ ok: true } | { ok: false; error: { message: string } }>
  }

  export interface SessionBinding {
    session?: ClientSessionFace
  }

  export interface SessionsService {
    search(query: string, signal: AbortSignal): Promise<
      { ok: true; value: { items: readonly SessionSearchResultItem[]; hasMore: boolean } }
      | { ok: false; error: { message: string } }
    >
    searchResultLimit: number
    open(sessionId: SessionId): void
    binding(sessionId: SessionId): SessionBinding | undefined
    fork(input: { sessionId: SessionId; increaseTitle: boolean }): Promise<SessionId>
  }

  export interface ClientContext {
    effect(fn: () => void, label: string): void
    locale: { register(ns: string, dicts: Record<string, Record<string, string>>): void }
    slots: {
      entries(hole: string): unknown[]
      subscribe(hole: string, listener: () => void): () => void
      inject(name: string, register: () => unknown): void
      register(options: unknown, component: unknown): unknown
    }
    sessions: SessionsService
    workspaces: IWorkspaces
    [key: string]: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type Translate<K extends string = string> = (
    key: K,
    params?: Record<string, unknown>,
  ) => string

  export type SnapshotSelectorHook<T, R = T> = (selector: (state: T) => R) => R
  export type MaybeSnapshotSelectorHook<T, R = T> = SnapshotSelectorHook<T, R> | undefined

  export interface HostObservable<T> {
    subscribe(listener: () => void): () => void
    getSnapshot(): T
  }

  /** Composed owner/scope props for a slot registration (loose: the SlotMap
   *  merge comes from the forking package's own declare module). */
  export type PropsRuntime<K extends string> = Record<string, unknown> & {
    renderSlot: (name: string, owner?: unknown) => import('react').ReactNode
    useStore: <R>(selector: (state: any) => R) => R
    useSessions: <R>(selector: (state: any) => R) => R
    useWorkspaces: <R>(selector: (state: any) => R) => R
    useLocale: (ns: string) => Translate
    sessionId?: string
  }

  export type PropsRenderSlots<S extends string> = Record<S, unknown>
  export type PropsStore<H> = {
    useStore: <R>(selector: (state: any) => R) => R
    actions: H extends EngineStoreHandle<infer _S, infer A> ? A : never
  }
  export type PropsLocale<NS extends string = string> = { t: Translate }

  export function useLocale(ns: string): Translate
  export function useStore<R>(selector: (state: unknown) => R): R
  export function useSessions<R>(selector: (state: unknown) => R): R
  export function useWorkspaces<R>(selector: (state: unknown) => R): R
  export function renderSlot<N extends keyof SlotMap & string>(
    name: N,
    owner?: unknown,
  ): import('react').ReactNode
}

declare module '@deepseek-ai/dsh-client-locale/client' {
  export interface LocaleMessages<K extends string = string> {
    [key: string]: string
  }
}

declare module '@deepseek-ai/dsh-client-ui-sidebar/client' {
  export interface SidebarSectionOwnerProps {
    wide: boolean
    expandSidebar(): void
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  export {}
}
