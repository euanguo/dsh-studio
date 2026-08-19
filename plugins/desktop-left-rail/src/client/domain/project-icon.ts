import type { ProjectId } from './identities.ts'
import {
  PROJECT_ICON_BUILTINS,
  type ProjectIconBuiltin,
  type ProjectIconPreference,
  sanitizeProjectIconPreference,
} from '@oh-dsh/shared/left-rail-preferences'

export {
  PROJECT_ICON_BUILTINS,
  sanitizeProjectIconPreference,
  type ProjectIconBuiltin,
  type ProjectIconPreference,
} from '@oh-dsh/shared/left-rail-preferences'

export type ProjectIconGlyph = 'project' | 'directory'

export type ProjectIconSource =
  | 'override'
  | 'local-png'
  | 'entry-declaration'
  | 'homepage-favicon'
  | 'git-provider-avatar'
  | 'fallback'

export interface ProjectIconCandidate {
  readonly source: Exclude<ProjectIconSource, 'fallback'>
  readonly value: string
}

export interface ProjectIconResolution {
  readonly project: ProjectId
  readonly source: ProjectIconSource
  readonly value: string
  readonly stale: boolean
}

export interface ProjectIconDescriptor {
  readonly project: ProjectId
  readonly preference?: ProjectIconPreference
  readonly candidates: readonly ProjectIconCandidate[]
  readonly fallback: ProjectIconGlyph
}

/** Resolve the first valid source in the documented precedence order. */
export function resolveProjectIcon(input: ProjectIconDescriptor): ProjectIconResolution {
  if (input.preference !== undefined) {
    const value = input.preference.kind === 'builtin'
      ? input.preference.name
      : input.preference.data
    if (value !== undefined && value !== '') {
      return { project: input.project, source: 'override', value, stale: false }
    }
  }

  const precedence: readonly ProjectIconCandidate['source'][] = [
    'local-png',
    'entry-declaration',
    'homepage-favicon',
    'git-provider-avatar',
  ]
  for (const source of precedence) {
    const candidate = input.candidates.find(item => item.source === source && item.value !== '')
    if (candidate !== undefined) {
      return { project: input.project, source: candidate.source, value: candidate.value, stale: false }
    }
  }
  return { project: input.project, source: 'fallback', value: input.fallback, stale: false }
}

/** Mark an automatic resolution stale while retaining its displayed value. */
export function staleProjectIcon(resolution: ProjectIconResolution): ProjectIconResolution {
  return resolution.source === 'override' ? resolution : { ...resolution, stale: true }
}
