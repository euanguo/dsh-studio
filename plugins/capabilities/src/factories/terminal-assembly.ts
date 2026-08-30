/**
 * Terminal-side construction for the capability gateway: the session store,
 * the UI-tab PtyManager, the agent-owned registry, their shared policy/shell
 * thunks, and the worktree delegation registry. Construction order and the
 * lazy thunks mirror what `apply()` historically inlined — settings commit
 * hooks feed {@link TerminalAssembly.setShellFromPrefs} so a settings change
 * takes effect for NEW terminals while already-open processes keep theirs
 * (the shell chain resolves at spawn time through the deployment config →
 * settings `terminalShell` → env/probe/login fallbacks).
 */
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { ensureSpawnHelper, PtyManager } from '../terminal/pty-manager.ts'
import { TerminalSessionStore } from '../terminal/terminal-session-store.ts'
import { TerminalSubscriptionCoordinator } from '../terminal/terminal-subscription-coordinator.ts'
import {
  normalizeTerminalRuntimePolicy,
  type TerminalRuntimePolicy,
} from '../terminal/terminal-policy.ts'
import { resolveShell } from '../shell-resolver.ts'
import { AgentPtyRegistry } from '../terminal/agent-pty.ts'
import { WorktreeDelegationRegistry } from '../worktree/worktree-orchestration.ts'
import { resolveDefaultWorktreeRoot } from '@dsh-studio/shared/worktree-preferences'
import type { SidebarPrefs } from '@dsh-studio/shared/prefs-shared'
import type { Context } from '../context-types.ts'
import type { ResolvedCapabilitiesConfig } from '../config.ts'

export interface TerminalAssembly {
  terminalStoreRoot: string
  terminalStore: TerminalSessionStore
  terminalSubscriptions: TerminalSubscriptionCoordinator
  ptyManager: PtyManager
  agentPtyRegistry: AgentPtyRegistry
  worktreeDelegations: WorktreeDelegationRegistry
  getTerminalPolicy(): TerminalRuntimePolicy
  /** Feed the latest committed prefs so shell resolution follows settings. */
  setShellFromPrefs(prefs: SidebarPrefs): void
}

export function createTerminalAssembly(
  ctx: Context,
  opts: { resolved: ResolvedCapabilitiesConfig; getPrefs: () => SidebarPrefs },
): TerminalAssembly {
  // pnpm strips the executable bit from node-pty's prebuilt spawn-helper;
  // restore it before any terminal can spawn (idempotent).
  ensureSpawnHelper()
  const { resolved } = opts
  const getTerminalPolicy = (): TerminalRuntimePolicy => {
    const prefs = opts.getPrefs()
    return normalizeTerminalRuntimePolicy({
      scrollbackRows: prefs.terminalScrollbackRows,
      reconnectGraceMs: prefs.terminalReconnectGraceMs ?? resolved.reconnectGraceMs,
      processKillGraceMs: prefs.terminalProcessKillGraceMs,
      retainedInactiveSessions: prefs.terminalRetainedInactiveSessions,
    })
  }
  // M1: the host-resolved DSH data root, derived channel-aware through the
  // shared worktree-defaults resolver (honors DSH_STUDIO_HOME override and the
  // stable/dev sibling pair; injected instead of env-guessed so a bare launch
  // can never write dev history into the stable root). The terminal store
  // owns only the `terminal-sessions` child under it.
  const terminalStoreRoot = dirname(resolveDefaultWorktreeRoot(process.env, homedir()))
  const terminalStore = new TerminalSessionStore({
    root: terminalStoreRoot,
    maxRetainedInactiveSessions: () => getTerminalPolicy().retainedInactiveSessions,
    historyLimits: { maxLines: 50_000, maxBytes: 8 * 1024 * 1024 },
  })
  const terminalSubscriptions = new TerminalSubscriptionCoordinator()
  let settingsShell: string | undefined
  const getShell = (): string => resolveShell({
    ...(resolved.shell === undefined ? {} : { explicit: resolved.shell }),
    ...(settingsShell === undefined ? {} : { configured: settingsShell }),
  })
  const ptyManager = new PtyManager(getShell, resolved.terminalsPerSession, {
    getPolicy: getTerminalPolicy,
    store: terminalStore,
    storeRoot: terminalStoreRoot,
  })
  // The agent-owned terminal registry is parallel to the UI-tab registry and
  // shares policy (scrollback and configurable kill escalation).
  const agentPtyRegistry = new AgentPtyRegistry(getShell, {
    getPolicy: getTerminalPolicy,
  })
  const worktreeDelegations = new WorktreeDelegationRegistry(ctx)
  return {
    terminalStoreRoot,
    terminalStore,
    terminalSubscriptions,
    ptyManager,
    agentPtyRegistry,
    worktreeDelegations,
    getTerminalPolicy,
    setShellFromPrefs: (prefs) => { settingsShell = prefs.terminalShell },
  }
}
