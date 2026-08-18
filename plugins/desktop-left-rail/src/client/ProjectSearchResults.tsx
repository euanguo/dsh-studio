/**
 * Project/worktree-name matches for the search mode of the desktop three-
 * level tree. Rendered above the session results in workspace mode: typing a
 * query matches project labels (alias or basename), repo roots, worktree
 * labels and branch names, and clicking a match jumps to its tab and expands
 * the project — the session-only search could not address projects at all.
 */
import { useMemo } from 'react'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { LeftRailSnapshot } from './project-tree-model.ts'
import type { ProjectNode } from './tree.ts'
import { WorkspaceBrowserCss as css } from './styles.js'
import { ProjectIconGlyph } from './ProjectIconGlyph.tsx'

/** Whether a project matches the search query (label, root, worktrees, branches). */
export function projectMatchesQuery(project: ProjectNode, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return false
  if (project.label.toLowerCase().includes(q)) return true
  if (project.repoRoot.toLowerCase().includes(q)) return true
  return project.worktrees.some(wt =>
    wt.label.toLowerCase().includes(q) || (wt.branch ?? '').toLowerCase().includes(q))
}

interface ProjectSearchResultsProps {
  snapshot: LeftRailSnapshot
  query: string
  /** Jump to the project's tab and expand it (also clears the query). */
  onJump: (project: ProjectNode) => void
  t: WorkspaceBrowserProps['t']
}

export function ProjectSearchResults({ snapshot, query, onJump, t }: ProjectSearchResultsProps) {
  const tree = snapshot.tree
  const matches = useMemo(
    () => tree.allProjects.filter(project => projectMatchesQuery(project, query)),
    [tree.allProjects, query],
  )
  if (matches.length === 0) return null
  return (
    <div className={css.projectMatches}>
      <div className={css.projectMatchHeader}>{t('search.projects')}</div>
      {matches.map(project => (
        <button
          key={project.key}
          type="button"
          className={css.projectMatchRow}
          onClick={() => { onJump(project) }}
        >
          <span className={css.projectMatchIcon}>
            <ProjectIconGlyph icon={project.icon} size={16} />
          </span>
          <span className={css.projectMatchText}>
            <span className={css.projectMatchTitle}>{project.label}</span>
            <span className={css.projectMatchMeta}>
              {project.repoRoot}
              {project.worktreeCount > 1 && ` · ${t('search.projects.count', { n: project.worktreeCount })}`}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
