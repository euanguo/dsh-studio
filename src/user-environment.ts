import { accessSync, constants } from 'node:fs'
import { posix, win32 } from 'node:path'
import {
  defaultEnvironmentCache,
  environmentFingerprint,
  ENVIRONMENT_CACHE_VERSION,
  type EnvironmentCache,
} from './user-environment-cache.ts'
import { resolvePosixUserEnvironment } from './user-environment-posix.ts'
import { resolveWindowsUserEnvironment } from './user-environment-windows.ts'

export type UserEnvironmentSource = 'cached' | 'login-shell' | 'process'
export type UserEnvironmentIssue = 'spawn-error' | 'timeout' | 'output-too-large' | 'invalid-output' | 'exit'

export interface UserEnvironmentResolution {
  env: NodeJS.ProcessEnv
  issue?: UserEnvironmentIssue
  shell: string | null
  source: UserEnvironmentSource
}

export interface LoginShellExecution {
  error?: Error
  output: Buffer
  outputTooLarge?: boolean
  status: number | null
  timedOut?: boolean
}

export type LoginShellRunner = (
  shell: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<LoginShellExecution>

export interface ResolveUserEnvironmentOptions {
  base?: NodeJS.ProcessEnv
  cache?: EnvironmentCache
  cachePath?: string
  loginShell?: string
  platform?: NodeJS.Platform
  runLoginShell?: LoginShellRunner
}

export {
  defaultEnvironmentCache,
  environmentFingerprint,
  ENVIRONMENT_CACHE_VERSION,
  type EnvironmentCache,
  type EnvironmentCacheRecord,
} from './user-environment-cache.ts'

export { parseLoginShellEnvironment } from './user-environment-posix.ts'

/** Resolve the account environment through the platform-specific adapter. */
export async function resolveUserEnvironment(
  options: ResolveUserEnvironmentOptions = {},
): Promise<UserEnvironmentResolution> {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return resolveWindowsUserEnvironment(options)

  const base = options.base ?? process.env
  const cache = options.cache ?? defaultEnvironmentCache
  const cacheDisabled = (base.DSH_STUDIO_DISABLE_ENV_CACHE ?? '') === '1'
  const fingerprint = options.cachePath !== undefined && !cacheDisabled
    ? environmentFingerprint(base, platform)
    : ''
  if (fingerprint !== '') {
    const record = cache.read(options.cachePath as string)
    if (record?.version === ENVIRONMENT_CACHE_VERSION && record.fingerprint === fingerprint) {
      return {
        env: { ...base, ...record.env },
        shell: record.env.SHELL ?? null,
        source: 'cached',
      }
    }
  }

  const resolution = await resolvePosixUserEnvironment(options, options.runLoginShell)
  if (resolution.source === 'login-shell' && fingerprint !== '') {
    cache.write(options.cachePath as string, {
      createdAt: Date.now(),
      env: resolution.env,
      fingerprint,
      version: ENVIRONMENT_CACHE_VERSION,
    })
  }
  return resolution
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve a command from a resolved environment without invoking a shell. */
export function findUserExecutable(
  command: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  executable: (path: string) => boolean = isExecutable,
): string | null {
  if (command === '') return null
  const pathApi = platform === 'win32' ? win32 : posix
  const pathEntries = (environment.PATH ?? environment.Path ?? '').split(pathApi.delimiter).filter(Boolean)
  const absolute = pathApi.isAbsolute(command)
  const names = platform === 'win32' && !absolute
    ? [command, ...(environment.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map(extension => `${command}${extension}`)]
    : [command]
  for (const directory of pathEntries) {
    for (const name of names) {
      const candidate = pathApi.isAbsolute(name) ? name : pathApi.join(directory, name)
      if (executable(candidate)) return candidate
    }
  }
  return absolute && executable(command) ? command : null
}

export function userEnvironmentDiagnostics(resolution: UserEnvironmentResolution): string[] {
  const executable = (command: string): string => findUserExecutable(command, resolution.env) ?? 'missing'
  return [
    `environment=${resolution.source}`,
    `environment-shell=${resolution.shell ?? 'unknown'}`,
    `environment-issue=${resolution.issue ?? 'none'}`,
    `environment-codex=${executable('codex')}`,
    `environment-pi=${executable('pi')}`,
    `environment-gh=${executable('gh')}`,
    `environment-node=${executable('node')}`,
  ]
}
