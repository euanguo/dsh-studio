import type { ProjectIconNode } from './tree.ts'
import type { ProjectIconPreference } from './domain/project-icon.ts'
import type { ProjectIconDetection } from './project-icon-api.ts'

/** Convert durable intent and Host detection into the renderer-safe icon shape. */
export function projectIconNodeOf({
  isGit,
  preference,
  detection,
}: {
  isGit: boolean
  preference: ProjectIconPreference | undefined
  detection: ProjectIconDetection['icon'] | undefined
}): ProjectIconNode {
  if (preference?.kind === 'builtin' && preference.name !== undefined) {
    return { source: 'override', value: preference.name, fallback: isGit ? 'project' : 'directory' }
  }
  if (preference?.kind === 'upload' && preference.data !== undefined && preference.data !== '') {
    return { source: 'override', value: preference.data, fallback: isGit ? 'project' : 'directory' }
  }
  if (detection !== undefined && detection !== null) {
    const source = detection.source === 'file'
      ? 'local-png'
      : detection.source === 'favicon'
        ? 'homepage-favicon'
        : 'git-provider-avatar'
    return { source, value: detection.src, fallback: isGit ? 'project' : 'directory' }
  }
  return {
    source: 'fallback',
    value: isGit ? 'project' : 'directory',
    fallback: isGit ? 'project' : 'directory',
  }
}
