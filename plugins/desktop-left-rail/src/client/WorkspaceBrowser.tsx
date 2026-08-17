/** Fork of the official ui-workspace browser (see
 * docs/official-plugin-migration.md): official source, official primitives,
 * official types — only the CSS pipeline is ours.
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import { useEffect, useRef, useState } from 'react'
import { cn } from './shim/cn.ts'
import {
  Button, Menu, Modal, Tooltip,
  IconChevronDownOutline14, IconCloseFill14, IconFolderClose16,
  IconProjectAddOutline16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionId, SessionListState, SessionSearchResultItem, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { ProjectNode, ProjectTreeView, SessionNode, SessionOrderBy } from './tree.ts'
import {
  DEFAULT_GROUP_ID, repoExpansionKey, UNGROUPED_EXPANSION_KEY, UNGROUPED_KEY,
  workspaceExpansionKey, worktreeExpansionKey,
} from './tree.ts'
import { ProjectSearchResults } from './ProjectSearchResults.tsx'
import { FlatList, RemoteSearchState, SearchResults, ViewOptionsMenu } from './workspace-browser-views.tsx'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './rows/Rows.tsx'
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import { ProjectTreeBody } from './WorkspaceBrowserProjectTree.tsx'
import { createWorktree, useWorktreeLayouts, fetchBranches } from './worktree-api.ts'
import { loadLeftRailSettings, saveLeftRailSettings } from './left-rail-settings.ts'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { toast } from '@oh-dsh/shared/toast'
// Identity class map + scoped stylesheet (build-time generated from the
// forked CSS Modules — see scripts/left-rail-styles.mjs). The scope
// attribute is mounted on the region root below.
import { WorkspaceBrowserCss as css } from './styles.js'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Immutable membership toggle for the local expand-all array. */
export function WorkspaceBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  insertSessionBefore,
  createWorkspace,
  openPath,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
  const activeTab = useStore(s => s.activeTab)
  const projectGroup = useStore(s => s.projectGroup)
  const groupIds = useStore(s => s.groupIds)
  const groupLabels = useStore(s => s.groupLabels)
  const projectAlias = useStore(s => s.projectAlias)
  // Three-level tree worktree layouts (fetched per cwd, cached by roster).
  const worktreeLayouts = useWorktreeLayouts(workspaces.map(workspace => workspace.path))
  // Grouping persisted through the host settings service (not localStorage).
  const settingsRevision = useRef<number>(0)
  const settingsHydrated = useRef(false)
  useEffect(() => {
    let cancelled = false
    loadLeftRailSettings().then((view) => {
      if (cancelled) return
      settingsRevision.current = view.revision
      actions.hydrateGrouping(view.value)
      settingsHydrated.current = true
    }).catch(() => {
      if (!cancelled) settingsHydrated.current = true
    })
    return () => { cancelled = true }
  }, [actions.hydrateGrouping])
  useEffect(() => {
    if (!settingsHydrated.current) return
    const timer = window.setTimeout(() => {
      // CAS persistence with one self-healing retry: on a conflict (another
      // window wrote meanwhile) or a transport failure, re-read the latest
      // revision and retry once — a conflict must never wedge persistence
      // until reload.
      const persist = async (): Promise<void> => {
        const patch = { activeTab, projectGroup, groupIds, groupLabels, projectAlias }
        try {
          const view = await saveLeftRailSettings(patch, settingsRevision.current)
          settingsRevision.current = view.revision
        } catch {
          try {
            const latest = await loadLeftRailSettings()
            settingsRevision.current = latest.revision
            const view = await saveLeftRailSettings(patch, latest.revision)
            settingsRevision.current = view.revision
          } catch {
            // Second failure leaves the revision untouched; the next
            // debounced save retries, so loss is bounded to one window.
          }
        }
      }
      void persist()
    }, 300)
    return () => { window.clearTimeout(timer) }
  }, [activeTab, projectGroup, groupIds, groupLabels, projectAlias])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    // Retain the session-order accounts (workspace ids + ungrouped/flat) and
    // the namespaced expansion keys (ws:/repo:/wt:/ungrouped) so stale keys
    // never accumulate in the view store.
    const retain = new Set<string>([UNGROUPED_KEY, FLAT_SESSION_ORDER_KEY, UNGROUPED_EXPANSION_KEY])
    for (const workspace of workspaces) {
      retain.add(workspace.workspaceId as string)
      retain.add(workspaceExpansionKey(workspace.workspaceId as string))
      const layout = worktreeLayouts.layouts.get(workspace.path)
      if (layout !== null && layout !== undefined) {
        retain.add(repoExpansionKey(layout.repoRoot))
        for (const wt of layout.worktrees) retain.add(worktreeExpansionKey(wt.path))
      } else {
        retain.add(repoExpansionKey(workspace.path))
      }
    }
    actions.retainAccountKeys([...retain])
  }, [actions.retainAccountKeys, workspacePhase, workspaces, worktreeLayouts.layouts])

  // Reveal the current session in the three-level tree: selecting a session
  // elsewhere expands the containing project and worktree rows (the grouped
  // view auto-expands its group — same policy, project mode).
  const currentSessionId = useSessions(s => s.current)
  useEffect(() => {
    if (workspacePhase !== 'ready' || currentSessionId === undefined) return
    const container = workspaces.find(w => w.sessionIds.includes(currentSessionId))
    if (container === undefined) return
    const layout = worktreeLayouts.layouts.get(container.path)
    if (layout !== null && layout !== undefined) {
      actions.setGroupExpanded(repoExpansionKey(layout.repoRoot), true)
      let best: { path: string } | undefined
      for (const wt of layout.worktrees) {
        if (container.path === wt.path || container.path.startsWith(`${wt.path}/`)) {
          if (best === undefined || wt.path.length > best.path.length) best = wt
        }
      }
      if (best !== undefined) actions.setGroupExpanded(worktreeExpansionKey(best.path), true)
    } else {
      actions.setGroupExpanded(repoExpansionKey(container.path), true)
    }
  }, [workspacePhase, currentSessionId, workspaces, worktreeLayouts.layouts, actions.setGroupExpanded])
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog (same browser-owned pattern as workspace rename;
  // sessions have no client-side name-conflict rule — the host normalizes).
  // Unlike workspace rename, an unchanged title is NOT blocked: confirming
  // the current automatic title is the gesture that pins it.
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  // Archive is dialog-free: not destructive (the log and the accounting slot
  // remain), so the menu action commits directly; the row disappears when the
  // archive-set echo lands. Failures are non-fatal console diagnostics, the
  // same posture as reorder rejections.
  const onSessionArchive = (sessionId: SessionNode['id']) => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // ---- Three-level tree: worktree creation + group management. ----
  const [newWtTarget, setNewWtTarget] = useState<{ repoRoot: string; label: string; currentBranch: string | null; existing: { label: string; branch: string | null }[] } | null>(null)
  const [newWtBranchMenuOpen, setNewWtBranchMenuOpen] = useState(false)
  const [newWtBranches, setNewWtBranches] = useState<string[]>([])
  const [newWtPickBranch, setNewWtPickBranch] = useState('__new__')
  const [newWtNewBranch, setNewWtNewBranch] = useState('')
  const [newWtPath, setNewWtPath] = useState('')
  const [newWtPending, setNewWtPending] = useState(false)
  const [newWtError, setNewWtError] = useState<string | null>(null)
  const [projectAliasTarget, setProjectAliasTarget] = useState<{ repoRoot: string } | null>(null)
  const [projectAliasDraft, setProjectAliasDraft] = useState('')
  const [groupModal, setGroupModal] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null)
  const [groupDraft, setGroupDraft] = useState('')
  /** repoRoot awaiting a freshly created group ("move to new group" gesture). */
  const [pendingMoveProject, setPendingMoveProject] = useState<string | null>(null)
  const [removeProjectTarget, setRemoveProjectTarget] = useState<{ repoRoot: string; label: string; count: number } | null>(null)
  const [removeProjectPending, setRemoveProjectPending] = useState(false)
  const [removeProjectError, setRemoveProjectError] = useState<string | null>(null)
  // Copy-path feedback rides the shared app toast (plugins/shared/toast.tsx);
  // the sidebar plugin mounts its host, so this rail only publishes.
  const onCopy = (text: string): void => {
    void writeClipboard(text).then(ok => {
      toast(ok ? t('hover.copied') : t('copy.failed'))
    })
  }

  const slug = (value: string): string => value.trim().replace(/[\\/:*?"<>|\s]+/g, '-')

  // Shared tree view: the project tree body and the project search matches
  // derive from the same state, so a jump lands exactly where the tree shows.
  const projectTreeView: ProjectTreeView = {
    expanded: Object.entries(groupExpansion).filter(([, v]) => v).map(([k]) => k),
    activeTab,
    projectGroup,
    groupIds,
    groupLabels,
    projectAlias,
  }
  /** Jump to a matched project: switch to its tab, expand it, clear the search. */
  const jumpToProject = (project: ProjectNode): void => {
    const assigned = projectGroup[project.repoRoot] ?? DEFAULT_GROUP_ID
    actions.setActiveTab(groupIds.includes(assigned) ? assigned : DEFAULT_GROUP_ID)
    actions.setGroupExpanded(repoExpansionKey(project.repoRoot), true)
    setQuery('')
    setSearchExpanded(false)
  }
  const openNewWorktree = (repoRoot: string): void => {
    const layout = worktreeLayouts.layouts.get(repoRoot)
    const worktrees = layout?.worktrees ?? [{ path: repoRoot, head: null, branch: null, main: true }]
    const base = repoRoot.replace(/[/\\]+$/, '')
    setNewWtTarget({
      repoRoot,
      label: base.slice(base.lastIndexOf('/') + 1),
      currentBranch: worktrees.find(w => w.main)?.branch ?? worktrees[0]?.branch ?? null,
      existing: worktrees.map(wt => ({
        label: wt.path.split(/[/\\]/).pop() ?? wt.path,
        branch: wt.branch,
      })),
    })
    setNewWtBranches([])
    setNewWtPickBranch('__new__')
    setNewWtNewBranch('')
    setNewWtPath('')
    setNewWtError(null)
    fetchBranches(repoRoot).then(({ names }) => { setNewWtBranches(names) }).catch(() => { setNewWtBranches([]) })
  }
  const branchIsNew = newWtPickBranch === '__new__'
  const effectiveBranch = branchIsNew ? newWtNewBranch.trim() : newWtPickBranch
  const defaultWtPath = (repoRoot: string, branch: string): string => {
    const base = repoRoot.replace(/[/\\]+$/, '')
    const parent = base.slice(0, base.lastIndexOf('/'))
    const name = base.slice(base.lastIndexOf('/') + 1)
    return `${parent}/${name}-worktrees/${slug(branch) === '' ? 'new' : slug(branch)}`
  }
  const closeNewWorktree = (): void => {
    if (newWtPending) return
    setNewWtTarget(null)
  }
  const confirmNewWorktree = (): void => {
    if (newWtPending || newWtTarget === null) return
    if (effectiveBranch === '') { setNewWtError(t('wt.branch')); return }
    const path = (newWtPath.trim() === '' ? defaultWtPath(newWtTarget.repoRoot, effectiveBranch) : newWtPath.trim())
    setNewWtPending(true)
    setNewWtError(null)
    createWorktree(newWtTarget.repoRoot, path, effectiveBranch, branchIsNew).then(() => {
      setNewWtPending(false)
      setNewWtTarget(null)
      worktreeLayouts.refresh()
    }).catch((reason: unknown) => {
      setNewWtPending(false)
      setNewWtError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const openRenameProject = (repoRoot: string, currentLabel: string): void => {
    setProjectAliasTarget({ repoRoot })
    setProjectAliasDraft(projectAlias[repoRoot] ?? currentLabel)
  }
  const closeRenameProject = (): void => { setProjectAliasTarget(null) }
  const confirmRenameProject = (): void => {
    if (projectAliasTarget === null) return
    const alias = projectAliasDraft.trim()
    actions.setProjectAlias(projectAliasTarget.repoRoot, alias === '' ? undefined : alias)
    setProjectAliasTarget(null)
  }

  const openNewGroup = (): void => {
    setGroupModal({ mode: 'create' })
    setGroupDraft('')
  }
  const openRenameGroup = (id: string): void => {
    setGroupModal({ mode: 'rename', id })
    setGroupDraft(groupLabels[id] ?? id)
  }
  const closeGroupModal = (): void => { setGroupModal(null) }
  const confirmGroupModal = (): void => {
    const label = groupDraft.trim()
    if (label === '' || groupModal === null) return
    if (groupModal.mode === 'create') {
      const id = `group-${crypto.randomUUID()}`
      actions.createGroup(id, label)
      // A pending "move to new group" gesture completes here: the project
      // lands in the freshly created group instead of vanishing into an
      // unregistered id.
      if (pendingMoveProject !== null) {
        actions.moveProjectToGroup(pendingMoveProject, id)
        setPendingMoveProject(null)
      }
    } else {
      actions.renameGroup(groupModal.id, label)
    }
    setGroupModal(null)
  }

  const onRemoveProjectRequest = (repoRoot: string, label: string): void => {
    const layout = worktreeLayouts.layouts.get(repoRoot)
    setRemoveProjectTarget({ repoRoot, label, count: layout?.worktrees.length ?? 1 })
    setRemoveProjectError(null)
  }
  const closeRemoveProject = (): void => {
    if (removeProjectPending) return
    setRemoveProjectTarget(null)
  }
  const confirmRemoveProject = (): void => {
    if (removeProjectPending || removeProjectTarget === null) return
    setRemoveProjectPending(true)
    setRemoveProjectError(null)
    const workspaceIds = workspaces
      .filter(w => {
        const layout = worktreeLayouts.layouts.get(w.path)
        return (layout !== null && layout !== undefined && layout.repoRoot === removeProjectTarget.repoRoot)
          || w.path === removeProjectTarget.repoRoot
      })
      .map(w => w.workspaceId)
    Promise.allSettled(workspaceIds.map(id => deleteWorkspace(id))).then((results) => {
      setRemoveProjectPending(false)
      const failed = results.some(r => r.status === 'rejected')
      if (failed) setRemoveProjectError(t('project.remove.pending'))
      else setRemoveProjectTarget(null)
    })
  }

  return (
    <div className={cn(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={cn(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
            {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && (
          <div className={cn(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={cn(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                >
                  <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                >
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={cn(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              onGroupPick={(mode) => { actions.setGroupBy(mode) }}
              onOrderPick={(mode) => { actions.setOrderBy(mode) }}
              t={t}
            />
          )}
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the region hides the
              button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen(v => !v)
                }}
              >
                <IconProjectAddOutline16 size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            onClick={() => {
              setSearchExpanded(true)
              setSearchOnExpand(true)
              expandSidebar()
            }}
          >
            <IconSearchOutline16 size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              useSessions={useSessions}
              open={open}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              header={groupBy === 'workspace' ? (
                <ProjectSearchResults
                  useSessions={useSessions}
                  workspaces={workspaces}
                  layouts={worktreeLayouts.layouts}
                  archivedSessionIds={archivedSessionIds}
                  query={normalizedQuery}
                  view={projectTreeView}
                  onJump={jumpToProject}
                  t={t}
                />
              ) : undefined}
              t={t}
            />
          )
          : groupBy === 'flat'
            ? (
              <FlatList
                useSessions={useSessions} open={open} forkSession={forkSession}
                onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}
                archivedSessionIds={archivedSessionIds}
                orderBy={orderBy}
                sessionOrderByAccount={sessionOrderByAccount}
                sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                syncSessionOrderAccount={actions.syncSessionOrderAccount}
                setSessionOrder={actions.setSessionOrder}
                t={t}
              />
            )
            : (
              <ProjectTreeBody
                useSessions={useSessions}
                open={open}
                forkSession={forkSession}
                startSession={startSession}
                workspaces={workspaces}
                layouts={worktreeLayouts.layouts}
                archivedSessionIds={archivedSessionIds}
                view={projectTreeView}
                onToggleProject={(key, expanded) => { actions.setGroupExpanded(repoExpansionKey(key), expanded) }}
                onToggleWorktree={(key, expanded) => { actions.setGroupExpanded(worktreeExpansionKey(key), expanded) }}
                onSetTab={actions.setActiveTab}
                onNewWorktree={openNewWorktree}
                onRemoveProject={onRemoveProjectRequest}
                onMoveProject={(repoRoot, groupId) => {
                  // "New group" opens the create dialog and moves the
                  // project into the group once it exists.
                  if (groupId === '__new__') {
                    setPendingMoveProject(repoRoot)
                    openNewGroup()
                  } else {
                    actions.moveProjectToGroup(repoRoot, groupId)
                  }
                }}
                onNewGroup={openNewGroup}
                onRenameGroup={(tab) => { openRenameGroup(tab.id) }}
                onRemoveGroup={(tab) => { actions.removeGroup(tab.id) }}
                onRenameWorktree={(workspaceId, title) => {
                  setRenameTarget({ workspaceId: workspaceId as WorkspaceId, currentTitle: title })
                  setRenameDraft(title)
                  setRenameError(null)
                }}
                onDeleteWorktree={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId: workspaceId as WorkspaceId, title })
                  setDeleteError(null)
                }}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                onRenameProject={openRenameProject}
                onOpenPath={(path) => { void openPath(path) }}
                onCopy={onCopy}
                loading={worktreeLayouts.loading}
                t={t}
              />
            ))}
      </div>

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>

      {/* New WorkTree */}
      <Modal
        open={newWtTarget !== null}
        onClose={closeNewWorktree}
        closeLabel={t('close')}
        title={t('wt.new.title')}
        footer={(
          <>
            <Button variant="outline" disabled={newWtPending} onClick={closeNewWorktree}>{t('cancel')}</Button>
            <Button variant="primary" disabled={newWtPending || effectiveBranch === ''} onClick={confirmNewWorktree}>
              {newWtPending ? t('wt.pending') : t('wt.create')}
            </Button>
          </>
        )}
      >
        {newWtTarget !== null && (
          <div className={css.wtModalBody}>
            {/* Context: which repo / current branch this worktree forks from. */}
            <div className={css.wtModalContext}>
              {t('wt.basedOn', { name: newWtTarget.label })}
              {newWtTarget.currentBranch !== null && (
                <span className={css.wtModalContextBranch}>
                  {' · '}{newWtTarget.currentBranch}
                </span>
              )}
            </div>

            {/* Existing worktrees (read-only inventory). */}
            {newWtTarget.existing.length > 0 && (
              <div>
                <div className={css.wtSectionLabel}>{t('wt.existing')}</div>
                {newWtTarget.existing.map(wt => (
                  <div key={wt.label} className={css.wtExistingRow}>
                    <IconFolderClose16 size={14} />
                    <span className={css.wtExistingRowText}>{wt.label}</span>
                    {wt.branch !== null && <span className={css.wtExistingBranch}>{wt.branch}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Branch picker: existing branches via Menu, or a new name. */}
            <div>
              <div className={css.wtSectionLabel}>{t('wt.branch')}</div>
              <Menu
                open={newWtBranchMenuOpen}
                onClose={() => { setNewWtBranchMenuOpen(false) }}
                items={[
                  ...newWtBranches.map(b => ({ id: b, label: b })),
                  { type: 'separator' as const, id: 'wt-branch-sep' },
                  { id: '__new__', label: t('wt.newBranch') },
                ]}
                selectedId={branchIsNew ? '__new__' : newWtPickBranch}
                onSelect={(id) => {
                  setNewWtBranchMenuOpen(false)
                  setNewWtPickBranch(id)
                  const branch = id === '__new__' ? newWtNewBranch : id
                  if (newWtPath.trim() === '' && newWtTarget !== null) setNewWtPath(defaultWtPath(newWtTarget.repoRoot, branch))
                }}
                portal
                anchor={(
                  <button
                    type="button"
                    className={cn(css.renameInput, css.wtPickerButton)}
                    onClick={() => { setNewWtBranchMenuOpen(v => !v) }}
                  >
                    <span className={css.wtPickerButtonText}>
                      {branchIsNew ? (newWtNewBranch === '' ? t('wt.newBranch') : newWtNewBranch) : newWtPickBranch}
                    </span>
                    <IconChevronDownOutline14 />
                  </button>
                )}
              />
              {branchIsNew && (
                <input
                  className={cn(css.renameInput, css.wtNewBranchInput)}
                  value={newWtNewBranch}
                  aria-label={t('wt.newBranch')}
                  placeholder={t('wt.newBranch')}
                  autoFocus
                  disabled={newWtPending}
                  onChange={(e) => {
                    setNewWtNewBranch(e.target.value)
                    if (newWtPath.trim() === '' && newWtTarget !== null) setNewWtPath(defaultWtPath(newWtTarget.repoRoot, e.target.value))
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmNewWorktree() }}
                />
              )}
            </div>

            {/* Location (auto-generated, editable). */}
            <div>
              <div className={css.wtSectionLabel}>{t('wt.path')}</div>
              <input
                className={cn(css.renameInput, css.wtPathInput)}
                value={newWtPath}
                aria-label={t('wt.path')}
                disabled={newWtPending}
                onChange={(e) => { setNewWtPath(e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmNewWorktree() }}
              />
            </div>
          </div>
        )}
        {newWtError !== null && <div className={css.renameError} role="alert">{newWtError}</div>}
      </Modal>

      {/* Rename project alias */}
      <Modal
        open={projectAliasTarget !== null}
        onClose={closeRenameProject}
        closeLabel={t('close')}
        title={t('rename')}
        footer={(
          <>
            <Button variant="outline" onClick={closeRenameProject}>{t('cancel')}</Button>
            <Button variant="primary" onClick={confirmRenameProject}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={projectAliasDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          onChange={(e) => { setProjectAliasDraft(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmRenameProject() }}
        />
      </Modal>

      {/* New / rename group */}
      <Modal
        open={groupModal !== null}
        onClose={closeGroupModal}
        closeLabel={t('close')}
        title={groupModal?.mode === 'rename' ? t('tab.renameGroup.title') : t('tab.newGroup.title')}
        footer={(
          <>
            <Button variant="outline" onClick={closeGroupModal}>{t('cancel')}</Button>
            <Button variant="primary" disabled={groupDraft.trim() === ''} onClick={confirmGroupModal}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={groupDraft}
          aria-label={t('tab.groupName')}
          autoFocus
          onChange={(e) => { setGroupDraft(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmGroupModal() }}
        />
      </Modal>

      {/* Remove project */}
      <Modal
        open={removeProjectTarget !== null}
        onClose={closeRemoveProject}
        closeLabel={t('close')}
        title={t('project.remove.title')}
        {...removeProjectTarget === null
          ? {}
          : { description: `${t('project.remove.desc', { name: removeProjectTarget.label })} ${t('project.remove.count', { n: removeProjectTarget.count })}` }}
        footer={(
          <>
            <Button variant="outline" disabled={removeProjectPending} onClick={closeRemoveProject}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={removeProjectPending}
              onClick={confirmRemoveProject}
            >
              {removeProjectPending ? t('project.remove.pending') : t('project.remove.confirm')}
            </Button>
          </>
        )}
      >
        {removeProjectError !== null && <div className={css.renameError} role="alert">{removeProjectError}</div>}
      </Modal>
    </div>
  )
}
