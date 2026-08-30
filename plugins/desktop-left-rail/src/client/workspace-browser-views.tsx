/**
 * The workspace-browser viewing bodies: flat list, search results and the
 * view-options menu, plus their shared order/recency helpers. Split from
 * WorkspaceBrowser.tsx so the browsing region owner keeps only composition,
 * persistence and dialog wiring.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Menu, Tooltip, IconPersonalizationOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionId, SessionSearchResultItem, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { SessionNode, SessionOrderBy } from './tree.ts'
import { deriveFlat, deriveSearchResults } from './tree.ts'
import { insertSessionInOrder, nextSessionOrderAccount, reconciledSessionOrder } from './session-order.ts'
import { SearchResultItem, SessionNodeItem } from './rows/Rows.tsx'
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import { WorkspaceBrowserCss as css } from './styles.ts'
import { cn } from './shim/cn.ts'
import { EmptyState, LoadingState, ScrollArea, StatusLine } from '@dsh-studio/shared/ui'

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
export function useNativeDragAcceptance(active: boolean): void {
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

/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
export function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }: {
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

/** Props shared by the flat-list and search-query viewing bodies. */
export interface BrowserViewProps {
  /** Session-list snapshot hook (the visibility authority for these bodies). */
  useSessions: WorkspaceBrowserProps['useSessions']
  open: WorkspaceBrowserProps['open']
  forkSession: WorkspaceBrowserProps['forkSession']
  /** Open the browser-owned session rename dialog (row menu action). */
  onSessionRename: (sessionId: SessionId, currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionId) => void
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionId[]
  /** Session order behavior: fixed after edits, or additionally promoted by user activity. */
  orderBy: SessionOrderBy
  /** Shared editable order for the flat-list account. */
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Replace one shared order and its observed timestamps. */
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: string[]) => void
  t: WorkspaceBrowserProps['t']
}

/** In-flight flat-list row drag: source identity plus the current insert marker. */
interface FlatDragState {
  sessionId: SessionId
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionId; half: 'before' | 'after' } | null
}

/** The flat "In one list" body: every session is one draggable top-level row. */
export function FlatList({
  useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds,
  orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t,
}: BrowserViewProps) {
  // Per-field subscriptions: an identity selector would re-render the whole
  // list on every unrelated store change.
  const byId = useSessions(s => s.byId)
  const ids = useSessions(s => s.ids)
  const current = useSessions(s => s.current)
  const phase = useSessions(s => s.phase)
  const subagentsByParent = useSessions(s => s.subagentsByParent)
  const jobsBySession = useSessions(s => s.jobsBySession)
  const currentAddress = useSessions(s => s.currentAddress)
  const list = useMemo(
    () => ({ byId, ids, current, phase, subagentsByParent, jobsBySession, currentAddress }),
    [byId, ids, current, phase, subagentsByParent, jobsBySession, currentAddress],
  )
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
  const [drag, setDrag] = useState<FlatDragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const commitDrag = (activeDrag: FlatDragState, over: NonNullable<FlatDragState['over']>): void => {
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
    // Same insert-before-anchor semantics as every order surface
    // (session-order.ts insertSessionInOrder).
    const nextOrder = insertSessionInOrder(
      rows.map(row => row.id),
      activeDrag.sessionId,
      anchor,
    )
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  // Keyboard reorder twin of drag in the flat list (browser-local account).
  const moveFlatSession = (sessionId: SessionNode['id'], verb: 'up' | 'down'): void => {
    const account = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
    if (account === undefined) return
    const index = account.indexOf(sessionId as string)
    if (index === -1) return
    const neighbor = verb === 'up' ? account[index - 1] : account[index + 1]
    if (neighbor === undefined) return
    const anchor = verb === 'up' ? neighbor : account[index + 2]
    const nextOrder = insertSessionInOrder(account as readonly SessionId[], sessionId as SessionId, anchor as SessionId)
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  const now = Date.now()
  // The flat list is the unbounded session stream (the group view owns its
  // per-group overflow crop), so its rows are virtualized
  // with @tanstack/react-virtual: the ScrollArea ref is the scrolling
  // viewport, and each row's 2px inter-row rhythm (previously a `.flatList
  // > * + *` sibling margin) is folded into the fixed item size — absolute
  // items ignore sibling margins, and the rows are uniform 30px.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SESSION_ROW_ITEM_SIZE,
    overscan: 12,
    getItemKey: index => rows[index]?.id ?? index,
  })
  const virtualRows = virtualizer.getVirtualItems()
  return (
    <div className={cn(css.treeBody, css.wide)}>
      <ScrollArea
        ref={scrollRef}
        className={css.listScroll}
        viewportClassName={css.list}
        viewportProps={{ role: 'tree', 'aria-label': t('section.sessions') }}
      >
        {rows.length === 0 && (
          <EmptyState className={css.empty} title={t('empty.none')} />
        )}
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
        >
          {virtualRows.map((virtualRow) => {
            const node = rows[virtualRow.index]
            if (node === undefined) return null
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <SessionNodeItem
                  node={node}
                  currentId={list.current}
                  now={now}
                  onOpen={open}
                  onRename={onSessionRename}
                  onFork={forkSession}
                  onArchive={onSessionArchive}
                  onMove={verb => { moveFlatSession(node.id, verb) }}
                  flat
                  drag={{
                    start: () => {
                      dropCommitted.current = false
                      setDrag({ sessionId: node.id, over: null })
                    },
                    active: drag !== null,
                    marker: drag !== null && drag.over?.id === node.id ? drag.over.half : null,
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
              </div>
            )
          })}
        </div>
      </ScrollArea>
      <span className={css.fade} />
    </div>
  )
}

export interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
export function SearchResults({
  useSessions,
  open,
  workspaces,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  header,
  t,
}: Pick<BrowserViewProps, 'useSessions' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
  /** Optional block rendered above the session rows (project matches). */
  header?: ReactNode
}) {
  // Per-field subscriptions: an identity selector would re-render the whole
  // search view on every unrelated store change.
  const byId = useSessions(s => s.byId)
  const ids = useSessions(s => s.ids)
  const current = useSessions(s => s.current)
  const phase = useSessions(s => s.phase)
  const subagentsByParent = useSessions(s => s.subagentsByParent)
  const jobsBySession = useSessions(s => s.jobsBySession)
  const currentAddress = useSessions(s => s.currentAddress)
  const list = useMemo(
    () => ({ byId, ids, current, phase, subagentsByParent, jobsBySession, currentAddress }),
    [byId, ids, current, phase, subagentsByParent, jobsBySession, currentAddress],
  )
  // Stable reference when the remote page still matches the query, so the
  // derive memo below only re-runs when the query or the page actually moves
  // (the fallback "loading" projection is memoized once per query mismatch).
  const currentRemote = useMemo<RemoteSearchState>(
    () => remote.query === query
      ? remote
      : { query, status: 'loading' as const, items: [], hasMore: false },
    [query, remote],
  )
  const results = useMemo(
    () => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit),
    [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'

  return (
    <div className={cn(css.treeBody, css.wide)}>
      <ScrollArea className={css.listScroll} viewportClassName={css.list}>
        {header}
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
        {pending && <LoadingState className={css.searchStatus} label={t('search.pending')} />}
        {failed && <StatusLine className={css.searchWarning} tone="warning">{t('search.unavailable')}</StatusLine>}
        {!pending && results.items.length === 0 && (
          <EmptyState className={css.empty} title={t('search.noMatches')} />
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </ScrollArea>
      <span className={css.fade} />
    </div>
  )
}

/** Virtualized flat-list item size: 30px row + 2px inter-row rhythm
 *  (the rhythm was a sibling margin before virtualization). */
export const SESSION_ROW_ITEM_SIZE = 32
