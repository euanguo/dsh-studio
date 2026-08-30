/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 *
 * The handle is built on the shared/runtime family (RevisionedStore) instead
 * of the dsh-client-runtime engine slice: same spec + baked-actions
 * contract the slots engine consumes, but the state source lives in this
 * repository's runtime layer and persistence stays in this plugin's own
 * channels (left-rail-chrome / left-rail-settings) rather than any engine
 * storage.
 */
import { RevisionedStore } from '@dsh-studio/shared/runtime'
import type { ActionsDecl, BakedActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  EngineStoreHandle,
  EngineStoreInstance,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectIconPreference } from './domain/project-icon.ts'
import { sanitizeProjectIconPreference } from './domain/project-icon.ts'
import type { SessionOrderBy } from './tree.ts'
import { DEFAULT_GROUP_ID } from './tree.ts'
import type { LeftRailViewChrome } from '@dsh-studio/shared/ui-chrome-tables'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** Session-list grouping mode: workspace sections or one flat recency list. */
export type SessionGroupBy = 'workspace' | 'flat'

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Explicit zero-or-five-session state keyed by Workspace group identity. */
  groupExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
  /** Selected tab id (persisted; falls back to the pinned default when absent). */
  activeTab: string
  /** repoRoot → named group id (absent = the pinned default tab). */
  projectGroup: Record<string, string>
  /** Ordered user group ids (the pinned default tab is implicit, not listed). */
  groupIds: string[]
  /** group id → display label. */
  groupLabels: Record<string, string>
  /** repoRoot → user alias (display name overriding the directory basename). */
  projectAlias: Record<string, string>
  /** worktreePath → user alias (display name overriding the directory basename or branch). */
  worktreeAlias: Record<string, string>
  /** repoRoot → explicit project icon preference; absence means auto-resolve. */
  projectIconOverrides: Record<string, ProjectIconPreference>
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the store construction call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
  setActiveTab: (draft: WorkspaceViewState, tab: string) => void
  moveProjectToGroup: (draft: WorkspaceViewState, repoRoot: string, groupId: string | undefined) => void
  createGroup: (draft: WorkspaceViewState, id: string, label: string) => void
  renameGroup: (draft: WorkspaceViewState, id: string, label: string) => void
  removeGroup: (draft: WorkspaceViewState, id: string) => void
  setProjectAlias: (draft: WorkspaceViewState, repoRoot: string, alias: string | undefined) => void
  setWorktreeAlias: (draft: WorkspaceViewState, worktreePath: string, alias: string | undefined) => void
  setProjectIconOverride: (draft: WorkspaceViewState, repoRoot: string, preference: ProjectIconPreference | undefined) => void
  hydrateGrouping: (draft: WorkspaceViewState, settings: { activeTab?: string; projectGroup?: Record<string, string>; groupIds?: string[]; groupLabels?: Record<string, string>; projectAlias?: Record<string, string>; worktreeAlias?: Record<string, string>; projectIconOverrides?: Record<string, ProjectIconPreference> }) => void
  hydrateChrome: (draft: WorkspaceViewState, chrome: LeftRailViewChrome) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  const actions: WorkspaceViewActions = {
    setGroupBy: (d, mode) => { d.groupBy = mode },
    setOrderBy: (d, mode) => { d.orderBy = mode },
    setGroupExpanded: (d, key, expanded) => { d.groupExpansion[key] = expanded },
    retainAccountKeys: (d, workspaceKeys) => {
      const retained = new Set(workspaceKeys)
      d.groupExpansion = Object.fromEntries(
        Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
      )
      d.sessionOrderByAccount = Object.fromEntries(
        Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
      )
      d.sessionUpdatedAtByAccount = Object.fromEntries(
        Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
      )
    },
    syncSessionOrderAccount: (d, accountKey, order, updatedAt) => {
      d.sessionOrderByAccount[accountKey] = order
      d.sessionUpdatedAtByAccount[accountKey] = updatedAt
    },
    setSessionOrder: (d, accountKey, order) => {
      d.sessionOrderByAccount[accountKey] = order
    },
    setActiveTab: (d, tab) => { d.activeTab = tab },
    moveProjectToGroup: (d, repoRoot, groupId) => {
      if (groupId === undefined || groupId === DEFAULT_GROUP_ID) delete d.projectGroup[repoRoot]
      else d.projectGroup[repoRoot] = groupId
    },
    createGroup: (d, id, label) => {
      if (!d.groupIds.includes(id)) d.groupIds.push(id)
      d.groupLabels[id] = label
    },
    renameGroup: (d, id, label) => { d.groupLabels[id] = label },
    removeGroup: (d, id) => {
      d.groupIds = d.groupIds.filter(g => g !== id)
      delete d.groupLabels[id]
      for (const [repoRoot, group] of Object.entries(d.projectGroup)) {
        if (group === id) delete d.projectGroup[repoRoot]
      }
    },
    setProjectAlias: (d, repoRoot, alias) => {
      if (alias === undefined || alias.trim() === '') delete d.projectAlias[repoRoot]
      else d.projectAlias[repoRoot] = alias.trim()
    },
    setWorktreeAlias: (d, worktreePath, alias) => {
      if (alias === undefined || alias.trim() === '') delete d.worktreeAlias[worktreePath]
      else d.worktreeAlias[worktreePath] = alias.trim()
    },
    setProjectIconOverride: (d, repoRoot, preference) => {
      const sanitized = sanitizeProjectIconPreference(preference)
      if (sanitized === undefined) delete d.projectIconOverrides[repoRoot]
      else d.projectIconOverrides[repoRoot] = sanitized
    },
    hydrateGrouping: (d, settings) => {
      if (typeof settings.activeTab === 'string') d.activeTab = settings.activeTab
      if (settings.projectGroup !== undefined) d.projectGroup = settings.projectGroup
      if (Array.isArray(settings.groupIds)) d.groupIds = settings.groupIds
      if (settings.groupLabels !== undefined) d.groupLabels = settings.groupLabels
      if (settings.projectAlias !== undefined) d.projectAlias = settings.projectAlias
      if (settings.worktreeAlias !== undefined) d.worktreeAlias = settings.worktreeAlias
      if (settings.projectIconOverrides !== undefined) {
        d.projectIconOverrides = Object.fromEntries(
          Object.entries(settings.projectIconOverrides)
            .map(([root, preference]) => [root, sanitizeProjectIconPreference(preference)] as const)
            .filter((entry): entry is readonly [string, ProjectIconPreference] => entry[1] !== undefined),
        )
      }
    },
    hydrateChrome: (d, chrome) => {
      d.groupBy = chrome.groupBy
      d.orderBy = chrome.orderBy
      d.groupExpansion = { ...chrome.groupExpansion }
      d.sessionOrderByAccount = Object.fromEntries(
        Object.entries(chrome.sessionOrder).map(([key, order]) => [key, [...order]]),
      )
      // Keep the observed-update snapshot: discarding it here would re-trigger
      // a full recency promotion on the next reload, reordering everything.
      // Reviewed decision C30 — retention is the intended behavior.
    },
  }
  return createSlotStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      activeTab: DEFAULT_GROUP_ID,
      projectGroup: {},
      groupIds: [],
      groupLabels: {},
      projectAlias: {},
      worktreeAlias: {},
      projectIconOverrides: {},
    }),
    actions,
  })
}

/* ── slot-store handle over the shared runtime ─────────────────────────── */

interface SlotStoreSpec<T, A> {
  init: () => T
  actions: A
}

/**
 * Build a slots-engine store handle over one {@linkcode RevisionedStore}.
 * Draft mutators run against a structured clone of the current snapshot, so
 * action bodies keep their in-place mutation shape without an immer
 * dependency; every action yields exactly one new snapshot identity and one
 * subscriber pass. The instance also exposes the raw snapshot-store face the
 * engine uses to bind its selector hook.
 */
function createSlotStore<T extends object, A extends ActionsDecl<T>>(
  spec: SlotStoreSpec<T, A>,
): EngineStoreHandle<T, A> {
  const create = (): EngineStoreInstance<T, A> => {
    const source = new RevisionedStore<T>(spec.init())
    const mutate = (mutator: (draft: T) => void): void => {
      const draft = structuredClone(source.getSnapshot())
      mutator(draft)
      source.setState(draft)
    }
    const actions = Object.fromEntries(
      Object.entries(spec.actions).map(([name, run]) => [
        name,
        (...params: unknown[]) => {
          mutate(draft => (run as (draft: T, ...args: unknown[]) => void)(draft, ...params))
        },
      ]),
    ) as BakedActions<T, A>
    const store: SnapshotStore<T> = {
      getSnapshot: () => source.getSnapshot(),
      subscribe: listener => source.subscribe(listener),
      update: mutator => { mutate(mutator) },
      set: next => { source.setState(structuredClone(next)) },
    }
    return {
      actions,
      getSnapshot: () => source.getSnapshot(),
      subscribe: listener => source.subscribe(listener),
      // No engine persistence seat: this store persists through the plugin's
      // own left_rail_view / settings channels, so there is nothing to clear.
      clearPersisted: () => {},
      store,
    }
  }
  return { spec, create }
}
