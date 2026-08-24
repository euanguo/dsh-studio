/**
 * Commit-history file list primitives: the ordered rows inside an expanded
 * history entry and the committed-changes section. Split out of
 * workspace-panel.tsx so the review panel entry stays an orchestrator.
 */
import {
  type CSSProperties,
} from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import { basename } from '@dsh-studio/shared/path'
import {
  FileGlyph,
  IconChevronDown,
  IconChevronRight,
} from '@dsh-studio/shared/tabler-icons'
import { FilenameLabel } from '@dsh-studio/shared/filename-label'
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@dsh-studio/shared/ui'
import type {
  WorkspaceChange,
} from '../protocol.ts'
import type { CapabilitiesGitCommitFile } from './sidebar-api.ts'
import type { WorkspaceMessage } from './i18n.ts'
import {
  buildSourceControlTree,
  flattenSourceControlTree,
} from './source-control/source-control-tree.ts'
import type { SourceControlListMode } from './source-control/source-control-view-model.ts'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function actionLabelForConfirmation(
  kind: 'abort-merge' | 'abort-rebase',
  t: Translate<WorkspaceMessage>,
): string {
  return kind === 'abort-merge' ? t('workspace.commit-abort-merge') : t('workspace.commit-abort-rebase')
}

/** Lazy-loaded file list for one expanded history row. */
export type CommitFilesState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; entries: readonly CapabilitiesGitCommitFile[] }

/** The committed-changes projection (files in local commits ahead of the
 *  branch upstream). `none` = no upstream to compare against. */
export type CommittedState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; baseRef: string; entries: readonly CapabilitiesGitCommitFile[] }

function commitFileName(path: string): string {
  return basename(path)
}

function commitFileStatusWord(status: string): string {
  if (status === 'A') return 'added'
  if (status === 'D') return 'deleted'
  if (status === 'R') return 'renamed'
  if (status === 'C') return 'copied'
  return 'modified'
}

export type CommitFileRow =
  | { kind: 'file'; key: string; path: string; status: string; additions: number; deletions: number; depth: number }
  | { kind: 'directory'; key: string; name: string; depth: number; fileCount: number; expanded: boolean }

/** Build the visible commit-file row stream, following the change list's
 *  flat/tree mode (directory grouping is re-used from the source-control
 *  tree model so both lists indent identically). */
export function commitFileRows(
  files: readonly CapabilitiesGitCommitFile[],
  mode: SourceControlListMode,
  collapsedDirs: ReadonlySet<string>,
  keyPrefix: string,
): CommitFileRow[] {
  if (mode === 'flat') {
    return files.map(file => ({
      kind: 'file',
      key: `file:${file.path}`,
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      depth: 0,
    }))
  }
  const fileByPath = new Map(files.map(file => [file.path, file] as const))
  // The tree builder only reads `path`; the real status/counts are looked up
  // on render from the commit-file entries.
  const changes: WorkspaceChange[] = files.map(file => ({
    path: file.path,
    oldPath: null,
    status: 'modified',
    staged: false,
    additions: 0,
    deletions: 0,
  }))
  const tree = buildSourceControlTree(changes)
  const rows: CommitFileRow[] = []
  for (const node of flattenSourceControlTree(tree, collapsedDirs, keyPrefix)) {
    if (node.kind === 'file') {
      const file = fileByPath.get(node.path)
      rows.push({
        kind: 'file',
        key: node.key,
        path: node.path,
        status: file?.status ?? 'M',
        additions: file?.additions ?? 0,
        deletions: file?.deletions ?? 0,
        depth: node.depth,
      })
    } else {
      rows.push({
        kind: 'directory',
        key: node.key,
        name: node.name,
        depth: node.depth,
        fileCount: node.fileCount,
        expanded: !collapsedDirs.has(keyPrefix + node.key),
      })
    }
  }
  return rows
}

/** The inline file list under an expanded history row (orca parity): click a
 *  file → its single diff in the center; the commit row's own "view all"
 *  icon opens the whole-commit diff instead. `nested` marks rows that live
 *  under a commit row (extra chevron-column indent); the committed-changes
 *  section passes nested=false so its rows align with the change list. */
export function CommitFilesBody({
  state,
  mode,
  collapsedDirs,
  onToggleDir,
  onOpenFile,
  t,
  keyPrefix,
  nested = true,
}: {
  state: CommitFilesState | undefined
  mode: SourceControlListMode
  collapsedDirs: ReadonlySet<string>
  onToggleDir(key: string): void
  onOpenFile(path: string): void
  t: Translate<WorkspaceMessage>
  keyPrefix: string
  nested?: boolean
}): JSX.Element {
  if (state === undefined || state.status === 'loading') {
    return (
      <div className={surfaceCss["dsh-studio-review-commit-files"]}>
        <LoadingState label={t('overlay.loading')} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={surfaceCss["dsh-studio-review-commit-files"]}>
        <ErrorState message={state.error} />
      </div>
    )
  }
  if (state.entries.length === 0) {
    return (
      <div className={surfaceCss["dsh-studio-review-commit-files"]}>
        <EmptyState title={t('workspace.commit-no-files')} />
      </div>
    )
  }
  const rows = commitFileRows(state.entries, mode, collapsedDirs, keyPrefix)
  const sectionModifier = nested ? '' : ' is-section'
  return (
    <div className={surfaceCss["dsh-studio-review-commit-files"]}>
      {rows.map(row => row.kind === 'directory' ? (
        <button
          key={row.key}
          type="button"
          className={`${surfaceCss["dsh-studio-review-commit-dir"]}${sectionModifier}`}
          style={{ '--tree-depth': row.depth } as CSSProperties}
          onClick={() => { onToggleDir(row.key) }}
        >
          {row.expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span className={surfaceCss["dsh-studio-review-commit-dir-name"]}>{row.name}</span>
          <span className="dsh-studio-workspace-count">{row.fileCount}</span>
        </button>
      ) : (
        <button
          key={row.key}
          type="button"
          className={`${surfaceCss["dsh-studio-review-commit-file"]}${sectionModifier}`}
          title={row.path}
          style={{ '--tree-depth': row.depth } as CSSProperties}
          onClick={() => { onOpenFile(row.path) }}
        >
          <FileGlyph path={row.path} kind="file" />
          <FilenameLabel name={commitFileName(row.path)} title={row.path} />
          {(row.additions > 0 || row.deletions > 0) && (
            <span className={surfaceCss["dsh-studio-sc-stat"]} aria-hidden="true">
              {row.additions > 0 && <em className={surfaceCss["dsh-studio-sc-stat-add"]}>+{row.additions}</em>}
              {row.deletions > 0 && <em className={surfaceCss["dsh-studio-sc-stat-del"]}>−{row.deletions}</em>}
            </span>
          )}
          <span className={`dsh-studio-sc-mark is-${commitFileStatusWord(row.status)}`}>
            {row.status === 'T' ? 'M' : row.status}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Re-exported because callers (workspace-panel, keyboard handling) use it. */
export { actionLabelForConfirmation }