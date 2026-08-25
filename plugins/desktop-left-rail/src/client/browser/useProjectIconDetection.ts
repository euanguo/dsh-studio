/**
 * Project-icon discovery: the deduped project root set, the Host icon-detection
 * effect (AbortController + cancelled flag, refreshed on root/icon-revision
 * change) and the renderer-safe `projectIcons` map. Exposes `refreshIcons()`
 * that bumps the revision for the reset/refresh-icon actions.
 */
import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectIconNode, WorktreeLayoutMap } from '../tree.ts'
import { detectProjectIcon, type ProjectIconDetection } from '../project-icon-api.ts'
import { projectIconNodeOf } from '../project-icon-model.ts'
import type { ProjectIconPreference } from '../domain/project-icon.ts'

export function useProjectIconDetection({
  workspaces,
  layouts,
  projectIconOverrides,
}: {
  workspaces: readonly WorkspaceView[]
  layouts: WorktreeLayoutMap
  projectIconOverrides: Record<string, ProjectIconPreference>
}): { projectIcons: Map<string, ProjectIconNode>; refreshIcons: () => void } {
  const projectRoots = useMemo(() => Array.from(new Set(
    workspaces.map(workspace => layouts.get(workspace.path)?.repoRoot ?? workspace.path),
  )).sort(), [workspaces, layouts])
  const [iconRevision, setIconRevision] = useState(0)
  const [projectIconDetections, setProjectIconDetections] = useState<Map<string, ProjectIconDetection['icon']>>(new Map())
  const projectRootKey = projectRoots.join('\n')
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const run = async (): Promise<void> => {
      const next = new Map<string, ProjectIconDetection['icon']>()
      await Promise.all(projectRoots.map(async root => {
        try {
          const detection = await detectProjectIcon(root, controller.signal)
          next.set(detection.repoRoot, detection.icon)
        } catch {
          // Icon enrichment is best effort; the model keeps its glyph fallback.
        }
      }))
      if (!cancelled) setProjectIconDetections(next)
    }
    void run()
    return () => { cancelled = true; controller.abort() }
  }, [projectRootKey, projectRoots, iconRevision])
  const projectIcons = useMemo(() => {
    const icons = new Map<string, ProjectIconNode>()
    for (const root of projectRoots) {
      const isGit = workspaces.some(workspace => layouts.get(workspace.path)?.repoRoot === root)
      icons.set(root, projectIconNodeOf({
        isGit,
        preference: projectIconOverrides[root],
        detection: projectIconDetections.get(root),
      }))
    }
    return icons
  }, [projectIconDetections, projectIconOverrides, projectRoots, workspaces, layouts])
  return {
    projectIcons,
    refreshIcons: () => { setIconRevision(revision => revision + 1) },
  }
}