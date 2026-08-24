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
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from './shim/cn.ts'
import {
  Button, Menu, Modal, Tooltip,
  RiskConfirmation,
  IconChevronDownOutline14, IconCloseFill14, IconFolderClose16,
  IconProjectAddOutline16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { ProjectNode, ProjectTreeView, SessionNode, SessionOrderBy, ProjectIconNode } from './tree.ts'
import type { ActionSelection } from './domain/commands.ts'
import type { ProjectIconPreference } from './domain/project-icon.ts'
import {
  DEFAULT_GROUP_ID, repoExpansionKey, UNGROUPED_EXPANSION_KEY, UNGROUPED_KEY,
  workspaceExpansionKey, worktreeExpansionKey, workspaceLabel,
} from './tree.ts'
import { ProjectSearchResults } from './ProjectSearchResults.tsx'
import { FlatList, RemoteSearchState, SearchResults, ViewOptionsMenu } from './workspace-browser-views.tsx'
import { nextSessionOrderAccount, orderedWorkspaceViews } from './session-order.ts'
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import { ProjectTreeBody } from './WorkspaceBrowserProjectTree.tsx'
import { createWorktree, useWorktreeLayouts, fetchBranches, fetchWorktreeDefaults, previewWorktreeRemoval, removeWorktree } from './worktree-api.ts'
import { computeWorktreeLocation, type WorktreeDefaultsResult } from '@dsh-studio/shared/worktree-preferences'
import { detectProjectIcon, type ProjectIconDetection } from './project-icon-api.ts'
import { projectIconNodeOf } from './project-icon-model.ts'
import { ProjectIconModal } from './ProjectIconModal.tsx'
import { deriveLeftRailSnapshot } from './project-tree-model.ts'
import { createRailController } from './rail-controller.ts'
import { isPathWithin } from './domain/identities.ts'
import { loadLeftRailSettings, saveLeftRailSettings, type LeftRailSettings } from './left-rail-settings.ts'
import { flushLeftRailChrome, loadLeftRailChrome, saveLeftRailChrome } from './left-rail-chrome.ts'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { toast } from '@dsh-studio/shared/toast'
// Identity class map + scoped stylesheet (build-time generated from the
// forked CSS Modules — see scripts/left-rail-styles.mjs). The scope
// attribute is mounted on the region root below.
import { WorkspaceBrowserCss as css } from './styles.ts'
import { NewWorktreeDialog, type NewWtTarget } from './NewWorktreeDialog.tsx'
import { FieldError, StatusLine, ToolbarAction } from '@dsh-studio/shared/ui'

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
  const sessionList = useSessions(state => state)
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
  const worktreeAlias = useStore(s => s.worktreeAlias)
  const projectIconOverrides = useStore(s => s.projectIconOverrides)
  // Three-level tree worktree layouts (fetched per cwd, cached by roster).
  const worktreeLayouts = useWorktreeLayouts(workspaces.map(workspace => workspace.path))
  // Keep Workspace accounts current even while the Project Tree is mounted;
  // the official grouped view used to own this synchronization effect.
  const previousOrderBy = useRef(orderBy)
  useEffect(() => {
    if (workspacePhase !== 'ready' || sessionList.phase !== 'ready') return
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    const switchedToManual = previousOrderBy.current === 'updated' && orderBy === 'manual'
    previousOrderBy.current = orderBy
    for (const workspace of workspaces) {
      const sessionIds = workspace.sessionIds.filter(id => sessionList.byId[id] !== undefined)
      const key = workspace.workspaceId as string
      const next = nextSessionOrderAccount({
        sessionIds,
        previousOrder: switchedToManual ? undefined : sessionOrderByAccount[key],
        previousUpdatedAt: switchedToManual ? {} : sessionUpdatedAtByAccount[key] ?? {},
        list: sessionList,
        orderBy,
        sortByRecency: orderBy === 'updated'
          && (sessionOrderByAccount[key] === undefined || switchedToUpdated),
      })
      if (next.changed) {
        actions.syncSessionOrderAccount(key, next.order.map(id => id as string), next.updatedAt)
      }
    }
  }, [actions.syncSessionOrderAccount, orderBy, sessionList, sessionOrderByAccount,
    sessionUpdatedAtByAccount, workspacePhase, workspaces])
  const orderedWorkspaces = useMemo(
    () => orderedWorkspaceViews(workspaces, sessionOrderByAccount),
    [sessionOrderByAccount, workspaces],
  )
  // The controller keeps topology mutations serialized by canonical Worktree identity.
  const railController = useMemo(() => createRailController({
    preview: previewWorktreeRemoval,
    remove: removeWorktree,
    refresh: worktreeLayouts.refresh,
  }), [])
  const [iconRevision, setIconRevision] = useState(0)

  const projectRoots = useMemo(() => Array.from(new Set(
    workspaces.map(workspace => worktreeLayouts.layouts.get(workspace.path)?.repoRoot ?? workspace.path),
  )).sort(), [workspaces, worktreeLayouts.layouts])
  const [projectIconDetections, setProjectIconDetections] = useState<Map<string, ProjectIconDetection['icon']>>(new Map())
  const projectRootKey = projectRoots.join('\n')
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const run = async (): Promise<void> => {
      const next = new Map<string, ProjectIconDetection['icon']>()
      await Promise.all(projectRoots.map(async root => {
        try {
          const detection = await detectProjectIcon(root, controller.signal)
          next.set(detection.repoRoot, detection.icon)
        } catch {
          // Icon enrichment is best effort; the model keeps its glyph fallback.
        }
      }))
      if (!cancelled) setProjectIconDetections(next)
    }
    void run()
    return () => { cancelled = true; controller.abort() }
  }, [projectRootKey, projectRoots, iconRevision])
  const projectIcons = useMemo(() => {
    const icons = new Map<string, ProjectIconNode>()
    for (const root of projectRoots) {
      const isGit = workspaces.some(workspace => worktreeLayouts.layouts.get(workspace.path)?.repoRoot === root)
      icons.set(root, projectIconNodeOf({
        isGit,
        preference: projectIconOverrides[root],
        detection: projectIconDetections.get(root),
      }))
    }
    return icons
  }, [projectIconDetections, projectIconOverrides, projectRoots, workspaces, worktreeLayouts.layouts])
  // Grouping and ordering are persisted through the UI storage domain.
  const settingsRevision = useRef<number>(0)
  // Last-known server slice: the browser owns ONLY the view fields below, so
  // every whole-section save merges them over the server truth — keys owned
  // by other surfaces (the settings page's worktreeDir/nestWorktrees, future
  // slices) ride along untouched instead of being deleted or reverted.
  const settingsSlice = useRef<LeftRailSettings>({})
  const settingsHydrated = useRef(false)
  const chromeHydrated = useRef(false)
  useEffect(() => {
    let cancelled = false
    loadLeftRailSettings().then((view) => {
      if (cancelled) return
      settingsRevision.current = view.revision
      settingsSlice.current = view.value
      actions.hydrateGrouping(view.value)
      settingsHydrated.current = true
    }).catch(() => {
      if (!cancelled) settingsHydrated.current = true
    })
    return () => { cancelled = true }
  }, [actions.hydrateGrouping])
  useEffect(() => {
    let cancelled = false
    loadLeftRailChrome().then((chrome) => {
      if (cancelled) return
      chromeHydrated.current = true
      actions.hydrateChrome(chrome)
    }).catch(() => {
      if (!cancelled) chromeHydrated.current = true
    })
    return () => { cancelled = true }
  }, [actions.hydrateChrome])
  useEffect(() => () => { void flushLeftRailChrome() }, [])
  useEffect(() => {
    if (!chromeHydrated.current) return
    saveLeftRailChrome({
      groupBy,
      orderBy,
      groupExpansion,
      sessionOrder: sessionOrderByAccount,
    })
  }, [groupBy, groupExpansion, orderBy, sessionOrderByAccount])
  useEffect(() => {
    if (!settingsHydrated.current) return
    const timer = window.setTimeout(() => {
      // CAS persistence with one self-healing retry: on a conflict (another
      // surface wrote meanwhile) or a transport failure, re-read the latest
      // slice and retry once over THAT base — a conflict must never wedge
      // persistence until reload, and must never revert the other surface's
      // keys with this surface's stale copy.
      const persist = async (): Promise<void> => {
        const patch: LeftRailSettings = {
          ...settingsSlice.current,
          activeTab, projectGroup, groupIds, groupLabels, projectAlias, worktreeAlias, projectIconOverrides,
        }
        try {
          const view = await saveLeftRailSettings(patch, settingsRevision.current)
          settingsRevision.current = view.revision
          settingsSlice.current = view.value
        } catch {
          try {
            const latest = await loadLeftRailSettings()
            settingsRevision.current = latest.revision
            settingsSlice.current = latest.value
            const view = await saveLeftRailSettings({
              ...latest.value,
              activeTab, projectGroup, groupIds, groupLabels, projectAlias, worktreeAlias, projectIconOverrides,
            }, latest.revision)
            settingsRevision.current = view.revision
            settingsSlice.current = view.value
          } catch {
            // Second failure leaves the revision untouched; the next
            // debounced save retries, so loss is bounded to one window.
          }
        }
      }
      void persist()
    }, 300)
    return () => { window.clearTimeout(timer) }
  }, [activeTab, projectGroup, groupIds, groupLabels, projectAlias, worktreeAlias, projectIconOverrides])
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
  const wsPlusRef = useRef<HTMLElement>(null)
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
  const [deleteTarget, setDeleteTarget] = useState<{
    workspaceId: WorkspaceId
    title: string
    /** Row context for the optional physical escalation (linked Git rows). */
    repoRoot?: string
    worktreePath?: string
    physicalAvailable?: boolean
    /** Every registration under the worktree (physical escalation releases them all). */
    workspaceIds?: WorkspaceId[]
  } | null>(null)
  /** Opt-in: also run `git worktree remove` (default off — keep the directory). */
  const [deletePhysical, setDeletePhysical] = useState(false)
  /** Dirty/locked preview for the checked physical option (fetched on check). */
  const [deletePhysicalPreview, setDeletePhysicalPreview] = useState<{ dirty: boolean; locked: boolean } | null>(null)
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
    setDeletePhysical(false)
    setDeletePhysicalPreview(null)
  }
  /** Toggle the physical option; checking it fetches the dirty/locked preview. */
  const toggleDeletePhysical = (checked: boolean): void => {
    setDeletePhysical(checked)
    setDeletePhysicalPreview(null)
    if (!checked || deleteTarget?.repoRoot === undefined || deleteTarget.worktreePath === undefined) return
    void railController.previewPhysicalWorktree(deleteTarget.repoRoot, deleteTarget.worktreePath)
      .then(preview => { setDeletePhysicalPreview({ dirty: preview.dirty, locked: preview.locked }) })
      .catch(reason => { setDeleteError(reason instanceof Error ? reason.message : String(reason)) })
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)

    // Physical escalation: remove the worktree from disk (refused by the
    // host while dirty/locked — never forced from this dialog) and release
    // EVERY registration under it, not just the targeted one: the other
    // registrations point into the deleted directory.
    if (deletePhysical && deleteTarget.physicalAvailable === true
      && deleteTarget.repoRoot !== undefined && deleteTarget.worktreePath !== undefined) {
      const target = deleteTarget
      void railController.removePhysicalWorktree(target.repoRoot!, target.worktreePath!, false)
        .then(async () => {
          const cleanup = await Promise.allSettled(
            (target.workspaceIds ?? [target.workspaceId]).map(id => deleteWorkspace(id)),
          )
          const failed = cleanup.filter(result => result.status === 'rejected').length
          if (failed > 0) {
            setDeleting(false)
            setDeleteError(t('worktree.remove.cleanupFailed', { count: failed }))
            return
          }
          worktreeLayouts.refresh()
          setDeleteTarget(null)
          setDeletePhysical(false)
          setDeletePhysicalPreview(null)
          setDeleting(false)
        })
        .catch(reason => {
          setDeleting(false)
          setDeleteError(reason instanceof Error ? reason.message : String(reason))
        })
      return
    }

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
    const [newWtTarget, setNewWtTarget] = useState<NewWtTarget | null>(null)
  const [iconModalProject, setIconModalProject] = useState<ProjectNode | null>(null)
  const [worktreeAliasTarget, setWorktreeAliasTarget] = useState<{ worktreePath: string } | null>(null)
  const [worktreeAliasDraft, setWorktreeAliasDraft] = useState('')
  const [projectAliasTarget, setProjectAliasTarget] = useState<{ repoRoot: string } | null>(null)
  const [projectAliasDraft, setProjectAliasDraft] = useState('')
  const [groupModal, setGroupModal] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null)
  const [groupDraft, setGroupDraft] = useState('')
  /** repoRoot awaiting a freshly created group ("move to new group" gesture). */
  const [pendingMoveProject, setPendingMoveProject] = useState<string | null>(null)
  const [removeProjectTarget, setRemoveProjectTarget] = useState<{ repoRoot: string; label: string; count: number } | null>(null)
  const [removeProjectPending, setRemoveProjectPending] = useState(false)
  const [removeProjectError, setRemoveProjectError] = useState<string | null>(null)
  const [physicalRemoveTarget, setPhysicalRemoveTarget] = useState<{ repoRoot: string; path: string; workspaceIds: WorkspaceId[]; workspaceCount: number; sessionCount: number } | null>(null)
  const [physicalRemovePreview, setPhysicalRemovePreview] = useState<Awaited<ReturnType<typeof previewWorktreeRemoval>> | null>(null)
  const [physicalRemovePending, setPhysicalRemovePending] = useState(false)
  const [physicalRemoveAcknowledged, setPhysicalRemoveAcknowledged] = useState(false)
  const [physicalRemoveError, setPhysicalRemoveError] = useState<string | null>(null)

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
    worktreeAlias,
  }
  const projectRailSnapshot = useMemo(
    () => deriveLeftRailSnapshot({
      list: sessionList,
      workspaces: orderedWorkspaces,
      layouts: worktreeLayouts.layouts,
      archivedSessionIds,
      view: projectTreeView,
      projectIcons,
    }),
    [archivedSessionIds, orderedWorkspaces, projectIconDetections, projectIcons, projectTreeView, sessionList, worktreeLayouts.layouts],
  )
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

  const openRenameWorktree = (worktreePath: string, currentLabel: string): void => {
    setWorktreeAliasTarget({ worktreePath })
    setWorktreeAliasDraft(worktreeAlias[worktreePath] ?? currentLabel)
  }
  const closeRenameWorktree = (): void => { setWorktreeAliasTarget(null) }
  const confirmRenameWorktree = (): void => {
    if (worktreeAliasTarget === null) return
    const alias = worktreeAliasDraft.trim()
    actions.setWorktreeAlias(worktreeAliasTarget.worktreePath, alias === '' ? undefined : alias)
    setWorktreeAliasTarget(null)
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

  const dispatchProjectTreeAction = (selection: ActionSelection): void => {
    if (selection.target.kind === 'project') {
      const id = selection.target.id
      const repoRoot = id.kind === 'git' ? id.repoRoot : id.path
      if (selection.action === 'project.create-worktree') openNewWorktree(repoRoot)
      else if (selection.action === 'project.rename-alias') openRenameProject(repoRoot, projectAlias[repoRoot] ?? workspaceLabel(repoRoot))
      else if (selection.action === 'project.set-icon') {
        const found = projectRailSnapshot.tree.allProjects.find(p => p.repoRoot === repoRoot) ?? null
        setIconModalProject(found)
      } else if (selection.action === 'project.refresh-icon') {
        setIconRevision(revision => revision + 1)
      } else if (selection.action === 'project.reset-icon') {
        actions.setProjectIconOverride(repoRoot, undefined)
      } else if (selection.action === 'project.move-group') {
        if (selection.groupId === '__new__') {
          setPendingMoveProject(repoRoot)
          openNewGroup()
        } else {
          actions.moveProjectToGroup(repoRoot, selection.groupId === '__default__' ? undefined : selection.groupId)
        }
      } else if (selection.action === 'project.copy-path') onCopy(repoRoot)
      else if (selection.action === 'project.open-directory') void openPath(repoRoot)
      else if (selection.action === 'project.remove-registration') onRemoveProjectRequest(repoRoot, projectAlias[repoRoot] ?? workspaceLabel(repoRoot))
      return
    }

    if (selection.target.kind === 'worktree') {
      const worktree = selection.target.id
      const path = worktree.path
      const repoRoot = worktree.project.kind === 'git' ? worktree.project.repoRoot : worktree.project.path
      if (selection.action === 'worktree.create-session') {
        actions.setGroupExpanded(worktreeExpansionKey(path), true)
        if (selection.workspaceId !== undefined) {
          startSession(selection.workspaceId as WorkspaceId)
          return
        }
        // No registered Workspace under this worktree (it was created
        // outside the app, e.g. a terminal `git worktree add`): adopt the
        // directory as a Workspace, then start the session in it. The
        // fallback never silently targets the current/recent Workspace —
        // that would scope the session's cwd to the wrong checkout.
        createWorkspace({ path }).then(workspace => {
          startSession(workspace.workspaceId)
        }).catch(reason => {
          toast(t('worktree.adopt.failed', {
            reason: reason instanceof Error ? reason.message : String(reason),
          }))
        })
      } else if (selection.action === 'worktree.rename') {
        if (selection.workspaceId !== undefined) {
          const workspace = workspaces.find(item => String(item.workspaceId) === selection.workspaceId)
          setRenameTarget({ workspaceId: selection.workspaceId as WorkspaceId, currentTitle: workspace?.title ?? workspaceLabel(path) })
          setRenameDraft(workspace?.title ?? workspaceLabel(path))
          setRenameError(null)
        } else {
          // Registration-less row: rename edits the display alias until the
          // directory is adopted as a Workspace (worktree = workspace).
          openRenameWorktree(path, worktreeAlias[path] ?? workspaceLabel(path))
        }
      } else if (selection.action === 'worktree.remove') {
        if (selection.workspaceId !== undefined) {
          // Registration removal dialog. Linked Git rows additionally offer
          // physical WorkTree deletion as an OPT-IN checkbox there (default
          // off): one remove verb, one dialog, explicit escalation.
          const workspace = workspaces.find(item => String(item.workspaceId) === selection.workspaceId)
          const node = projectRailSnapshot.tree.allProjects
            .find(p => p.repoRoot === repoRoot)?.worktrees.find(w => w.path === path)
          setDeleteTarget({
            workspaceId: selection.workspaceId as WorkspaceId,
            title: workspace?.title ?? workspaceLabel(path),
            repoRoot,
            worktreePath: path,
            physicalAvailable: node?.isGit === true && node.main !== true,
            workspaceIds: workspaces.filter(w => isPathWithin(path, w.path)).map(w => w.workspaceId as WorkspaceId),
          })
          setDeletePhysical(false)
          setDeletePhysicalPreview(null)
        } else {
          // Linked Git worktree with no registration (created outside the
          // app): removing the workspace IS removing the worktree.
          const affectedWorkspaces = workspaces.filter(workspace => isPathWithin(path, workspace.path))
          const affectedSessionIds = affectedWorkspaces.flatMap(workspace => workspace.sessionIds)
          const hasRunning = affectedSessionIds.some(id => sessionList.byId[id]?.running === true)
          if (hasRunning) {
            toast(t('worktree.remove.active'))
            return
          }
          setPhysicalRemoveTarget({
            repoRoot,
            path,
            workspaceIds: affectedWorkspaces.map(workspace => workspace.workspaceId),
            workspaceCount: affectedWorkspaces.length,
            sessionCount: affectedSessionIds.length,
          })
          setPhysicalRemovePreview(null)
          setPhysicalRemoveAcknowledged(false)
          setPhysicalRemoveError(null)
          void railController.previewPhysicalWorktree(repoRoot, path).then(preview => {
            setPhysicalRemovePreview(preview)
          }).catch(reason => {
            setPhysicalRemoveError(reason instanceof Error ? reason.message : String(reason))
          })
        }
      } else if (selection.action === 'worktree.copy-path') onCopy(path)
      else if (selection.action === 'worktree.open-directory') void openPath(path)
    }
  }

  const closePhysicalRemove = (): void => {
    if (physicalRemovePending) return
    setPhysicalRemoveTarget(null)
    setPhysicalRemovePreview(null)
    setPhysicalRemoveError(null)
    setPhysicalRemoveAcknowledged(false)
  }
  const confirmPhysicalRemove = (): void => {
    if (physicalRemovePending || physicalRemoveTarget === null || physicalRemovePreview === null) return
    setPhysicalRemovePending(true)
    setPhysicalRemoveError(null)
    const target = physicalRemoveTarget
    void railController.removePhysicalWorktree(
      target.repoRoot,
      target.path,
      physicalRemovePreview.dirty || physicalRemovePreview.locked,
    ).then(async () => {
      // Worktree = workspace: the physical removal also releases the
      // registrations that lived under it. Cleanup failure leaves orphans,
      // so it surfaces instead of passing silently.
      const cleanup = await Promise.allSettled(
        target.workspaceIds.map(id => deleteWorkspace(id as WorkspaceId)),
      )
      const failed = cleanup.filter(result => result.status === 'rejected').length
      setPhysicalRemovePending(false)
      setPhysicalRemoveTarget(null)
      setPhysicalRemovePreview(null)
      setPhysicalRemoveError(null)
      setPhysicalRemoveAcknowledged(false)
      if (failed > 0) {
        toast(t('worktree.remove.cleanupFailed', { count: failed }))
      }
    }).catch(reason => {
      setPhysicalRemovePending(false)
      setPhysicalRemoveError(reason instanceof Error ? reason.message : String(reason))
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
                <Button
                  variant="ghost"
                  size="sm"
                  className={css.searchButton}
                  icon={<IconSearchOutline16 size={searchExpanded ? 11 : 14} />}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                />
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
                <Button
                  variant="ghost"
                  size="sm"
                  className={css.clearButton}
                  icon={<IconCloseFill14 />}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                />
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
            <ToolbarAction
              ref={wsPlusRef}
              variant="ghost"
              className={css.iconButton}
              icon={<IconProjectAddOutline16 size={wide ? 16 : 18} />}
              label={t('workspace.add')}
              aria-expanded={wsPickerOpen}
              pressed={wsPickerOpen}
              onClick={() => { setWsPickerOpen(v => !v) }}
            />
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
          <Button
            variant="ghost"
            size="sm"
            className={css.searchButton}
            icon={<IconSearchOutline16 size={18} />}
            aria-label={t('search.sessions.aria')}
            onClick={() => {
              setSearchExpanded(true)
              setSearchOnExpand(true)
              expandSidebar()
            }}
          />
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


              query={normalizedQuery}

               archivedSessionIds={archivedSessionIds}
               workspaces={workspaces}
               remote={remoteSearch}
              resultLimit={searchResultLimit}
              header={groupBy === 'workspace' ? (
                <ProjectSearchResults
                   snapshot={projectRailSnapshot}




                  query={normalizedQuery}



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
                 useSessions={useSessions}
                 open={open} forkSession={forkSession}
                onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}


               orderBy={orderBy}
                archivedSessionIds={archivedSessionIds}
                 sessionOrderByAccount={sessionOrderByAccount}
                sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                syncSessionOrderAccount={actions.syncSessionOrderAccount}
                setSessionOrder={actions.setSessionOrder}
                t={t}
              />
            )
            : (
              <ProjectTreeBody
                 snapshot={projectRailSnapshot}

                open={open}
                forkSession={forkSession}






                workspaces={workspaces}
                orderBy={orderBy}
                sessionOrderByAccount={sessionOrderByAccount}
                setSessionOrder={actions.setSessionOrder}
                insertSessionBefore={insertSessionBefore}
                 onToggleProject={(key, expanded) => { actions.setGroupExpanded(repoExpansionKey(key), expanded) }}
                onToggleWorktree={(key, expanded) => { actions.setGroupExpanded(worktreeExpansionKey(key), expanded) }}
                onSetTab={actions.setActiveTab}
                 onAction={dispatchProjectTreeAction}











                onNewGroup={openNewGroup}
                onRenameGroup={(tab) => { openRenameGroup(tab.id) }}
                onRemoveGroup={(tab) => { actions.removeGroup(tab.id) }}







                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}



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
          onChange={(e) => { setRenameDraft(e.target.value);  }}
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
          <FieldError className={css.renameError}>{t('conflict.named', { name: renameTrimmed })}</FieldError>
        )}
        {renameError !== null && <FieldError className={css.renameError}>{renameError}</FieldError>}
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
        {sessionRenameError !== null && <FieldError className={css.renameError}>{sessionRenameError}</FieldError>}
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
              disabled={deleting || (deletePhysical && deletePhysicalPreview?.dirty === true)}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {/* Opt-in physical deletion (linked Git rows only, default off):
            escalating to `git worktree remove` is a deliberate choice, never
            the silent default of removing a registration. */}
        {deleteTarget?.physicalAvailable === true && (
          <label className={css.deletePhysicalRow}>
            <input
              type="checkbox"
              checked={deletePhysical}
              disabled={deleting}
              onChange={event => { toggleDeletePhysical(event.currentTarget.checked) }}
            />
            <span>
              {t('delete.physical')}
              {deletePhysical && deletePhysicalPreview?.dirty === true && (
                <span className={css.deletePhysicalDirty} role="alert">
                  {' '}{t('worktree.removePhysical.dirty')}
                </span>
              )}
            </span>
          </label>
        )}
        {deleting && <StatusLine className={css.deleteStatus} tone="loading">{t('delete.pending')}</StatusLine>}
        {deleteError !== null && <FieldError className={css.renameError}>{deleteError}</FieldError>}
      </Modal>

      <NewWorktreeDialog
        target={newWtTarget}
        t={t}
        fetchDefaults={fetchWorktreeDefaults}
        fetchBranches={fetchBranches}
        createWorktree={createWorktree}
        registerWorkspace={path => createWorkspace({ path })}
        onCreated={() => { worktreeLayouts.refresh() }}
        onClose={() => { setNewWtTarget(null) }}
      />


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

      {/* Rename worktree alias (registration-less rows; titled as the one
          rename verb — worktree = workspace). */}
      <Modal
        open={worktreeAliasTarget !== null}
        onClose={closeRenameWorktree}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" onClick={closeRenameWorktree}>{t('cancel')}</Button>
            <Button variant="primary" onClick={confirmRenameWorktree}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={worktreeAliasDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          onChange={(e) => { setWorktreeAliasDraft(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmRenameWorktree() }}
        />
      </Modal>

      {/* Project icon modal */}
      <ProjectIconModal
        open={iconModalProject !== null}
        project={iconModalProject}
        onClose={() => { setIconModalProject(null) }}
        onSetBuiltin={(name) => {
          if (iconModalProject !== null) actions.setProjectIconOverride(iconModalProject.repoRoot, { kind: 'builtin', name })
        }}
        onUploadPng={(dataUrl) => {
          if (iconModalProject !== null) actions.setProjectIconOverride(iconModalProject.repoRoot, { kind: 'upload', mime: 'image/png', data: dataUrl })
        }}
        onRefresh={() => { setIconRevision(r => r + 1) }}
        onReset={() => {
          if (iconModalProject !== null) actions.setProjectIconOverride(iconModalProject.repoRoot, undefined)
        }}
        t={t}
      />

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

      <RiskConfirmation
        open={physicalRemoveTarget !== null && physicalRemovePreview !== null}
        title={t('worktree.removePhysical')}
        description={physicalRemoveTarget === null || physicalRemovePreview === null
          ? ''
          : t('worktree.removePhysical.desc', {
            path: physicalRemoveTarget.path,
            workspaces: physicalRemoveTarget.workspaceCount,
            sessions: physicalRemoveTarget.sessionCount,
            dirty: physicalRemovePreview.dirty ? t('worktree.removePhysical.dirty') : '',
          })}
        acknowledgeLabel={t('worktree.removePhysical.ack')}
        cancelLabel={t('cancel')}
        confirmLabel={physicalRemovePending ? t('worktree.removePhysical.pending') : t('worktree.removePhysical.confirm')}
        acknowledged={physicalRemoveAcknowledged}
        disabled={physicalRemovePending}
        onAcknowledgedChange={setPhysicalRemoveAcknowledged}
        onCancel={closePhysicalRemove}
        onConfirm={confirmPhysicalRemove}
      />
      {physicalRemoveTarget !== null && physicalRemovePreview === null && physicalRemoveError !== null && (
        <Modal
          open
          onClose={closePhysicalRemove}
          closeLabel={t('close')}
          title={t('worktree.removePhysical')}
          footer={<Button variant="outline" onClick={closePhysicalRemove}>{t('close')}</Button>}
        >
          <FieldError className={css.renameError}>{physicalRemoveError}</FieldError>
        </Modal>
      )}
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
        {removeProjectError !== null && <FieldError className={css.renameError}>{removeProjectError}</FieldError>}
      </Modal>
    </div>
  )
}
