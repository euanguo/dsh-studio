/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectIconPreference } from './domain/project-icon.ts'
import { sanitizeProjectIconPreference } from './domain/project-icon.ts'
import type { LeftRailViewChrome } from '@dsh-studio/shared/ui-chrome-tables'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** Session-list grouping mode: workspace sections or one flat recency list. */
export type SessionGroupBy = 'workspace' | 'flat'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'

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
 * return type); drift fails assignability at the defineStore call.
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
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      activeTab: '__default__',
      projectGroup: {},
      groupIds: [],
      groupLabels: {},
      projectAlias: {},
      worktreeAlias: {},
      projectIconOverrides: {},
    }),
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
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
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
      setActiveTab: (d, tab: string) => { d.activeTab = tab },
      moveProjectToGroup: (d, repoRoot: string, groupId: string | undefined) => {
        if (groupId === undefined || groupId === '__default__') delete d.projectGroup[repoRoot]
        else d.projectGroup[repoRoot] = groupId
      },
      createGroup: (d, id: string, label: string) => {
        if (!d.groupIds.includes(id)) d.groupIds.push(id)
        d.groupLabels[id] = label
      },
      renameGroup: (d, id: string, label: string) => { d.groupLabels[id] = label },
      removeGroup: (d, id: string) => {
        d.groupIds = d.groupIds.filter(g => g !== id)
        delete d.groupLabels[id]
        for (const [repoRoot, group] of Object.entries(d.projectGroup)) {
          if (group === id) delete d.projectGroup[repoRoot]
        }
      },
      setProjectAlias: (d, repoRoot: string, alias: string | undefined) => {
        if (alias === undefined || alias.trim() === '') delete d.projectAlias[repoRoot]
        else d.projectAlias[repoRoot] = alias.trim()
      },
      setWorktreeAlias: (d, worktreePath: string, alias: string | undefined) => {
        if (alias === undefined || alias.trim() === '') delete d.worktreeAlias[worktreePath]
        else d.worktreeAlias[worktreePath] = alias.trim()
      },
      setProjectIconOverride: (d, repoRoot: string, preference: ProjectIconPreference | undefined) => {
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
        d.sessionUpdatedAtByAccount = {}
      },
    },
  })
}
