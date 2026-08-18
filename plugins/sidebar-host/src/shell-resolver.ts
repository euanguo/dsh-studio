/**
 * Shell resolution for the sidebar terminals.
 *
 * One resolution chain is shared by the UI-tab PTYs (PtyManager) and the
 * agent-owned terminals (AgentPtyRegistry), so the model-facing
 * `terminal_*` tools and the terminal tabs always run the same shell:
 *
 *   1. `explicit`  — the deployment-provided `shell` config field (host
 *      plugin config; highest authority);
 *   2. `configured` — the settings-page `terminalShell` preference (the
 *      side-card terminal card), an explicit override the user typed;
 *   3. `DSH_SIDEBAR_SHELL` env var — the recommended environment override
 *      for wrappers/launchers;
 *   4. platform chain:
 *      - Windows: first `pwsh.exe` found on PATH / known install dirs
 *        (PowerShell 7 preferred over the inbox 5.1) → `powershell.exe`;
 *      - POSIX: `$SHELL` → the account's login shell from passwd (service
 *        managers often start dsh without `SHELL`) → `/bin/bash`.
 *
 * Every value is trimmed so trailing whitespace cannot leak into the
 * spawned executable path. The resolver accepts injectable platform / env /
 * existence options so the Windows chain is unit-testable on POSIX
 * runners, which never execute win32 branches.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { userInfo } from 'node:os'

/** Inputs for {@link resolveShell}. Every field is optional and defaults to
 *  the live process, keeping the no-argument call site working while tests
 *  pin the platform, the environment and the probe independently. */
export interface ShellResolutionOptions {
  /** Platform override (defaults to `process.platform`). */
  platform?: NodeJS.Platform
  /** Environment override; reads SHELL, DSH_SIDEBAR_SHELL, PATH, ProgramW6432, ProgramFiles, LOCALAPPDATA. */
  env?: NodeJS.ProcessEnv
  /** Explicitly configured shell (the `shell` config field); wins over every automatic source. Empty means unset. */
  explicit?: string
  /** Settings-page shell override (the `terminalShell` preference); after the deployment config, before env/probe. */
  configured?: string
  /** The passwd login-shell value (defaults to `userInfo().shell`); an
   *  override keeps the POSIX chain deterministic in tests, mirroring the
   *  injectable `exists` for the Windows chain. */
  loginShell?: string
  /** File-existence probe override (defaults to `existsSync`). */
  exists?: (path: string) => boolean
}

/**
 * Candidate directories that may contain a `pwsh.exe` on Windows: PATH
 * entries first, then the well-known machine/user install locations
 * (including preview channels and per-user MSI/portable layouts). The
 * machine-scope search reads both `ProgramW6432` and `ProgramFiles` so a
 * 32-bit Node process — whose `ProgramFiles` points at `(x86)` — still
 * finds a 64-bit PowerShell 7 install. De-duped while preserving priority
 * order.
 */
export function windowsPwshCandidateDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = []
  const pathEntries = env.PATH
  if (pathEntries !== undefined) {
    for (const entry of pathEntries.split(';')) {
      const trimmed = entry.trim()
      if (trimmed !== '') dirs.push(trimmed)
    }
  }
  for (const programFiles of [env.ProgramW6432, env.ProgramFiles]) {
    if (programFiles === undefined || programFiles.trim() === '') continue
    dirs.push(join(programFiles, 'PowerShell', '7'))
    dirs.push(join(programFiles, 'PowerShell', '7-preview'))
  }
  const localAppData = env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData.trim() !== '') {
    dirs.push(join(localAppData, 'Microsoft', 'PowerShell', '7'))
    dirs.push(join(localAppData, 'Microsoft', 'PowerShell', '7-preview'))
    dirs.push(join(localAppData, 'Programs', 'PowerShell', '7'))
    dirs.push(join(localAppData, 'Programs', 'PowerShell', '7-preview'))
  }
  return [...new Set(dirs)]
}

/** A non-empty trimmed value, or undefined when blank. */
function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim() ?? ''
  return result === '' ? undefined : result
}

/**
 * Resolve the interactive shell for this platform. See the module doc for
 * the priority chain; each step returns the trimmed value or falls through.
 */
export function resolveShell(options: ShellResolutionOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync

  const explicit = trimmed(options.explicit)
  if (explicit !== undefined) return explicit
  const configured = trimmed(options.configured)
  if (configured !== undefined) return configured
  const envShell = trimmed(env.DSH_SIDEBAR_SHELL)
  if (envShell !== undefined) return envShell

  if (platform === 'win32') {
    for (const dir of windowsPwshCandidateDirs(env)) {
      const candidate = join(dir, 'pwsh.exe')
      if (exists(candidate)) return candidate
    }
    return 'powershell.exe'
  }

  const she = trimmed(env.SHELL)
  if (she !== undefined) return she
  // userInfo() throws when the uid has no passwd entry (rare chroots);
  // without a login shell there is nothing better than the bash default.
  try {
    const loginShell = trimmed(options.loginShell ?? userInfo().shell ?? undefined)
    if (loginShell !== undefined) return loginShell
  } catch {
    // no passwd entry: fall through to /bin/bash
  }
  return '/bin/bash'
}

/**
 * Spawn arguments that make the shell behave like a terminal-emulator tab:
 * POSIX shells start as login shells (`-l`) so they read the profile files
 * (`~/.profile`, `~/.zprofile`); Windows PowerShell takes no login flag.
 */
export function shellSpawnArgs(platform?: NodeJS.Platform): string[] {
  return (platform ?? process.platform) === 'win32' ? [] : ['-l']
}

/** Candidate order used after a retryable spawn failure. */
export function resolveShellCandidates(options: ShellResolutionOptions = {}): string[] {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const primary = resolveShell(options)
  const candidates = [primary]
  if (platform === 'win32') {
    for (const dir of windowsPwshCandidateDirs(env)) candidates.push(join(dir, 'pwsh.exe'))
    candidates.push('pwsh.exe', 'powershell.exe')
  } else {
    const shell = trimmed(env.SHELL)
    if (shell !== undefined) candidates.push(shell)
    const loginShell = trimmed(options.loginShell)
    if (loginShell !== undefined) candidates.push(loginShell)
    candidates.push('/bin/bash', '/bin/sh')
  }
  return [...new Set(candidates)]
}

/** Only shell lookup failures should advance to the next candidate. */
export function isRetryableShellSpawnError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const record = error as { code?: unknown; message?: unknown }
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : ''
  return code === 'ENOENT'
    || code === 'EACCES'
    || message.includes('not found')
    || message.includes('posix_spawnp')
    || (message.includes('spawn') && message.includes('failed'))
}
