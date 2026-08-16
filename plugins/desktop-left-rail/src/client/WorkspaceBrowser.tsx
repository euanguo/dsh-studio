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
  Button, HoverCard, Menu, Modal, StateDot, Tooltip,
  IconArchiveOutline20, IconBranchOutline16, IconChevronDownOutline14, IconCloseFill14, IconEditOutline16,
  IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16, IconPersonalizationOutline16,
  IconPlusOutline16, IconProjectAddOutline16, IconSearchOutline16, IconTrashOutline16,
  IconTriangleRightFill14, type MenuEntry, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionId, SessionListState, SessionSearchResultItem, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { SessionNode, SessionOrderBy } from './tree.ts'
import { deriveFlat, deriveGroups, deriveSearchResults, UNGROUPED_KEY } from './tree.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './rows/Rows.tsx'
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import { ProjectTreeBody } from './WorkspaceBrowserProjectTree.tsx'
import { createWorktree, useWorktreeLayouts, fetchBranches } from './worktree-api.ts'
import { loadLeftRailSettings, saveLeftRailSettings } from './left-rail-settings.ts'
import { copyText } from '../../../shared/copy-text.ts'
import { toast } from '../../../shared/toast.tsx'
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
/** Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

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
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Reconcile a stored view order with the Workspace's current session account. */
function reconciledSessionOrder(sessionIds: readonly SessionId[], stored: readonly string[] | undefined): SessionId[] {
  if (stored === undefined) return [...sessionIds]
  const byId = new Map(sessionIds.map(id => [id as string, id]))
  const ordered: SessionId[] = []
  const included = new Set<string>()
  for (const key of stored) {
    const id = byId.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  for (const id of sessionIds) {
    if (included.has(id)) continue
    ordered.push(id)
  }
  return ordered
}

/** Newest update first with stable Session identity as the tie-break. */
function compareSessionRecency(a: SessionId, b: SessionId, byId: SessionListState['byId']): number {
  const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt
  return a < b ? -1 : 1
}

/** Reconcile one editable order account and apply its activity-promotion policy. */
function nextSessionOrderAccount({
  sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency,
}: {
  sessionIds: readonly SessionId[]
  previousOrder: readonly string[] | undefined
  previousUpdatedAt: Readonly<Record<string, number>>
  list: SessionListState
  orderBy: SessionOrderBy
  sortByRecency: boolean
}): { order: SessionId[]; updatedAt: Record<string, number>; changed: boolean } {
  let order = reconciledSessionOrder(sessionIds, previousOrder)
  if (sortByRecency) {
    order.sort((a, b) => compareSessionRecency(a, b, list.byId))
  } else if (orderBy === 'updated') {
    const promoted = sessionIds
      .filter((id) => {
        const session = list.byId[id]
        return session !== undefined
          && (previousUpdatedAt[id] === undefined || session.updatedAt > previousUpdatedAt[id])
      })
      .sort((a, b) => compareSessionRecency(a, b, list.byId))
    if (promoted.length > 0) {
      const promotedIds = new Set(promoted)
      order = [...promoted, ...order.filter(id => !promotedIds.has(id))]
    }
  }
  const updatedAt: Record<string, number> = {}
  for (const id of sessionIds) {
    const session = list.byId[id]
    if (session !== undefined) updatedAt[id] = session.updatedAt
  }
  const orderChanged = previousOrder === undefined
    || order.length !== previousOrder.length
    || order.some((id, index) => id !== previousOrder[index])
  const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length
    || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp)
  return { order, updatedAt, changed: orderChanged || timestampsChanged }
}

/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }: {
  groupBy: 'workspace' | 'flat'
  orderBy: SessionOrderBy
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: SessionOrderBy) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
      ]}
      selectedIds={[groupBy, orderBy]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={cn(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side from the full rendered workspace group. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'startSession' | 'open' | 'forkSession'
  | 'insertWorkspaceBefore' | 'insertSessionBefore' | 't'
> & {
  workspaces: readonly WorkspaceView[]
  /** Explicit persisted zero-or-five-session state by Workspace group. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's zero-or-five-session state. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Shared editable orders used by Workspace groups and the flat-list account. */
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  /** Last update timestamps observed for one-time recent-update promotions. */
  sessionUpdatedAtByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Replace one shared order and its observed timestamps. */
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: string[]) => void
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Session order behavior: fixed after edits, or additionally promoted by user activity. */
  orderBy: SessionOrderBy
}

/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
function SessionTree({
  useSessions, startSession, open, forkSession, workspaces, archivedSessionIds,
  onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive,
  insertWorkspaceBefore, insertSessionBefore, orderBy,
  groupExpansion, setGroupExpanded,
  sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t,
}: SessionTreeProps) {
  const list = useSessions(s => s)
  const current = list.current
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<string[]>([])
  // Transient drag marker state; the selected mode owns the resulting order.
  const [drag, setDrag] = useState<DragState | null>(null)
  const sessionDropCommitted = useRef(false)
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  const workspaceDropCommitted = useRef(false)
  const previousOrderBy = useRef(orderBy)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  const currentGroup = current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId as string | undefined)
      ?? UNGROUPED_KEY
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  const expandedGroups = useMemo(
    () => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key),
    [groupExpansion],
  )
  const ungroupedSessionIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
  }, [list, workspaces])
  useEffect(() => {
    if (list.phase !== 'ready') return
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const accounts = [
      ...workspaces.map(workspace => ({
        key: workspace.workspaceId as string,
        sessionIds: workspace.sessionIds.filter(id => list.byId[id] !== undefined),
      })),
      { key: UNGROUPED_KEY, sessionIds: ungroupedSessionIds },
    ]
    for (const { key, sessionIds } of accounts) {
      const previousOrder = sessionOrderByAccount[key]
      const previousUpdatedAt = sessionUpdatedAtByAccount[key] ?? {}
      const next = nextSessionOrderAccount({
        sessionIds,
        previousOrder,
        previousUpdatedAt,
        list,
        orderBy,
        sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
      })
      if (next.changed) {
        syncSessionOrderAccount(key, next.order.map(id => id as string), next.updatedAt)
      }
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, ungroupedSessionIds, workspaces])
  const orderedWorkspaces = useMemo(() => {
    return workspaces.map((workspace) => {
      const stored = sessionOrderByAccount[workspace.workspaceId as string]
      const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored)
      return { ...workspace, sessionIds }
    })
  }, [sessionOrderByAccount, workspaces])
  const orderedUngroupedSessionIds = useMemo(
    () => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[UNGROUPED_KEY]),
    [sessionOrderByAccount, ungroupedSessionIds],
  )
  const groups = useMemo(
    () => deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
      expandedGroups,
      ...(sessionOrderByAccount[UNGROUPED_KEY] === undefined
        ? {}
        : { ungroupedOrder: sessionOrderByAccount[UNGROUPED_KEY] }),
    }),
    [list, orderedWorkspaces, archivedSessionIds, expandedGroups, sessionOrderByAccount],
  )
  const now = Date.now()
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    const targetIndex = group.sessions.findIndex(session => session.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : group.sessions[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = group.sessions.findIndex(session => session.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined
      ? group.sessions.length
      : group.sessions.findIndex(session => session.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? orderedUngroupedSessionIds
      : orderedWorkspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    const nextOrder = accountSessionIds.filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id as string))
    if (orderBy === 'updated' || activeDrag.accountKey === UNGROUPED_KEY) return
    insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, anchor).catch((reason: unknown) => {
      console.warn('session reorder rejected:', reason)
    })
  }
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    const rowIndex = workspaces.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = workspaces.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined
      ? workspaces.length
      : workspaces.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === groups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  return (
    <div className={cn(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <div
        className={cn(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        role="tree"
        aria-label={t('section.sessions')}
      >
        {groups.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {groups.map((group) => {
          const workspaceId = group.workspaceId
          const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
            ? workspaceDrag.over.half
            : null
          const workspaceDragProps = workspaceId === undefined ? undefined : {
            start: () => {
              workspaceDropCommitted.current = false
              setWorkspaceDrag({ workspaceId, over: null })
            },
            end: () => {
              if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
              } else {
                setWorkspaceDrag(null)
              }
              workspaceDropCommitted.current = false
            },
          }
          const hoverWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              setWorkspaceDrag(active => active === null
                ? active
                : { ...active, over: { id: workspaceId, half } })
            }
          const dropWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              if (workspaceDrag === null) return
              commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
            }
          return (
          // Group section: header row + expanded top-level session rows. The
          // inter-group breathing room is the section's own margin
          // (WorkspaceBrowser.module.css).
            <div
              key={group.key}
              className={cn(
                css.groupSection,
                workspaceMarker === 'before' && css.workspaceDropBefore,
                workspaceMarker === 'after' && css.workspaceDropAfter,
              )}
              onDragOver={workspaceDrag === null || hoverWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  hoverWorkspace(workspaceGroupHalf(e))
                }}
              onDrop={workspaceDrag === null || dropWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  dropWorkspace(workspaceGroupHalf(e))
                }}
            >
              <ProjectRowItem
                group={group}
                t={t}
                onToggle={() => {
                  if (group.expanded) {
                    setExpandedSessionGroups(keys => keys.filter(key => key !== group.key))
                  }
                  setGroupExpanded(group.key, !group.expanded)
                }}
                onCreate={() => {
                  if (group.workspaceId !== undefined) {
                    setGroupExpanded(group.key, true)
                    startSession(group.workspaceId)
                  }
                }}
                drag={workspaceDragProps}
                actions={group.workspaceId === undefined
                  ? undefined
                  : {
                    rename: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                    },
                    delete: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                    },
                  }}
              />
              {(expandedSessionGroups.includes(group.key)
                ? group.sessions
                : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)
              ).map((node) => {
              // Session drag never leaves its group. Ungrouped writes only the
              // browser-local account; real Workspaces may also write Host order.
                const sameGroupDrag = drag !== null && drag.accountKey === group.key
                const dragProps = {
                  start: () => {
                    sessionDropCommitted.current = false
                    setDrag({ accountKey: group.key, sessionId: node.id, over: null })
                  },
                  active: sameGroupDrag,
                  marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                  hover: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                    setDrag(d => (d === null ? d : { ...d, over: { id: node.id, half } }))
                  },
                  drop: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                    if (drag === null) return
                    commitSessionDrag(drag, { id: node.id, half })
                  },
                  end: () => {
                    if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
                    else setDrag(null)
                    sessionDropCommitted.current = false
                  },
                }
                return (
                  <SessionNodeItem
                    key={node.id}
                    node={node}
                    currentId={current}
                    now={now}
                    onOpen={open}
                    onRename={onSessionRename}
                    onFork={forkSession}
                    onArchive={onSessionArchive}
                    drag={dragProps}
                    t={t}
                  />
                )
              })}
              {group.sessions.length > COLLAPSED_SESSION_LIMIT && (
                <button
                  type="button"
                  className={css.sessionOverflowButton}
                  aria-expanded={expandedSessionGroups.includes(group.key)}
                  onClick={() => { setExpandedSessionGroups(keys => toggled(keys, group.key)) }}
                >
                  {expandedSessionGroups.includes(group.key)
                    ? t('sessions.collapse')
                    : t('sessions.expand', { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({
  useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds,
  orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t,
}: Pick<
  SessionTreeProps,
  | 'useSessions'
  | 'open'
  | 'forkSession'
  | 'onSessionRename'
  | 'onSessionArchive'
  | 'archivedSessionIds'
  | 'orderBy'
  | 'sessionOrderByAccount'
  | 'sessionUpdatedAtByAccount'
  | 'syncSessionOrderAccount'
  | 'setSessionOrder'
  | 't'
>) {
  const list = useSessions(s => s)
  const baseRows = useMemo(
    () => deriveFlat(list, archivedSessionIds),
    [list, archivedSessionIds],
  )
  const sessionIds = useMemo(() => baseRows.map(row => row.id), [baseRows])
  const previousOrderBy = useRef(orderBy)
  useEffect(() => {
    if (list.phase !== 'ready') return
    const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
    const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {}
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const next = nextSessionOrderAccount({
      sessionIds,
      previousOrder,
      previousUpdatedAt,
      list,
      orderBy,
      sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
    })
    if (next.changed) {
      syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map(id => id as string), next.updatedAt)
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, sessionIds, syncSessionOrderAccount])
  const rows = useMemo(() => {
    const byId = new Map(baseRows.map(row => [row.id, row]))
    return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY])
      .flatMap((id) => {
        const row = byId.get(id)
        return row === undefined ? [] : [row]
      })
  }, [baseRows, sessionOrderByAccount, sessionIds])
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const targetIndex = rows.findIndex(row => row.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  const now = Date.now()
  return (
    <div className={cn(css.treeBody, css.wide)}>
      <div className={cn(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {rows.map((node) => {
          const active = drag !== null
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={list.current}
              now={now}
              onOpen={open}
              onRename={onSessionRename}
              onFork={forkSession}
              onArchive={onSessionArchive}
              flat
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag(current => current === null ? current : { ...current, over: { id: node.id, half } })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              }}
              t={t}
            />
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  open,
  workspaces,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  t,
}: Pick<SessionTreeProps, 'useSessions' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const list = useSessions(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit),
    [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'

  return (
    <div className={cn(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={list.current}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && (
          <div className={css.searchStatus} role="status">{t('search.pending')}</div>
        )}
        {failed && (
          <div className={css.searchWarning} role="status">
            {t('search.unavailable')}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
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
      saveLeftRailSettings({ activeTab, projectGroup, groupIds, groupLabels, projectAlias }, settingsRevision.current)
        .then((view) => { settingsRevision.current = view.revision })
        .catch(() => { /* revision conflict: next save retries with the latest */ })
    }, 300)
    return () => { window.clearTimeout(timer) }
  }, [activeTab, projectGroup, groupIds, groupLabels, projectAlias])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    // Retain the session-order accounts (workspace ids + ungrouped/flat) and
    // the project/worktree expansion keys (repo roots + worktree paths).
    const expansionKeys = new Set<string>([UNGROUPED_KEY, FLAT_SESSION_ORDER_KEY])
    for (const workspace of workspaces) {
      expansionKeys.add(workspace.workspaceId as string)
      const layout = worktreeLayouts.layouts.get(workspace.path)
      if (layout !== null && layout !== undefined) {
        expansionKeys.add(layout.repoRoot)
        for (const wt of layout.worktrees) expansionKeys.add(wt.path)
      } else {
        expansionKeys.add(workspace.path)
      }
    }
    actions.retainAccountKeys([...expansionKeys])
  }, [actions.retainAccountKeys, workspacePhase, workspaces, worktreeLayouts.layouts])
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
  const [removeProjectTarget, setRemoveProjectTarget] = useState<{ repoRoot: string; label: string; count: number } | null>(null)
  const [removeProjectPending, setRemoveProjectPending] = useState(false)
  const [removeProjectError, setRemoveProjectError] = useState<string | null>(null)
  // Copy-path feedback rides the shared app toast (plugins/shared/toast.tsx);
  // the sidebar plugin mounts its host, so this rail only publishes.
  const onCopy = (text: string): void => {
    void copyText(text).then(ok => {
      toast(ok ? 'success' : 'error', ok ? t('hover.copied') : t('copy.failed'))
    })
  }

  const slug = (value: string): string => value.trim().replace(/[\\/:*?"<>|\s]+/g, '-')
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
      actions.createGroup(`group-${Date.now()}`, label)
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
                view={{
                  expanded: Object.entries(groupExpansion).filter(([, v]) => v).map(([k]) => k),
                  activeTab,
                  projectGroup,
                  groupIds,
                  groupLabels,
                  projectAlias,
                }}
                onToggleProject={(key, expanded) => { actions.setGroupExpanded(key, expanded) }}
                onToggleWorktree={(key, expanded) => { actions.setGroupExpanded(key, expanded) }}
                onSetTab={actions.setActiveTab}
                onNewWorktree={openNewWorktree}
                onRemoveProject={onRemoveProjectRequest}
                onMoveProject={actions.moveProjectToGroup}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Context: which repo / current branch this worktree forks from. */}
            <div style={{ fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' }}>
              {t('wt.basedOn', { name: newWtTarget.label })}
              {newWtTarget.currentBranch !== null && (
                <span style={{ color: 'var(--dsw-alias-label-primary)', fontWeight: 500 }}>
                  {' · '}{newWtTarget.currentBranch}
                </span>
              )}
            </div>

            {/* Existing worktrees (read-only inventory). */}
            {newWtTarget.existing.length > 0 && (
              <div>
                <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4 }}>{t('wt.existing')}</div>
                {newWtTarget.existing.map(wt => (
                  <div key={wt.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)' }}>
                    <IconFolderClose16 size={14} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wt.label}</span>
                    {wt.branch !== null && <span style={{ fontSize: 11, opacity: 0.75 }}>{wt.branch}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Branch picker: existing branches via Menu, or a new name. */}
            <div>
              <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4 }}>{t('wt.branch')}</div>
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
                    className={css.renameInput}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: 36, padding: '0 12px', cursor: 'pointer', textAlign: 'left', fontSize: 14 }}
                    onClick={() => { setNewWtBranchMenuOpen(v => !v) }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {branchIsNew ? (newWtNewBranch === '' ? t('wt.newBranch') : newWtNewBranch) : newWtPickBranch}
                    </span>
                    <IconChevronDownOutline14 />
                  </button>
                )}
              />
              {branchIsNew && (
                <input
                  className={css.renameInput}
                  style={{ height: 36, marginTop: 6, fontSize: 14 }}
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
              <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4 }}>{t('wt.path')}</div>
              <input
                className={css.renameInput}
                style={{ height: 36, fontSize: 13 }}
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
