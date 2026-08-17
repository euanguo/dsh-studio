/**
 * Source-control panel rows: collapsible sections, depth-indented directory
 * rows, and file rows with a fixed status trailing area plus a hover-overlay
 * action layer (stage / unstage / discard) that never changes row layout.
 * Right-click opens a path context menu (copy path / stage / unstage /
 * discard). Pure presentation — the row stream comes from the view model.
 *
 * Rows are built on the shared ListRow primitives (plugins/shared/list-row)
 * — the same row geometry as the file browser and every other list.
 */
import { useState, type CSSProperties } from 'react'
import type { Translate } from '@oh-dsh/shared/i18n'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCopyOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconEye,
  IconFileDiff,
  IconLayoutList,
  IconListTree,
  IconMinus,
} from '@oh-dsh/shared/icons'
import { FileGlyph } from '@oh-dsh/shared/tabler-icons'
import {
  ListRow,
  ListRowActions,
  ListRowActionButton,
  ListRowBody,
  ListRowLabel,
  ListRowLabelText,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '@oh-dsh/shared/list-row'
import { FilenameLabel } from '@oh-dsh/shared/filename-label'
import type { WorkspaceMessage } from '../i18n.ts'
import type { WorkspaceChangeStatus } from '../../protocol.ts'
import {
  type DirectoryRow,
  type FileRow,
  type SectionRow,
  type SourceControlVisibleRow,
} from './source-control-view-model.ts'
import type { SourceControlListMode } from './source-control-view-model.ts'
import type { SourceControlSectionId } from './source-control-tree.ts'

export type SourceControlPendingAction = 'stage' | 'unstage' | 'discard'

const SECTION_SYMBOL: Record<WorkspaceChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!',
}

export interface SourceControlPanelProps {
  rows: readonly SourceControlVisibleRow[]
  pendingByPath: ReadonlyMap<string, SourceControlPendingAction>
  mode: SourceControlListMode
  count: number
  t: Translate<WorkspaceMessage>
  onModeChange(mode: SourceControlListMode): void
  onToggleSection(id: SourceControlSectionId): void
  onToggleDirectory(key: string): void
  onSelectFile(path: string): void
  onOpenFile(path: string): void
  onStage(paths: readonly string[]): void
  onUnstage(paths: readonly string[]): void
  onDiscard(paths: readonly string[], label: string): void
  onViewAll(id: SourceControlSectionId): void
  onCopyPath(path: string): void
}

interface MenuState {
  x: number
  y: number
  path: string
  canStage: boolean
  canUnstage: boolean
  canDiscard: boolean
}

export function SourceControlPanel(props: SourceControlPanelProps): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const menuItems: MenuEntry[] = menu === null ? [] : [
    { id: 'copy-path', label: props.t('source-control.copy-path'), icon: <IconCopyOutline16 size={14} /> },
    ...(menu.canStage ? [{ id: 'stage', label: props.t('source-control.stage'), icon: <IconPlusOutline16 size={14} /> }] : []),
    ...(menu.canUnstage ? [{ id: 'unstage', label: props.t('source-control.unstage'), icon: <IconMinus size={14} /> }] : []),
    ...(menu.canDiscard ? [{ id: 'discard', label: props.t('source-control.discard'), icon: <IconTrashOutline16 size={14} />, danger: true }] : []),
  ]
  const handleMenuSelect = (id: string): void => {
    if (menu === null) return
    if (id === 'copy-path') props.onCopyPath(menu.path)
    else if (id === 'stage') props.onStage([menu.path])
    else if (id === 'unstage') props.onUnstage([menu.path])
    else if (id === 'discard') props.onDiscard([menu.path], menu.path)
    setMenu(null)
  }

  return (
    <div className="oh-dsh-sc-list">
      <div className="oh-dsh-sc-toolbar">
        <span className="oh-dsh-sc-toolbar-title">
          <IconFileDiff size={14} />
          {props.t('workspace.changes')}
          <em>{props.count}</em>
        </span>
        <div className="oh-dsh-sc-toolbar-modes" role="group" aria-label={props.t('source-control.mode.tree')}>
          <button
            type="button"
            aria-label={props.t('source-control.mode.flat')}
            title={props.t('source-control.mode.flat')}
            aria-pressed={props.mode === 'flat'}
            onClick={() => { props.onModeChange('flat') }}
          ><IconLayoutList size={14} /></button>
          <button
            type="button"
            aria-label={props.t('source-control.mode.tree')}
            title={props.t('source-control.mode.tree')}
            aria-pressed={props.mode === 'tree'}
            onClick={() => { props.onModeChange('tree') }}
          ><IconListTree size={14} /></button>
        </div>
      </div>
      {props.rows.map(row => (
        <SourceControlRow
          key={row.key}
          row={row}
          pending={row.kind === 'file' ? props.pendingByPath.get(row.path) ?? null : null}
          t={props.t}
          onToggleSection={props.onToggleSection}
          onToggleDirectory={props.onToggleDirectory}
          onSelectFile={props.onSelectFile}
          onOpenFile={props.onOpenFile}
          onStage={props.onStage}
          onUnstage={props.onUnstage}
          onDiscard={props.onDiscard}
          onViewAll={props.onViewAll}
          onContextMenu={(path, x, y, capabilities) => {
            setMenu({ x, y, path, ...capabilities })
          }}
        />
      ))}
      <Menu
        open={menu !== null}
        anchor={null}
        portal
        getAnchorRect={() => (menu === null ? null : new DOMRect(menu.x, menu.y, 0, 0))}
        items={menuItems}
        onSelect={handleMenuSelect}
        onClose={() => { setMenu(null) }}
      />
    </div>
  )
}

function SourceControlRow(props: {
  row: SourceControlVisibleRow
  pending: SourceControlPendingAction | null
  t: Translate<WorkspaceMessage>
  onToggleSection(id: SourceControlSectionId): void
  onToggleDirectory(key: string): void
  onSelectFile(path: string): void
  onOpenFile(path: string): void
  onStage(paths: readonly string[]): void
  onUnstage(paths: readonly string[]): void
  onDiscard(paths: readonly string[], label: string): void
  onViewAll(id: SourceControlSectionId): void
  onContextMenu(
    path: string,
    x: number,
    y: number,
    capabilities: { canStage: boolean; canUnstage: boolean; canDiscard: boolean },
  ): void
}): JSX.Element {
  const { row } = props
  if (row.kind === 'section') {
    return (
      <SectionRowView row={row} t={props.t} onToggleSection={props.onToggleSection}
        onStage={props.onStage} onUnstage={props.onUnstage} onDiscard={props.onDiscard}
        onViewAll={props.onViewAll} />
    )
  }
  if (row.kind === 'directory') {
    return (
      <DirectoryRowView row={row} t={props.t} onToggleDirectory={props.onToggleDirectory}
        onStage={props.onStage} onUnstage={props.onUnstage} onDiscard={props.onDiscard} />
    )
  }
  return (
    <FileRowView
      row={row}
      pending={props.pending}
      t={props.t}
      onSelectFile={props.onSelectFile}
      onOpenFile={props.onOpenFile}
      onStage={props.onStage}
      onUnstage={props.onUnstage}
      onDiscard={props.onDiscard}
      onContextMenu={props.onContextMenu}
    />
  )
}

function SectionRowView(props: {
  row: SectionRow
  t: Translate<WorkspaceMessage>
  onToggleSection(id: SourceControlSectionId): void
  onStage(paths: readonly string[]): void
  onUnstage(paths: readonly string[]): void
  onDiscard(paths: readonly string[], label: string): void
  onViewAll(id: SourceControlSectionId): void
}): JSX.Element {
  const { row } = props
  const canViewAll = row.id === 'staged' || row.id === 'unstaged'
  return (
    <ListRow className="oh-dsh-sc-section-row" data-section={row.id}>
      <ListRowMain
        className="oh-dsh-sc-depth-main"
        aria-expanded={row.expanded}
        onClick={() => { props.onToggleSection(row.id) }}
      >
        <ListRowLeading aria-hidden="true">
          {row.expanded ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
        </ListRowLeading>
        <ListRowBody>
          <ListRowLabel>
            <ListRowLabelText>{props.t(`source-control.section.${row.id}`)}</ListRowLabelText>
            <span className="oh-dsh-workspace-count">{row.count}</span>
          </ListRowLabel>
        </ListRowBody>
      </ListRowMain>
      <ListRowTrailing>
        {canViewAll && (
          <ListRowActionButton
            aria-label={props.t('source-control.view-all')}
            title={props.t('source-control.view-all')}
            onClick={() => { props.onViewAll(row.id) }}
          ><IconEye size={14} /></ListRowActionButton>
        )}
        <span className="oh-dsh-sc-section-bulk">
          {row.stagePaths.length > 0 && (
            <ListRowActionButton
              aria-label={props.t('source-control.stage-all')}
              title={props.t('source-control.stage-all')}
              onClick={() => { props.onStage(row.stagePaths) }}
            ><IconPlusOutline16 size={14} /></ListRowActionButton>
          )}
          {row.unstagePaths.length > 0 && (
            <ListRowActionButton
              aria-label={props.t('source-control.unstage-all')}
              title={props.t('source-control.unstage-all')}
              onClick={() => { props.onUnstage(row.unstagePaths) }}
            ><IconMinus size={14} /></ListRowActionButton>
          )}
          {row.discardPaths.length > 0 && (
            <ListRowActionButton
              aria-label={props.t('source-control.discard-all')}
              title={props.t('source-control.discard-all')}
              onClick={() => { props.onDiscard(row.discardPaths, props.t(`source-control.section.${row.id}`)) }}
            ><IconTrashOutline16 size={14} /></ListRowActionButton>
          )}
        </span>
      </ListRowTrailing>
    </ListRow>
  )
}

function DirectoryRowView(props: {
  row: DirectoryRow
  t: Translate<WorkspaceMessage>
  onToggleDirectory(key: string): void
  onStage(paths: readonly string[]): void
  onUnstage(paths: readonly string[]): void
  onDiscard(paths: readonly string[], label: string): void
}): JSX.Element {
  const { row } = props
  return (
    <ListRow className="oh-dsh-sc-directory-row" title={row.path} data-path={row.path}>
      <ListRowMain
        className="oh-dsh-sc-depth-main"
        style={{ '--tree-depth': row.depth } as CSSProperties}
        aria-expanded={row.expanded}
        onClick={() => { props.onToggleDirectory(row.key) }}
      >
        <ListRowLeading aria-hidden="true">
          {row.expanded ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
        </ListRowLeading>
        <FileGlyph path={row.path} kind="directory" expanded={row.expanded} />
        <ListRowBody>
          <FilenameLabel name={row.name} title={row.path} />
        </ListRowBody>
      </ListRowMain>
      <ListRowTrailing>
        <span className="oh-dsh-workspace-count">{row.fileCount}</span>
      </ListRowTrailing>
      <ListRowActions>
        {row.stagePaths.length > 0 && (
          <ListRowActionButton
            aria-label={props.t('source-control.stage-all')}
            title={props.t('source-control.stage-all')}
            onClick={() => { props.onStage(row.stagePaths) }}
          ><IconPlusOutline16 size={14} /></ListRowActionButton>
        )}
        {row.unstagePaths.length > 0 && (
          <ListRowActionButton
            aria-label={props.t('source-control.unstage-all')}
            title={props.t('source-control.unstage-all')}
            onClick={() => { props.onUnstage(row.unstagePaths) }}
          ><IconMinus size={14} /></ListRowActionButton>
        )}
        {row.discardPaths.length > 0 && (
          <ListRowActionButton
            aria-label={props.t('source-control.discard-all')}
            title={props.t('source-control.discard-all')}
            onClick={() => { props.onDiscard(row.discardPaths, row.path) }}
          ><IconTrashOutline16 size={14} /></ListRowActionButton>
        )}
      </ListRowActions>
    </ListRow>
  )
}

function FileRowView(props: {
  row: FileRow
  pending: SourceControlPendingAction | null
  t: Translate<WorkspaceMessage>
  onSelectFile(path: string): void
  onOpenFile(path: string): void
  onStage(paths: readonly string[]): void
  onUnstage(paths: readonly string[]): void
  onDiscard(paths: readonly string[], label: string): void
  onContextMenu(
    path: string,
    x: number,
    y: number,
    capabilities: { canStage: boolean; canUnstage: boolean; canDiscard: boolean },
  ): void
}): JSX.Element {
  const { row } = props
  const change = row.change
  const hasStat = change.additions > 0 || change.deletions > 0
  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    props.onContextMenu(row.path, event.clientX, event.clientY, {
      canStage: row.canStage,
      canUnstage: row.canUnstage,
      canDiscard: row.canDiscard,
    })
  }
  return (
    <ListRow
      className="oh-dsh-sc-file-row"
      selected={row.selected}
      title={row.path}
      data-path={row.path}
      data-pending={props.pending ?? undefined}
      onContextMenu={openMenu}
    >
      <ListRowMain
        className="oh-dsh-sc-depth-main"
        style={{ '--tree-depth': row.depth } as CSSProperties}
        aria-busy={props.pending !== null || undefined}
        onClick={() => { props.onSelectFile(row.path) }}
        onDoubleClick={() => { props.onOpenFile(row.path) }}
      >
        <ListRowLeading aria-hidden="true" />
        <FileGlyph path={row.path} kind="file" />
        <ListRowBody>
          <FilenameLabel name={row.name} title={row.path} />
        </ListRowBody>
        {hasStat && (
          <ListRowTrailing className="oh-dsh-sc-stat-trailing">
            <span className="oh-dsh-sc-stat" aria-hidden="true">
              {change.additions > 0 && <em className="oh-dsh-sc-stat-add">+{change.additions}</em>}
              {change.deletions > 0 && <em className="oh-dsh-sc-stat-del">−{change.deletions}</em>}
            </span>
          </ListRowTrailing>
        )}
      </ListRowMain>
      <ListRowTrailing>
        <span
          className={`oh-dsh-sc-mark is-${change.status}`}
          aria-label={props.t(`source-control.status.${change.status}`)}
        >{SECTION_SYMBOL[change.status]}</span>
      </ListRowTrailing>
      <ListRowActions>
        {row.canStage && (
          <ListRowActionButton
            aria-label={props.t('source-control.stage')}
            title={props.t('source-control.stage')}
            disabled={props.pending !== null}
            onClick={() => { props.onStage([row.path]) }}
          ><IconPlusOutline16 size={14} /></ListRowActionButton>
        )}
        {row.canUnstage && (
          <ListRowActionButton
            aria-label={props.t('source-control.unstage')}
            title={props.t('source-control.unstage')}
            disabled={props.pending !== null}
            onClick={() => { props.onUnstage([row.path]) }}
          ><IconMinus size={14} /></ListRowActionButton>
        )}
        {row.canDiscard && (
          <ListRowActionButton
            aria-label={props.t('source-control.discard')}
            title={props.t('source-control.discard')}
            disabled={props.pending !== null}
            onClick={() => { props.onDiscard([row.path], row.path) }}
          ><IconTrashOutline16 size={14} /></ListRowActionButton>
        )}
      </ListRowActions>
    </ListRow>
  )
}
