/**
 * Project → WorkTree row components for the desktop three-level tree.
 * ProjectRowItem = repository row (folder glyph + main-branch badge; ⋮ menu:
 * new WorkTree / rename alias / move to group / copy path / open folder /
 * remove project). WorktreeRowItem = linked-worktree row (branch badge; ⋮
 * menu: new session / rename / delete / copy path / open folder). Row actions
 * that address a DSH workspace target every member workspace (a worktree can
 * host several workspaces), never a silently chosen one.
 */
import { useState, type ReactNode } from 'react'
import {
  HoverCard, Menu,
  IconCopyOutline16, IconEditOutline16, IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16,
  IconFolderOpenOutline16, IconPlusOutline16, IconProjectAddOutline16, IconTrashOutline16, IconTriangleRightFill14,
  type MenuEntry, type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { GroupTab, ProjectNode, WorktreeNode } from '../tree.ts'
import { RowsCss as css } from '../styles.js'
import { cn } from '../shim/cn.ts'

type RowTranslate = WorkspaceBrowserProps['t']

/** One workspace target of a worktree row action. */
export interface WorktreeWorkspace {
  id: string
  title: string
}

/** Project-level row: repository name + main-branch badge, folded worktrees. */
export function ProjectRowItem({ project, onToggle, onCreate, onMoveGroup, onRemove, onRename, onOpenPath, onCopy, tabs, t }: {
  project: ProjectNode
  onToggle: () => void
  onCreate: () => void
  onMoveGroup: (groupId: string | undefined) => void
  onRemove: () => void
  onRename: () => void
  onOpenPath: () => void
  onCopy: (text: string) => void
  tabs: readonly GroupTab[]
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const active = project.expanded && project.containsCurrent
  const moveTargets = tabs.filter(tab => !tab.pinned)
  const moveMenu: readonly MenuItem[] = [
    { id: 'move-default', label: t('tab.default') },
    ...moveTargets.map(tab => ({ id: `move-${tab.id}`, label: tab.label ?? tab.id })),
    { id: 'move-new', label: t('tab.newGroup') },
  ]
  const menuItems: MenuEntry[] = [
    { id: 'new-worktree', label: t('project.newWorktree'), icon: <IconProjectAddOutline16 /> },
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'move-group', label: t('project.moveToGroup'), icon: <IconFolderOpen16 />, submenu: moveMenu },
    { type: 'separator', id: 'project-sep' },
    { id: 'copy-path', label: t('menu.copyPath'), icon: <IconCopyOutline16 /> },
    { id: 'open-folder', label: t('menu.openFolder'), icon: <IconFolderOpenOutline16 /> },
    { type: 'separator', id: 'project-sep2' },
    { id: 'remove', label: t('project.remove'), icon: <IconTrashOutline16 />, danger: true },
  ]
  const ownRow = (
    <div
      className={cn(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={project.expanded}
      onClick={onToggle}
    >
      <span className={cn(css.slot, css.folder, active && css.folderActive)}>
        {project.expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      </span>
      <span className={cn(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={cn(css.arrow, project.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{project.label}</span>
        {project.mainBranch !== null && project.isGit && (
          <span className={css.mainBadge}>{project.mainBranch}</span>
        )}
      </span>
      <span className={css.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'new-worktree') onCreate()
            else if (id === 'rename') onRename()
            else if (id === 'remove') onRemove()
            else if (id === 'copy-path') onCopy(project.repoRoot)
            else if (id === 'open-folder') onOpenPath()
            else if (id === 'move-default') onMoveGroup(undefined)
            else if (id === 'move-new') onMoveGroup('__new__')
            else if (id.startsWith('move-')) onMoveGroup(id.slice('move-'.length))
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('actions.project.aria', { name: project.label })}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
            >
              <IconEllipsisOutline16 />
            </button>
          )}
        />
      </span>
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={(
        <div className={css.hoverContent}>
          <span className={css.hoverTitle}>{project.label}</span>
          <span className={css.hoverPath}>{project.repoRoot}</span>
        </div>
      )}
      disabled={menuOpen}
      copyText={project.repoRoot}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/** WorkTree-level row: directory + branch badge + per-workspace actions. */
export function WorktreeRowItem({ worktree, onToggle, onCreate, workspaces, onRenameWorkspace, onDeleteWorkspace, onOpenPath, onCopy, t }: {
  worktree: WorktreeNode
  onToggle: () => void
  /** Start a session; the workspace id picks the target when ambiguous. */
  onCreate: (workspaceId?: string) => void
  /** Backing DSH workspaces; absent means the worktree hosts none. */
  workspaces?: readonly WorktreeWorkspace[] | undefined
  onRenameWorkspace: (workspaceId: string, title: string) => void
  onDeleteWorkspace: (workspaceId: string, title: string) => void
  onOpenPath: () => void
  onCopy: (text: string) => void
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const targets = workspaces ?? []
  // Per-workspace verbs: with one target the menu row is the bare verb; with
  // several, every verb expands to one row per workspace so an action never
  // lands on a silently chosen member.
  const verbRows = (verb: 'new-session' | 'rename' | 'delete', label: string, icon: ReactNode): MenuEntry[] => {
    if (targets.length <= 1) {
      const only = targets[0]
      return only === undefined ? [] : [{ id: `${verb}:${only.id}`, label, icon }]
    }
    return targets.map(ws => ({
      id: `${verb}:${ws.id}`,
      label: `${label} · ${ws.title}`,
      icon,
    }))
  }
  const newSessionRows = verbRows('new-session', t('worktree.newSession'), <IconPlusOutline16 />)
  const renameRows = verbRows('rename', t('rename'), <IconEditOutline16 />)
  const deleteRows = verbRows('delete', t('delete.workspace'), <IconTrashOutline16 />)
  const menuItems: MenuEntry[] = [
    ...newSessionRows,
    ...renameRows,
    ...deleteRows,
    { type: 'separator', id: 'wt-sep' },
    { id: 'copy-path', label: t('menu.copyPath'), icon: <IconCopyOutline16 /> },
    { id: 'open-folder', label: t('menu.openFolder'), icon: <IconFolderOpenOutline16 /> },
  ]
  const handleSelect = (id: string): void => {
    setMenuOpen(false)
    const sep = id.indexOf(':')
    const verb = sep === -1 ? id : id.slice(0, sep)
    const workspaceId = sep === -1 ? undefined : id.slice(sep + 1)
    if (verb === 'new-session') onCreate(workspaceId)
    else if (verb === 'rename' && workspaceId !== undefined) onRenameWorkspace(workspaceId, worktree.label)
    else if (verb === 'delete' && workspaceId !== undefined) onDeleteWorkspace(workspaceId, worktree.label)
    else if (id === 'copy-path') onCopy(worktree.path)
    else if (id === 'open-folder') onOpenPath()
  }
  return (
    <div
      className={cn(css.worktreeRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={worktree.expanded}
      onClick={onToggle}
    >
      <span className={cn(css.slot, css.folder, worktree.containsCurrent && css.folderActive)}>
        {worktree.expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      </span>
      <span className={cn(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={cn(css.arrow, worktree.expanded && css.arrowOpen)} />
      </span>
      <span className={css.worktreeText}>
        <span className={css.title}>{worktree.label}</span>
        {worktree.branch !== null && <span className={css.branchBadge}>{worktree.branch}</span>}
        {targets.length > 1 && (
          <span className={css.countBadge} aria-label={t('worktree.workspaceCount', { n: targets.length })}>
            ×{targets.length}
          </span>
        )}
      </span>
      <span className={css.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          onSelect={handleSelect}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('worktree.actions.aria', { name: worktree.label })}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
            >
              <IconEllipsisOutline16 />
            </button>
          )}
        />
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('worktree.new.aria', { name: worktree.label })}
          onClick={(e) => {
            e.stopPropagation()
            if (targets.length > 1) setMenuOpen(true)
            else onCreate()
          }}
        >
          <IconPlusOutline16 />
        </button>
      </span>
    </div>
  )
}
