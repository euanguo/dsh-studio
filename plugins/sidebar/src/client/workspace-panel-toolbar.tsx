/**
 * The workspace Git review panel's two bottom toolbars — the "工具条" leg of
 * the three-way workspace-panel split (面板壳 / 加载编排 / 工具条).
 *
 * Both sections are `dsh-studio-sc-toolbar`-styled collapsible blocks:
 *  - CommittedSection: the "committed changes" projection (files in local
 *    commits ahead of the branch upstream).
 *  - ReviewHistorySection: the git commit history with inline per-commit file
 *    lists (orca parity) and a draggable height handle.
 *
 * These hold ONLY presentation/UI-chrome state (collapsed flags, the expanded
 * commit id, collapsed directory keys, history height). Data arrives already
 * derived from the SourceControlRuntime; on an identity (cwd) change the shell
 * remounts the whole subtree with `key={cwd}`, so this state resets for free
 * instead of via a reset-effect (C34).
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type { CapabilitiesGitLogEntry } from './sidebar-api.ts'
import {
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconGitCommit,
  IconHistory,
} from '@dsh-studio/shared/tabler-icons'
import {
  EmptyState,
  ListRow,
  ListRowActionButton,
  ListRowBody,
  ListRowLabel,
  ListRowLabelText,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
  ScrollArea,
} from '@dsh-studio/shared/ui'
import type { SourceControlListMode } from './source-control/source-control-view-model.ts'
import { CommitFilesBody, type CommittedState, type CommitFilesState } from './commit-files.tsx'

/** Commit history panel resizer bounds (px). */
const HISTORY_HEIGHT_DEFAULT = 256
const HISTORY_HEIGHT_MIN = 96
const HISTORY_HEIGHT_MAX = 520

export interface CommittedSectionProps {
  committed: CommittedState
  listMode: SourceControlListMode
  t: Translate<WorkspaceMessage>
  onOpenAll(baseRef: string): void
  onOpenFile(baseRef: string, path: string): void
}

/** The "committed changes" collapsible section. Data comes from the runtime's
 *  retained projection; only the fold + collapsed-directory chrome is local. */
export function CommittedSection({
  committed,
  listMode,
  t,
  onOpenAll,
  onOpenFile,
}: CommittedSectionProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set())
  const toggleDir = (key: string): void => {
    setCollapsedDirs(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  if (committed.status !== 'ready' || committed.entries.length === 0) return null

  return (
    <section className={`dsh-studio-committed-section`}>
      <div
        className={`${surfaceCss["dsh-studio-sc-toolbar"]} ${surfaceCss["dsh-studio-committed-header"]}`}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => { setCollapsed(value => !value) }}
      >
        <span className={surfaceCss["dsh-studio-sc-toolbar-title"]}>
          <IconGitCommit size={14} />
          {t('workspace.committed')}
          <em>{committed.entries.length}</em>
        </span>
        <span className={surfaceCss["dsh-studio-committed-actions"]}>
          <ListRowActionButton
            aria-label={t('source-control.view-all')}
            title={t('source-control.view-all')}
            onClick={event => {
              event.stopPropagation()
              onOpenAll(committed.baseRef)
            }}
          ><IconEye size={14} /></ListRowActionButton>
          <IconChevronDown
            size={14}
            className={collapsed ? 'dsh-studio-history-chevron is-collapsed' : 'dsh-studio-history-chevron'}
          />
        </span>
      </div>
      {!collapsed && (
        <CommitFilesBody
          state={{ status: 'ready', entries: committed.entries }}
          mode={listMode}
          collapsedDirs={collapsedDirs}
          onToggleDir={toggleDir}
          onOpenFile={path => { onOpenFile(committed.baseRef, path) }}
          t={t}
          keyPrefix="committed:"
          nested={false}
        />
      )}
    </section>
  )
}

export interface ReviewHistorySectionProps {
  history: readonly CapabilitiesGitLogEntry[]
  commitFiles: ReadonlyMap<string, CommitFilesState>
  listMode: SourceControlListMode
  t: Translate<WorkspaceMessage>
  onToggleFiles(entry: CapabilitiesGitLogEntry): void
  onOpenCommitDiff(entry: CapabilitiesGitLogEntry): void
  onOpenCommitFile(entry: CapabilitiesGitLogEntry, path: string): void
}

/** The git history collapsible section: header + draggable-resize commit
 *  list, with expandable inline file rows per commit (orca parity). */
export function ReviewHistorySection({
  history,
  commitFiles,
  listMode,
  t,
  onToggleFiles,
  onOpenCommitDiff,
  onOpenCommitFile,
}: ReviewHistorySectionProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(true)
  const [height, setHeight] = useState(HISTORY_HEIGHT_DEFAULT)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Collapsed directory keys per commit file row (prefixed by hash so the
  // same path can stay open in different commits).
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set())
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  const toggleCommitFiles = (entry: CapabilitiesGitLogEntry): void => {
    setExpandedId(current => current === entry.hashFull ? null : entry.hashFull)
    onToggleFiles(entry)
  }
  const toggleDir = (key: string): void => {
    setCollapsedDirs(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const startResize = useCallback((event: ReactPointerEvent): void => {
    event.preventDefault()
    resizeRef.current = { startY: event.clientY, startHeight: height }
    const onMove = (move: PointerEvent): void => {
      const session = resizeRef.current
      if (session === null) return
      const next = session.startHeight + session.startY - move.clientY
      setHeight(Math.min(HISTORY_HEIGHT_MAX, Math.max(HISTORY_HEIGHT_MIN, next)))
    }
    const onUp = (): void => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      resizeCleanupRef.current = null
    }
    resizeCleanupRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // Pointer capture can drop mid-drag (window blur, gesture takeover).
    window.addEventListener('pointercancel', onUp)
  }, [height])
  // If the panel unmounts mid-drag the window listeners above would leak.
  useEffect(() => () => {
    resizeCleanupRef.current?.()
  }, [])

  return (
    <section className={surfaceCss["dsh-studio-review-history"]}>
      {!collapsed && (
        <div
          className={surfaceCss["dsh-studio-history-resize"]}
          role="separator"
          aria-label={t('workspace.review-history')}
          onPointerDown={startResize}
        />
      )}
      <div
        className={`${surfaceCss["dsh-studio-sc-toolbar"]} ${surfaceCss["dsh-studio-history-toggle"]}`}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => { setCollapsed(value => !value) }}
      >
        <span className={surfaceCss["dsh-studio-sc-toolbar-title"]}>
          <IconHistory size={14} />
          {t('workspace.review-history')}
          <em>{history.length}</em>
        </span>
        <IconChevronDown
          size={14}
          className={collapsed ? 'dsh-studio-history-chevron is-collapsed' : 'dsh-studio-history-chevron'}
        />
      </div>
      {!collapsed && (
        <ScrollArea
          className={surfaceCss["dsh-studio-review-commit-list"]}
          viewportClassName="dsh-studio-ui-scroll-viewport-inset"
          style={{ maxHeight: height }}
        >
          {history.map(entry => {
            const isExpanded = expandedId === entry.hashFull
            return (
              <Fragment key={entry.hashFull}>
                <ListRow
                  className={`dsh-studio-review-commit-row`}
                  selected={isExpanded}
                  title={entry.subject}
                >
                  <ListRowMain
                    className={surfaceCss["dsh-studio-sc-depth-main"]}
                    aria-expanded={isExpanded}
                    onClick={() => { toggleCommitFiles(entry) }}
                  >
                    <ListRowLeading aria-hidden="true">
                      {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </ListRowLeading>
                    <ListRowBody>
                      <ListRowLabel>
                        <ListRowLabelText>{entry.subject}</ListRowLabelText>
                      </ListRowLabel>
                    </ListRowBody>
                    <ListRowTrailing>
                      <span className={surfaceCss["dsh-studio-review-commit-author"]}>{entry.author}</span>
                      <code className={surfaceCss["dsh-studio-review-commit-hash"]}>{entry.hash}</code>
                    </ListRowTrailing>
                  </ListRowMain>
                  <ListRowTrailing>
                    <ListRowActionButton
                      aria-label={t('source-control.view-all')}
                      title={t('source-control.view-all')}
                      onClick={() => { onOpenCommitDiff(entry) }}
                    ><IconEye size={14} /></ListRowActionButton>
                  </ListRowTrailing>
                </ListRow>
                {isExpanded && (
                  <CommitFilesBody
                    state={commitFiles.get(entry.hashFull)}
                    mode={listMode}
                    collapsedDirs={collapsedDirs}
                    onToggleDir={toggleDir}
                    onOpenFile={path => { onOpenCommitFile(entry, path) }}
                    t={t}
                    keyPrefix={`commit:${entry.hashFull}:`}
                  />
                )}
              </Fragment>
            )
          })}
          {history.length === 0 && (
            <EmptyState title={t('workspace.no-commits')} />
          )}
        </ScrollArea>
      )}
    </section>
  )
}