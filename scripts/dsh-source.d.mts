export interface DshGitSourceSpec {
  readonly source: 'git'
  readonly repository: string
  readonly ref: string
  readonly revision: string
  readonly version: string
}

export interface DshNpmSourceSpec {
  readonly source: 'npm'
  readonly package: string
  readonly version: string
  readonly integrity: string
  readonly tarball: string
  readonly packageManager: string
}

export type DshSourceSpec = DshGitSourceSpec | DshNpmSourceSpec

export const DSH_SOURCE_SPEC: DshSourceSpec

export function resolveDshSource(): string

export function resolvePinnedPnpm(source: string): {
  readonly binDir: string
  readonly cliEntry: string
}
