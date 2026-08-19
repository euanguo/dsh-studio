/**
 * Environment contract for an embedded xterm PTY. A desktop terminal must
 * advertise the capabilities of the embedded renderer, not leak the parent
 * terminal emulator's TERMINFO, Kitty, Ghostty, iTerm, or WezTerm state —
 * and it must not inherit the parent process's COLOR-SUPPRESSION policy.
 *
 * The embedded renderer is a true xterm-256color/truecolor terminal, so a
 * child shell and its commands (codex, ls, grep --color, …) must be able to
 * emit color. `NO_COLOR` (no-color.org: presence disables color in any
 * tool) and a disabling `FORCE_COLOR` / `CLICOLOR` / `CLICOLOR_FORCE`
 * would force every child into monochrome, which is why they are stripped
 * and `CLICOLOR=1` is re-asserted (macOS `ls` and friends colorize only on
 * an explicit opt-in).
 */

const PARENT_TERMINAL_KEYS = [
  'TERMINFO',
  'TERMINFO_DIRS',
  'COLORTERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'KITTY_WINDOW_ID',
  'KITTY_LISTEN_ON',
  'KITTY_PID',
  'GHOSTTY_RESOURCES_DIR',
  'GHOSTTY_BIN_DIR',
  'GHOSTTY_SHELL_INTEGRATION',
  'ITERM_SESSION_ID',
  'ITERM_PROFILE',
  'WEZTERM_EXECUTABLE',
  'WEZTERM_PANE',
  'WEZTERM_UNIX_SOCKET',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
] as const

/**
 * Color-policy variables that must not leak from the parent. `NO_COLOR` is
 * stripped unconditionally (its presence is the disable signal); the
 * `*_FORCE`-style switches are stripped only when their value is a
 * disabling one, so a user who explicitly set `FORCE_COLOR=1` keeps it.
 */
const PARENT_COLOR_POLICY_KEYS = [
  'NO_COLOR',
  'FORCE_COLOR',
  'CLICOLOR',
  'CLICOLOR_FORCE',
] as const

const DISABLING_COLOR_VALUES = new Set(['', '0', 'false', 'no', 'off'])

export interface TerminalSpawnEnvironmentProfile {
  removedKeys: string[]
  advertisedTerm: string
  advertisedColor: string
}

export interface TerminalSpawnEnvironmentResult {
  env: NodeJS.ProcessEnv
  profile: TerminalSpawnEnvironmentProfile
}

function isDisablingColorValue(value: string | undefined): boolean {
  if (value === undefined) return false
  return DISABLING_COLOR_VALUES.has(value.trim().toLowerCase())
}

export function createTerminalSpawnEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): TerminalSpawnEnvironmentResult {
  const env: NodeJS.ProcessEnv = { ...base }
  const removedKeys: string[] = []
  const remove = (key: string): void => {
    if (env[key] !== undefined) {
      delete env[key]
      removedKeys.push(key)
    }
  }
  for (const key of PARENT_TERMINAL_KEYS) {
    if (env[key] !== undefined) remove(key)
  }
  for (const key of PARENT_COLOR_POLICY_KEYS) {
    if (key === 'NO_COLOR') {
      remove(key)
    } else if (isDisablingColorValue(env[key])) {
      remove(key)
    }
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'dsh-studio'
  // Re-assert color capability: many macOS tools (ls, …) colorize only when
  // the variable is present, and this terminal is always a real TTY.
  env.CLICOLOR = '1'
  return {
    env,
    profile: {
      removedKeys,
      advertisedTerm: env.TERM,
      advertisedColor: env.COLORTERM,
    },
  }
}

export function mergeTerminalSpawnEnvironment(
  base: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv | undefined,
): TerminalSpawnEnvironmentResult {
  const merged: NodeJS.ProcessEnv = { ...base }
  if (overrides !== undefined) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete merged[key]
      else merged[key] = value
    }
  }
  return createTerminalSpawnEnvironment(merged)
}
