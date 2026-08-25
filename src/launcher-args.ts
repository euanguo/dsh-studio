/**
 * Argument and environment parsing shared by the standalone Web and TUI
 * launchers. Keeping one copy here is the single source for the flag,
 * boolean, and channel→data-root fallback semantics that used to be
 * {web,tui}.ts's duplicated closures.
 */

import { defaultDshStudioHome, hasDshStudioHomeOverride, type DshStudioChannel } from './data-root.ts'
import { UsageError } from './errors.ts'

/**
 * Parse a `1`/`true`/`0`/`false` launcher environment switch
 * (`DSH_STUDIO_WEB_OPEN`, `DSH_STUDIO_TUI_FULLSCREEN`, ...).
 */
export function parseEnvBoolean(value: string, name: string): boolean {
  const normalized = value.toLowerCase()
  if (normalized === 'true' || value === '1') return true
  if (normalized === 'false' || value === '0') return false
  throw new UsageError(`invalid ${name} value: ${value}`)
}

/**
 * Match an optional `--name <value>` / `--name=<value>` flag against one argv
 * token. Returns the consumed value and the index the caller should continue
 * from; `undefined` means the token is not this flag. `allowEmpty` controls
 * whether `--name=` / `--name ""` is accepted (Web is permissive, TUI is not).
 */
export function matchFlagValue(
  argument: string,
  name: string,
  args: readonly string[],
  index: number,
  allowEmpty: boolean,
): { value: string; next: number } | undefined {
  if (argument === name) {
    const value = args[index + 1]
    if (value === undefined || (value === '' && !allowEmpty)) {
      throw new UsageError(`${name} needs a value`)
    }
    return { value, next: index + 1 }
  }
  if (argument.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1)
    if (value === '' && !allowEmpty) throw new UsageError(`${name} needs a value`)
    return { value, next: index }
  }
  return undefined
}

/**
 * The shared `--channel` → data-root fallback: when a channel was given but no
 * explicit data root and no `DSH_STUDIO_HOME` override, derive the data root
 * from the channel. Otherwise return `current` unchanged.
 */
export function channelDataRootFallback(
  channel: DshStudioChannel | undefined,
  explicitData: boolean,
  env: NodeJS.ProcessEnv,
  current: string,
): string {
  if (channel !== undefined && !explicitData && !hasDshStudioHomeOverride(env)) {
    return defaultDshStudioHome(undefined, channel)
  }
  return current
}