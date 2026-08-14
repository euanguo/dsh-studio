/**
 * Project → WorkTree row components for the desktop three-level tree.
 * ProjectRowItem = repository row (folder glyph + main-branch badge; ⋮ menu:
 * new WorkTree / rename alias / move to group / copy path / open folder /
 * remove project). WorktreeRowItem = linked-worktree row (branch + main
 * badges; ⋮ menu: new session / rename / delete / copy path / open folder).
 */
import { useState } from 'react'
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
    ...moveTargets.map(tab => ({ id: `move-${tab.id}`, label: tab.label })),
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

/** WorkTree-level row: directory + branch badge + main marker. */
export function WorktreeRowItem({ worktree, onToggle, onCreate, actions, onOpenPath, onCopy, t }: {
  worktree: WorktreeNode
  onToggle: () => void
  onCreate: () => void
  actions?: { rename: () => void; delete: () => void } | undefined
  onOpenPath: () => void
  onCopy: (text: string) => void
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuItems: MenuEntry[] = [
    { id: 'new-session', label: t('worktree.newSession'), icon: <IconPlusOutline16 /> },
    ...(actions === undefined
      ? []
      : [
        { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
        { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutline16 />, danger: true },
      ]),
    { type: 'separator', id: 'wt-sep' },
    { id: 'copy-path', label: t('menu.copyPath'), icon: <IconCopyOutline16 /> },
    { id: 'open-folder', label: t('menu.openFolder'), icon: <IconFolderOpenOutline16 /> },
  ]
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
        {worktree.main && <span className={css.mainBadge}>{t('worktree.main')}</span>}
        {worktree.branch !== null && <span className={css.branchBadge}>{worktree.branch}</span>}
      </span>
      <span className={css.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'new-session') onCreate()
            else if (id === 'rename') actions?.rename()
            else if (id === 'delete') actions?.delete()
            else if (id === 'copy-path') onCopy(worktree.path)
            else if (id === 'open-folder') onOpenPath()
          }}
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
          onClick={(e) => { e.stopPropagation(); onCreate() }}
        >
          <IconPlusOutline16 />
        </button>
      </span>
    </div>
  )
}
