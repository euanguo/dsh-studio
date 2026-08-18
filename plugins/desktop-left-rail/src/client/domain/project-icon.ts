import type { ProjectId } from './identities.ts'

export type ProjectIconGlyph = 'project' | 'directory'

/** Built-in names are persisted as data, so keep the allowlist in the domain. */
export const PROJECT_ICON_BUILTINS = [
  'folder', 'git', 'code', 'terminal', 'files', 'list', 'web', 'adjustments',
] as const
export type ProjectIconBuiltin = typeof PROJECT_ICON_BUILTINS[number]

export interface ProjectIconPreference {
  readonly kind: 'builtin' | 'upload'
  readonly name?: ProjectIconBuiltin
  readonly mime?: 'image/png'
  readonly data?: string
}

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

/** Validate persisted icon intent at the settings boundary. */
export function sanitizeProjectIconPreference(value: unknown): ProjectIconPreference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.kind === 'builtin' && typeof record.name === 'string'
    && (PROJECT_ICON_BUILTINS as readonly string[]).includes(record.name)) {
    return { kind: 'builtin', name: record.name as ProjectIconBuiltin }
  }
  if (record.kind === 'upload' && record.mime === 'image/png' && typeof record.data === 'string'
    && record.data.length <= 400 * 1024
    && /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/i.test(record.data)) {
    return { kind: 'upload', mime: 'image/png', data: record.data }
  }
  return undefined
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
