/**
 * Project → WorkTree row components for the desktop three-level tree.
 * Rows render semantic action selections; they do not call Workspace, Git,
 * filesystem, or settings capabilities directly.
 */
import { useRef, useState, type ChangeEvent } from 'react'
import {
  HoverCard, Menu,
  IconCopyOutline16, IconEditOutline16, IconEllipsisOutline16, IconFolderOpen16,
  IconFolderOpenOutline16, IconPlusOutline16, IconProjectAddOutline16, IconRefreshOutline16,
  IconTrashOutline16, IconTriangleRightFill14,
  type MenuEntry, type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconGitBranch } from '@oh-dsh/shared/tabler-icons'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { ProjectIconBuiltin } from '../domain/project-icon.ts'
import type { ActionSelection } from '../domain/commands.ts'
import { projectActionDescriptors, worktreeActionDescriptors } from '../domain/action-descriptors.ts'
import { projectIdOf, worktreeIdOf } from '../domain/identities.ts'
import { projectIconChoices, ProjectIconGlyph } from '../ProjectIconGlyph.tsx'
import type { GroupTab, ProjectNode, WorktreeNode } from '../tree.ts'
import { RowsCss as css } from '../styles.js'
import { cn } from '../shim/cn.ts'

type RowTranslate = WorkspaceBrowserProps['t']

/** One workspace target shown in a Worktree action submenu. */
export interface WorktreeWorkspace {
  id: string
  title: string
}

function actionIconSelection(action: ActionSelection['action'], target: ActionSelection['target'], extra: Partial<ActionSelection> = {}): ActionSelection {
  return { action, target, ...extra }
}

/** Project-level row: repository identity, icon, main-branch badge, and actions. */
export function ProjectRowItem({ project, onToggle, tabs, onAction, t }: {
  project: ProjectNode
  onToggle: () => void
  tabs: readonly GroupTab[]
  onAction: (selection: ActionSelection) => void
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const iconInput = useRef<HTMLInputElement>(null)
  const target = { kind: 'project' as const, id: projectIdOf(project) }
  const descriptors = projectActionDescriptors(project)
  const descriptorOf = (id: ActionSelection['action']) => descriptors.find(descriptor => descriptor.id === id)
  const moveTargets = tabs.filter(tab => !tab.pinned)
  const moveMenu: readonly MenuItem[] = [
    { id: 'move-default', label: t('tab.default') },
    ...moveTargets.map(tab => ({ id: `move-group:${tab.id}`, label: tab.label ?? tab.id })),
    { id: 'move-new', label: t('tab.newGroup') },
  ]
  const iconMenu: readonly MenuItem[] = [
    { id: 'icon-upload', label: t('project.icon.upload'), icon: <IconFolderOpenOutline16 /> },
    ...projectIconChoices.map(name => ({ id: `icon-set:${name}`, label: t(`project.icon.${name}` as never) })),
    { id: 'icon-refresh', label: t('project.icon.refresh'), icon: <IconRefreshOutline16 /> },
    { id: 'icon-reset', label: t('project.icon.reset'), danger: true },
  ]
  const menuItems: MenuEntry[] = [
    {
      id: 'new-worktree',
      label: t('project.newWorktree'),
      icon: <IconProjectAddOutline16 />,
      disabled: descriptorOf('project.create-worktree')?.enabled !== true,
    },
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'set-icon', label: t('project.icon.set'), icon: <ProjectIconGlyph icon={project.icon} size={16} />, submenu: iconMenu },
    { id: 'move-group', label: t('project.moveToGroup'), icon: <IconFolderOpen16 />, submenu: moveMenu },
    { type: 'separator', id: 'project-sep' },
    { id: 'copy-path', label: t('menu.copyPath'), icon: <IconCopyOutline16 /> },
    { id: 'open-folder', label: t('menu.openFolder'), icon: <IconFolderOpenOutline16 /> },
    { type: 'separator', id: 'project-sep2' },
    { id: 'remove', label: t('project.remove'), icon: <IconTrashOutline16 />, danger: true },
  ]
  const select = (action: ActionSelection['action'], extra: Partial<ActionSelection> = {}): void => {
    onAction(actionIconSelection(action, target, extra))
  }
  const onIconFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined || file.type !== 'image/png' || file.size > 256 * 1024) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (signature.some((value, index) => bytes[index] !== value)) return
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    select('project.set-icon', { iconData: `data:image/png;base64,${btoa(binary)}` })
  }
  const ownRow = (
    <div
      className={cn(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={project.expanded}
      onClick={onToggle}
    >
      <span className={cn(css.slot, css.folder, project.containsCurrent && css.folderActive)}>
        <ProjectIconGlyph icon={project.icon} size={16} />
      </span>
      <span className={cn(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={cn(css.arrow, project.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{project.label}</span>
        <input ref={iconInput} type="file" accept="image/png" hidden onChange={(event) => { void onIconFileChange(event) }} />
        {project.mainBranch !== null && project.isGit && <span className={css.mainBadge}>{project.mainBranch}</span>}
      </span>
      <span className={css.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'new-worktree') select('project.create-worktree')
            else if (id === 'rename') select('project.rename-alias')
            else if (id === 'copy-path') select('project.copy-path')
            else if (id === 'open-folder') select('project.open-directory')
            else if (id === 'remove') select('project.remove-registration')
            else if (id === 'move-default') select('project.move-group', { groupId: '__default__' })
            else if (id === 'move-new') select('project.move-group', { groupId: '__new__' })
            else if (id.startsWith('move-group:')) select('project.move-group', { groupId: id.slice('move-group:'.length) })
            else if (id === 'icon-refresh') select('project.refresh-icon')
            else if (id === 'icon-reset') select('project.reset-icon')
            else if (id === 'icon-upload') iconInput.current?.click()
            else if (id.startsWith('icon-set:')) select('project.set-icon', { iconName: id.slice('icon-set:'.length) as ProjectIconBuiltin })
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

/** WorkTree-level row: Git branch identity, Workspace targets, and topology actions. */
export function WorktreeRowItem({ project, worktree, onToggle, workspaces, onAction, t }: {
  project: ProjectNode
  worktree: WorktreeNode
  onToggle: () => void
  workspaces?: readonly WorktreeWorkspace[] | undefined
  onAction: (selection: ActionSelection) => void
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const targets = workspaces ?? []
  const target = { kind: 'worktree' as const, id: worktreeIdOf(project, worktree) }
  const descriptors = worktreeActionDescriptors(project, worktree)
  const descriptor = (id: ActionSelection['action'], workspaceId?: string) => descriptors.find(item => item.id === id && item.workspaceId === workspaceId)
  const selections = new Map<string, ActionSelection>()
  const addWorkspaceRows = (action: 'worktree.create-session' | 'worktree.rename' | 'worktree.remove-registration', label: string, icon: JSX.Element): MenuEntry[] => {
    if (targets.length === 0) return []
    return targets.map(workspace => {
      const id = `${action}:${workspace.id}`
      selections.set(id, actionIconSelection(action, target, { workspaceId: workspace.id }))
      return { id, label: targets.length > 1 ? `${label} · ${workspace.title}` : label, icon }
    })
  }
  const menuItems: MenuEntry[] = [
    ...addWorkspaceRows('worktree.create-session', t('worktree.newSession'), <IconPlusOutline16 />),
    ...addWorkspaceRows('worktree.rename', t('rename'), <IconEditOutline16 />),
    ...addWorkspaceRows('worktree.remove-registration', t('delete.workspace'), <IconTrashOutline16 />),
    { type: 'separator', id: 'wt-sep-actions' },
    {
      id: 'remove-physical',
      label: t('worktree.removePhysical'),
      icon: <IconTrashOutline16 />,
      danger: true,
      disabled: descriptor('worktree.remove-physical')?.enabled !== true,
    },
    { type: 'separator', id: 'wt-sep-path' },
    { id: 'copy-path', label: t('menu.copyPath'), icon: <IconCopyOutline16 /> },
    { id: 'open-folder', label: t('menu.openFolder'), icon: <IconFolderOpenOutline16 /> },
  ]
  const handleSelect = (id: string): void => {
    setMenuOpen(false)
    const selection = selections.get(id)
    if (selection !== undefined) {
      onAction(selection)
      return
    }
    if (id === 'copy-path') onAction({ action: 'worktree.copy-path', target })
    else if (id === 'open-folder') onAction({ action: 'worktree.open-directory', target })
    else if (id === 'remove-physical') onAction({ action: 'worktree.remove-physical', target })
  }
  const startDefaultSession = (): void => {
    if (targets.length > 1) {
      setMenuOpen(true)
      return
    }
    onAction({
      action: 'worktree.create-session',
      target,
      ...(targets[0] === undefined ? {} : { workspaceId: targets[0].id }),
    })
  }
  return (
    <div
      className={cn(css.worktreeRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={worktree.expanded}
      onClick={onToggle}
    >
      <span className={cn(css.slot, css.folder, worktree.containsCurrent && css.folderActive)}>
        {worktree.isGit === true ? <IconGitBranch /> : <ProjectIconGlyph icon={{ source: 'fallback', value: 'directory', fallback: 'directory' }} size={16} />}
      </span>
      <span className={cn(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={cn(css.arrow, worktree.expanded && css.arrowOpen)} />
      </span>
      <span className={css.worktreeText}>
        <span className={css.title}>{worktree.label}</span>
        {worktree.branch !== null && <span className={css.branchBadge}>{worktree.branch}</span>}
        {targets.length > 1 && <span className={css.countBadge} aria-label={t('worktree.workspaceCount', { n: targets.length })}>×{targets.length}</span>}
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
          onClick={(e) => { e.stopPropagation(); startDefaultSession() }}
        >
          <IconPlusOutline16 />
        </button>
      </span>
    </div>
  )
}
