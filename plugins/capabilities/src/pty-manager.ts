/**
 * PTY session table for the sidebar terminals. One node-pty process per
 * `${sessionId}:${tabId}` key; processes survive WebSocket disconnects
 * (page refresh, tab switch) and reconnect to the same process by key.
 * Output is mirrored into a bounded transcript ring and a durable session
 * projection so a new connection or a later host restart can replay history.
 * Explicit tab closes tombstone the incarnation; plugin teardown retains
 * inactive history while killing the live process.
 */
import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as nodePty from 'node-pty'
import { CapabilityError } from '@dsh-studio/shared/wire'
import { resolveShell, type ShellResolutionOptions } from './shell-resolver.ts'
import { spawnTerminalPty } from './terminal-spawn.ts'
import { defaultProcessTreeKiller } from './process-tree-killer.ts'
import {
  terminalHistoryLimitsForRows,
} from '@dsh-studio/shared/terminal-scrollback-policy'
import { TerminalHistoryBuffer } from './terminal-history.ts'
import { TerminalHistorySanitizer } from './terminal-history-sanitizer.ts'
import { TerminalSessionStore, terminalSessionKey } from './terminal-session-store.ts'
import {
  DEFAULT_TERMINAL_RUNTIME_POLICY,
  type TerminalRuntimePolicy,
} from './terminal-policy.ts'
import {
  createTerminalModeReplayTracker,
  type TerminalModeReplayTracker,
} from './terminal-mode-replay.ts'

/**
 * Restore the executable bit pnpm strips from node-pty's prebuilt
 * spawn-helper (the macOS helper that forks and sets up the pty). Without it
 * every spawn fails with `posix_spawnp failed`. Idempotent; mirrors
 * @deepseek-ai/dsh-terminal-bash's ensure-spawn-helper postinstall, run at
 * plugin activation so link-installed deployments get the fix too.
 */
export function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('node-pty')
    const packageRoot = dirname(dirname(entry))
    const candidates = [
      join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      join(packageRoot, 'build', 'Release', 'spawn-helper'),
    ]
    for (const helper of candidates) {
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  } catch {
    // Resolution or chmod failure: the terminal surfaces its own spawn error.
  }
}

/** One live terminal. */
export interface CapabilitiesPty {
  /** `${cwd}:${tabId}` registry key — the terminal is PROJECT-scoped. */
  key: string
  /** The project cwd owning this terminal (project-shared PTY). */
  cwd: string
  tabId: string
  /** Incarnation token fences stale socket close/reconnect races. */
  incarnationId: string
  /** The working directory the process was SPAWNED with (a reconnect that
   *  resolves a different authoritative cwd respawns instead of reusing —
   *  the page-load hydrate race can attach the real cwd after the first
   *  connect, and a shell in the wrong directory must not linger). */
  spawnCwd: string
  pty: nodePty.IPty
  /** Replay-safe append-optimized scrollback history buffer. */
  history: TerminalHistoryBuffer
  /** Replay-safe visible history with cursor/mode controls removed. */
  replayHistory: TerminalHistoryBuffer
  replaySanitizer: TerminalHistorySanitizer
  /** Headless xterm state used to reconstruct active TUI screen/modes. */
  modeReplay: TerminalModeReplayTracker | null
  /** Raw output accumulated since spawn (string projection of history). */
  transcript: string
  /** Replay-safe output projection for xterm reconnect. */
  replayTranscript: string
  /** Whether the top-level process exited (transcript stays replayable). */
  exited: boolean
  /** Internal history listeners detached before an explicit close/restart. */
  dataSubscription?: { dispose(): void }
  exitSubscription?: { dispose(): void }
  exitCode?: number | null
}

/**
 * The terminal registry. `maxPerProject` bounds concurrent processes per
 * project (B1: terminals are project-shared, so the cap is per cwd, not per
 * conversation — the client caps tabs at the same number).
 */
export interface PtyManagerOptions {
  getPolicy?: () => TerminalRuntimePolicy
  store?: TerminalSessionStore
}

export class PtyManager {
  private readonly sessions = new Map<string, CapabilitiesPty>()
  private readonly pendingCloses = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly killEscalations = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly getShell: () => string
  private readonly maxPerProject: number
  private readonly getPolicy: () => TerminalRuntimePolicy
  private readonly store: TerminalSessionStore

  /**
   * @param getShell - resolves the shell AT SPAWN TIME (a thunk, not a fixed
   *   value): a later terminalShell preference change takes effect for NEW
   *   terminals while already-open processes keep their shell, matching the
   *   upstream "new terminals only" contract.
   * @param maxPerProject - concurrent process bound per project cwd.
   */
  constructor(
    getShell: () => string,
    maxPerProject: number,
    options: PtyManagerOptions = {},
  ) {
    this.getShell = getShell
    this.maxPerProject = maxPerProject
    this.getPolicy = options.getPolicy ?? (() => DEFAULT_TERMINAL_RUNTIME_POLICY)
    this.store = options.store ?? new TerminalSessionStore({
      maxRetainedInactiveSessions: () => this.getPolicy().retainedInactiveSessions,
      historyLimits: () => ({
        maxLines: this.getPolicy().scrollbackRows,
        maxBytes: Math.max(1_048_576, this.getPolicy().scrollbackRows * 120),
      }),
    })
  }

  /** All live terminal keys of one project (cwd). */
  keysOf(cwd: string): string[] {
    const keys: string[] = []
    for (const handle of this.sessions.values()) {
      if (handle.cwd === cwd) keys.push(handle.key)
    }
    return keys
  }

  /**
   * Open (or reuse) the terminal for a project/tab key. A handle whose
   * process already exited is replaced with a fresh spawn (reconnecting a
   * dead terminal must yield a live shell, not an input sink), and so is a
   * live handle whose spawn cwd differs from the now-authoritative one (the
   * first connect of a page load can arrive before the project hydrates, so
   * it fell back to the process cwd — reconnecting with the real cwd must
   * restart the shell in the right directory). Reopening also cancels any
   * pending scheduled close (a reconnect within the grace window keeps the
   * process alive).
   * @param cwd - the project working directory (the terminal's owner).
   * @param tabId - client tab id.
   * @param spawnCwd - initial working directory of the shell.
   * @param cols - initial terminal width.
   * @param rows - initial terminal height.
   * @returns the live handle.
   * @throws {CapabilityError} pty-error when the per-project cap is reached.
   */
  open(cwd: string, tabId: string, spawnCwd: string, cols: number, rows: number): CapabilitiesPty {
    const key = terminalSessionKey(cwd, tabId)
    this.cancelClose(key)
    const existing = this.sessions.get(key)
    if (existing !== undefined && !existing.exited && existing.spawnCwd === spawnCwd) {
      this.store.ensure({ cwd, tabId, spawnCwd, cols, rows })
      return existing
    }
    if (existing !== undefined) this.close(key)
    // Zombie cleanup: a project's exited handles (shell closed, tab dropped
    // on an old host without the close frame) must not eat the quota.
    for (const [candidate, handle] of [...this.sessions]) {
      if (handle.cwd === cwd && handle.exited) this.close(candidate)
    }
    if (this.keysOf(cwd).length >= this.maxPerProject) {
      throw new CapabilityError('pty-error', `terminal limit reached (${this.maxPerProject}) for this project`, 400)
    }
    const policy = this.getPolicy()
    const limits = terminalHistoryLimitsForRows(policy.scrollbackRows)
    const restored = this.store.ensure({ cwd, tabId, spawnCwd, cols, rows })
    const history = TerminalHistoryBuffer.fromString(restored.rawHistory, limits)
    const replayHistory = TerminalHistoryBuffer.fromString(restored.replayHistory, limits)
    const replaySanitizer = new TerminalHistorySanitizer()
    let modeReplay: TerminalModeReplayTracker | null = null
    try {
      modeReplay = createTerminalModeReplayTracker(
        Math.max(2, Math.floor(cols)),
        Math.max(2, Math.floor(rows)),
      )
      if (restored.rawHistory !== '') modeReplay.feed(restored.rawHistory)
    } catch {
      // The renderer remains usable if an optional headless adapter is absent;
      // replay falls back to the sanitized scrollback projection.
    }
    const handle: CapabilitiesPty = {
      key,
      cwd,
      tabId,
      incarnationId: restored.incarnationId,
      spawnCwd,
      pty: spawnTerminalPty({
        shell: this.getShell(),
        cols,
        rows,
        cwd: spawnCwd,
      }),
      history,
      replayHistory,
      replaySanitizer,
      modeReplay,
      get transcript(): string {
        return this.history.toString()
      },
      get replayTranscript(): string {
        return this.replayHistory.toString()
      },
      exited: false,
    }
    handle.dataSubscription = handle.pty.onData((data) => {
      handle.modeReplay?.feed(data)
      handle.history.append(data)
      const sanitized = handle.replaySanitizer.feed(data)
      // Erase-screen (clear / Ctrl+L / clear -x): the retained projection is
      // what a reconnect replays into a fresh xterm — text the user erased
      // must not resurface there. Reset to the post-clear state; the live
      // screen needs nothing (xterm already processed the erase).
      if (sanitized.clearScreen) handle.replayHistory.reset()
      handle.replayHistory.append(sanitized.visibleText)
      this.store.queueUpdate(key, () => ({
        rawHistory: handle.transcript,
        replayHistory: handle.replayTranscript,
        cols: handle.pty.cols,
        rows: handle.pty.rows,
      }))
    })
    handle.exitSubscription = handle.pty.onExit(({ exitCode }) => {
      handle.exited = true
      handle.exitCode = exitCode
      this.clearKillEscalation(key)
      this.store.queueUpdate(key, () => ({
        rawHistory: handle.transcript,
        replayHistory: handle.replayTranscript,
        cols: handle.pty.cols,
        rows: handle.pty.rows,
        status: 'inactive',
      }))
    })
    this.sessions.set(key, handle)
    return handle
  }

  /**
   * Schedule the terminal's destruction after `delayMs`. A tab close sends
   * delay 0 (release the quota immediately); a bare socket drop (refresh,
   * crash) uses the grace period so a quick reconnect keeps the process.
   * `open()` cancels any pending close.
   */
  scheduleClose(key: string, delayMs: number, incarnationId?: string): void {
    const handle = this.sessions.get(key)
    if (handle === undefined) return
    this.cancelClose(key)
    const timer = setTimeout(() => { this.close(key, incarnationId) }, Math.max(0, delayMs))
    timer.unref?.()
    this.pendingCloses.set(key, timer)
  }

  /** Cancel a pending scheduled close (the terminal is being reopened). */
  cancelClose(key: string): void {
    const timer = this.pendingCloses.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.pendingCloses.delete(key)
    }
  }

  /** Resolve retained inactive project metadata for management routes. */
  retained(cwd: string): Array<{
    tabId: string
    cwd: string
    incarnationId: string
    updatedAt: number
    historyBytes: number
  }> {
    return this.store.listInactive()
      .filter(record => record.cwd === cwd)
      .map(record => ({
        tabId: record.tabId,
        cwd: record.cwd,
        incarnationId: record.incarnationId,
        updatedAt: record.updatedAt,
        historyBytes: Buffer.byteLength(record.rawHistory, 'utf8'),
      }))
  }

  /** Delete one retained project terminal without affecting a live PTY. */
  clearRetained(cwd: string, tabId: string): void {
    const key = terminalSessionKey(cwd, tabId)
    if (this.sessions.has(key)) {
      throw new CapabilityError('bad-request', 'cannot clear a running terminal; close it first', 409)
    }
    this.store.clear(key)
  }

  /** Stop and respawn a shell while retaining the durable history projection. */
  restart(cwd: string, tabId: string, spawnCwd: string, cols: number, rows: number): CapabilitiesPty {
    const key = terminalSessionKey(cwd, tabId)
    const existing = this.sessions.get(key)
    if (existing !== undefined) {
      this.cancelClose(key)
      this.sessions.delete(key)
      existing.dataSubscription?.dispose()
      existing.exitSubscription?.dispose()
      existing.modeReplay?.dispose()
      this.clearKillEscalation(key)
      this.store.markInactive(key, {
        rawHistory: existing.transcript,
        replayHistory: existing.replayTranscript,
        cols: existing.pty.cols,
        rows: existing.pty.rows,
      })
      try { this.terminateProcessTree(existing) } catch { /* already gone */ }
    }
    return this.open(cwd, tabId, spawnCwd, cols, rows)
  }

  private clearKillEscalation(key: string): void {
    const timer = this.killEscalations.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    this.killEscalations.delete(key)
  }

  private terminateProcessTree(handle: CapabilitiesPty): void {
    const pid = handle.pty.pid
    if (!Number.isInteger(pid) || pid <= 0) {
      handle.pty.kill()
      return
    }
    this.clearKillEscalation(handle.key)
    const capturedTree = defaultProcessTreeKiller.capture(pid)
    defaultProcessTreeKiller.signalCaptured(pid, capturedTree, 'SIGTERM')
    if (process.platform === 'win32') return
    const timer = setTimeout(() => {
      this.killEscalations.delete(handle.key)
      if (!handle.exited) {
        defaultProcessTreeKiller.signalCaptured(pid, capturedTree, 'SIGKILL')
      }
    }, this.getPolicy().processKillGraceMs)
    timer.unref?.()
    this.killEscalations.set(handle.key, timer)
  }


  close(key: string, expectedIncarnationId?: string): void {
    this.cancelClose(key)
    const handle = this.sessions.get(key)
    if (handle === undefined) return
    if (expectedIncarnationId !== undefined && handle.incarnationId !== expectedIncarnationId) return
    this.sessions.delete(key)
    handle.dataSubscription?.dispose()
    handle.exitSubscription?.dispose()
    handle.modeReplay?.dispose()
    this.clearKillEscalation(key)
    this.store.close(key, handle.incarnationId)
    try {
      this.terminateProcessTree(handle)
    } catch {
      // Already exited or gone; nothing left to kill.
    }
  }

  /** Close every terminal while retaining durable history for a later restore. */
  async disposeAll(): Promise<void> {
    for (const timer of this.pendingCloses.values()) clearTimeout(timer)
    this.pendingCloses.clear()
    for (const [key, handle] of [...this.sessions]) {
      this.sessions.delete(key)
      handle.dataSubscription?.dispose()
      handle.exitSubscription?.dispose()
      handle.modeReplay?.dispose()
      this.clearKillEscalation(key)
      this.store.markInactive(key, {
        rawHistory: handle.transcript,
        replayHistory: handle.replayTranscript,
        cols: handle.pty.cols,
        rows: handle.pty.rows,
      })
      try {
        this.terminateProcessTree(handle)
      } catch {
        // Already exited or gone; nothing left to kill.
      }
    }
    this.store.flushSync()
    const deadline = Date.now() + this.getPolicy().processKillGraceMs + 50
    while (this.killEscalations.size > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await this.store.flush()
  }

  /** Flush retained metadata before a host teardown completes. */
  async flush(): Promise<void> {
    await this.store.flush()
  }
}

/**
 * The interactive shell for this platform — compatibility wrapper over
 * {@link resolveShell} for callers that do not need injectable options
 * (the plugin body resolves through the settings-aware thunk instead).
 * Chain: deployment `shell` config → settings `terminalShell` →
 * `DSH_SIDEBAR_SHELL` → Windows pwsh probe / POSIX login-shell chain →
 * platform fallback. See shell-resolver.ts for the full contract.
 */
export function defaultShell(options?: ShellResolutionOptions): string {
  return resolveShell(options)
}
