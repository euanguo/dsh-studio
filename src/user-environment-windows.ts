/** Windows adapter for the environment block supplied to GUI processes. */

import type {
  ResolveUserEnvironmentOptions,
  UserEnvironmentResolution,
} from './user-environment.ts'

export async function resolveWindowsUserEnvironment(
  options: ResolveUserEnvironmentOptions = {},
): Promise<UserEnvironmentResolution> {
  const base = options.base ?? process.env
  return {
    env: { ...base },
    shell: base.SHELL ?? options.loginShell ?? base.ComSpec ?? base.COMSPEC ?? null,
    source: 'process',
  }
}
