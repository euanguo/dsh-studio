import { accessSync, constants } from 'node:fs'
import { posix, win32 } from 'node:path'
import { resolvePosixUserEnvironment } from './user-environment-posix.ts'
import { resolveWindowsUserEnvironment } from './user-environment-windows.ts'

export type UserEnvironmentSource = 'login-shell' | 'process'
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
  loginShell?: string
  platform?: NodeJS.Platform
  runLoginShell?: LoginShellRunner
}

export { parseLoginShellEnvironment } from './user-environment-posix.ts'

/** Resolve the account environment through the platform-specific adapter. */
export async function resolveUserEnvironment(
  options: ResolveUserEnvironmentOptions = {},
): Promise<UserEnvironmentResolution> {
  return (options.platform ?? process.platform) === 'win32'
    ? resolveWindowsUserEnvironment(options)
    : resolvePosixUserEnvironment(options, options.runLoginShell)
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
  ]
}
