/**
 * Environment contract for an embedded xterm PTY. A desktop terminal must
 * advertise the capabilities of the embedded renderer, not leak the parent
 * terminal emulator's TERMINFO, Kitty, Ghostty, iTerm, or WezTerm state.
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

export interface TerminalSpawnEnvironmentProfile {
  removedKeys: string[]
  advertisedTerm: string
  advertisedColor: string
}

export interface TerminalSpawnEnvironmentResult {
  env: NodeJS.ProcessEnv
  profile: TerminalSpawnEnvironmentProfile
}

export function createTerminalSpawnEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): TerminalSpawnEnvironmentResult {
  const env: NodeJS.ProcessEnv = { ...base }
  const removedKeys: string[] = []
  for (const key of PARENT_TERMINAL_KEYS) {
    if (env[key] !== undefined) {
      delete env[key]
      removedKeys.push(key)
    }
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'oh-dsh'
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
