/**
 * Project → WorkTree row components for the desktop three-level tree.
 * Rows render semantic action selections; they do not call Workspace, Git,
 * filesystem, or settings capabilities directly.
 */
import { useState } from 'react'
import {
  HoverCard, Menu, StateDot,
  IconCopyOutline16, IconEditOutline16, IconEllipsisOutline16, IconFolderOpen16,
  IconFolderOpenOutline16, IconPlusOutline16, IconProjectAddOutline16,
  IconTrashOutline16, IconTriangleRightFill14,
  type MenuEntry, type MenuItem, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconGitBranch } from '@dsh-studio/shared/tabler-icons'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { ActionSelection } from '../domain/commands.ts'
import { projectActionDescriptors, worktreeActionDescriptors } from '../domain/action-descriptors.ts'
import { projectIdOf, worktreeIdOf } from '../domain/identities.ts'
import { ProjectIconGlyph } from '../ProjectIconGlyph.tsx'
import type { ActivityKind, GroupTab, ProjectNode, WorktreeNode } from '../tree.ts'
import { RowsCss as css } from '../styles.ts'
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

/** One ActivityKind's dot color in the official StateDot semantics. */
function dotStateOf(kind: ActivityKind): StateDotState {
  if (kind === 'waiting') return 'warning'
  if (kind === 'running') return 'ongoing'
  return 'done'
}

/**
 * The hidden-activity indicator for collection rows: the official StateDot —
 * the same component (and size) the session rows render — paired with
 * screen-reader copy. No second status-dot kit; only the display rule
 * ("this row hides activity") is ours.
 */
function ActivityDot({ kind, label }: { kind: ActivityKind | undefined; label: string }) {
  if (kind === undefined) return null
  return (
    <>
      <StateDot state={dotStateOf(kind)} className={css.statusDot} />
      <span className={css.visuallyHidden}>{label}</span>
    </>
  )
}

/** Hover-card status lines for the hidden-activity buckets present under a row. */
function ActivityLines({ kinds, t }: { kinds: readonly ActivityKind[]; t: RowTranslate }) {
  if (kinds.length === 0) return null
  return (
    <>
      {kinds.map(kind => (
        <div className={css.hoverStatus} key={kind}>
          <StateDot state={dotStateOf(kind)} />
          <span>{t(`activity.${kind}`)}</span>
        </div>
      ))}
    </>
  )
}

/** Project-level row: repository identity, icon, main-branch badge, and actions. */
export function ProjectRowItem({ project, onToggle, tabs, onAction, dot, hiddenKinds, t }: {
  project: ProjectNode
  onToggle: () => void
  tabs: readonly GroupTab[]
  onAction: (selection: ActionSelection) => void
  /** Highest-priority hidden activity while the row is folded (undefined = none). */
  dot?: ActivityKind | undefined
  /** Every hidden bucket present, in priority order (hover-card copy). */
  hiddenKinds?: readonly ActivityKind[] | undefined
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const target = { kind: 'project' as const, id: projectIdOf(project) }
  const descriptors = projectActionDescriptors(project)
  const descriptorOf = (id: ActionSelection['action']) => descriptors.find(descriptor => descriptor.id === id)
  const moveTargets = tabs.filter(tab => !tab.pinned)
  const moveMenu: readonly MenuItem[] = [
    { id: 'move-default', label: t('tab.default') },
    ...moveTargets.map(tab => ({ id: `move-group:${tab.id}`, label: tab.label ?? tab.id })),
    { id: 'move-new', label: t('tab.newGroup') },
  ]
  const menuItems: MenuEntry[] = [
    {
      id: 'new-worktree',
      label: t('project.newWorktree'),
      icon: <IconProjectAddOutline16 />,
      disabled: descriptorOf('project.create-worktree')?.enabled !== true,
    },
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'set-icon', label: t('project.icon.set'), icon: <ProjectIconGlyph icon={project.icon} size={16} /> },
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
  const ownRow = (
    <div
      className={cn(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={project.expanded}
      onClick={onToggle}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenuOpen(true)
      }}
    >
      <span className={cn(css.slot, project.containsCurrent && css.folderActive)}>
        <ProjectIconGlyph icon={project.icon} size={16} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{project.label}</span>
      </span>
      <ActivityDot kind={dot} label={dot === undefined ? '' : t(`activity.${dot}`)} />
      <span className={css.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'new-worktree') select('project.create-worktree')
            else if (id === 'rename') select('project.rename-alias')
            else if (id === 'set-icon') select('project.set-icon')
            else if (id === 'copy-path') select('project.copy-path')
            else if (id === 'open-folder') select('project.open-directory')
            else if (id === 'remove') select('project.remove-registration')
            else if (id === 'move-default') select('project.move-group', { groupId: '__default__' })
            else if (id === 'move-new') select('project.move-group', { groupId: '__new__' })
            else if (id.startsWith('move-group:')) select('project.move-group', { groupId: id.slice('move-group:'.length) })
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
          <ActivityLines kinds={hiddenKinds ?? []} t={t} />
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
export function WorktreeRowItem({ project, worktree, onToggle, workspaces, onAction, dot, hiddenKinds, t }: {
  project: ProjectNode
  worktree: WorktreeNode
  onToggle: () => void
  workspaces?: readonly WorktreeWorkspace[] | undefined
  onAction: (selection: ActionSelection) => void
  /** Highest-priority activity hidden behind this row (undefined = none). */
  dot?: ActivityKind | undefined
  /** Every hidden bucket present, in priority order (hover-card copy). */
  hiddenKinds?: readonly ActivityKind[] | undefined
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const targets = workspaces ?? []
  const target = { kind: 'worktree' as const, id: worktreeIdOf(project, worktree) }
  const descriptors = worktreeActionDescriptors(project, worktree)
  const descriptor = (id: ActionSelection['action'], workspaceId?: string) => descriptors.find(item => item.id === id && item.workspaceId === workspaceId)
  // One rename / one remove per row (worktree = workspace). The suffix only
  // disambiguates when one row genuinely carries several registrations.
  const multi = targets.length > 1
  const selections = new Map<string, ActionSelection>()
  /** Rows for one verb: the explicit Workspace targets, or the single row-level fallback. */
  const verbRows = (
    action: 'worktree.create-session' | 'worktree.rename' | 'worktree.remove',
    label: string,
    icon: JSX.Element,
    fallback: boolean,
    danger?: boolean,
  ): MenuEntry[] => {
    if (targets.length > 0) {
      return targets.map(workspace => {
        const id = `${action}:${workspace.id}`
        selections.set(id, actionIconSelection(action, target, { workspaceId: workspace.id }))
        return { id, label: multi ? `${label} · ${workspace.title}` : label, icon, ...(danger ? { danger: true } : {}) }
      })
    }
    if (!fallback) return []
    selections.set(action, actionIconSelection(action, target))
    return [{ id: action, label, icon, ...(danger ? { danger: true } : {}) }]
  }
  const menuItems: MenuEntry[] = [
    ...verbRows('worktree.create-session', t('worktree.newSession'), <IconPlusOutline16 />, false),
    // Registration-less row: rename still offered (display alias).
    ...verbRows('worktree.rename', t('rename.workspace.title'), <IconEditOutline16 />, true),
    // Linked Git rows remove physically (registration entries above cover
    // the main / non-git rows); nothing to remove when neither applies.
    ...(targets.length > 0
      ? verbRows('worktree.remove', t('worktree.remove'), <IconTrashOutline16 />, false, true)
      : (descriptor('worktree.remove')?.enabled === true
        ? verbRows('worktree.remove', t('worktree.remove'), <IconTrashOutline16 />, true, true)
        : [])),
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
  const ownRow = (
    <div
      className={cn(css.worktreeRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={worktree.expanded}
      onClick={onToggle}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenuOpen(true)
      }}
    >
      <span className={cn(css.slot, worktree.containsCurrent && css.folderActive)}>
        {worktree.isGit === true ? <IconGitBranch /> : <ProjectIconGlyph icon={{ source: 'fallback', value: 'directory', fallback: 'directory' }} size={16} />}
      </span>
      <span className={cn(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={cn(css.arrow, worktree.expanded && css.arrowOpen)} />
      </span>
      <span className={css.worktreeText}>
        <span className={css.title}>{worktree.label}</span>
        {targets.length > 1 && <span className={css.countBadge} aria-label={t('worktree.workspaceCount', { n: targets.length })}>×{targets.length}</span>}
      </span>
      <ActivityDot kind={dot} label={dot === undefined ? '' : t(`activity.${dot}`)} />
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
  return (
    <HoverCard
      anchor={ownRow}
      content={(
        <div className={css.hoverContent}>
          <span className={css.hoverTitle}>{worktree.label}</span>
          {worktree.branch !== null && (
            <span className={css.hoverTime}>
              {worktree.branch}
            </span>
          )}
          <span className={css.hoverPath}>{worktree.path}</span>
          <ActivityLines kinds={hiddenKinds ?? []} t={t} />
        </div>
      )}
      disabled={menuOpen}
      copyText={worktree.path}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
