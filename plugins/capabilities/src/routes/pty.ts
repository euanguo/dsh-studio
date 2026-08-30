/** /capabilities pty.* and agent-pty.close handlers: terminal release,
 *  retained projections, restart and agent-terminal close. Split from
 *  routes.ts. */
import {
  optionalInteger,
  requireString,
} from '@dsh-studio/shared/wire'
import type { PtyManager } from '../terminal/pty-manager.ts'
import type { AgentPtyRegistry } from '../terminal/agent-pty.ts'
import { terminalSessionKey } from '../terminal/terminal-session-store.ts'
import type { ApiMethod } from './types.ts'

/** Dependency face for the pty route groups. */
export interface PtyHandlerDeps {
  cwdOf(payload: unknown): { cwd: string }
  ptyManager: PtyManager
  agentPtyRegistry: AgentPtyRegistry
}

/** Build the pty.* route groups, incl. the unwired agent-pty.close orphan. */
export function buildPtyHandlers(deps: PtyHandlerDeps): Record<string, ApiMethod> {
  const { cwdOf, ptyManager, agentPtyRegistry } = deps
  return {
    // Release a terminal immediately. The WebSocket close frame already does
    // this while the socket is open; this route covers the tab-close that
    // happens while the socket is down (reconnect loop), so a closed tab can
    // never hold the per-session quota until the reconnect grace expires.
    'pty.close': (payload) => {
      const { cwd } = cwdOf(payload)
      const tab = requireString(payload, 'tab')
      ptyManager.close(terminalSessionKey(cwd, tab))
      return { ok: true }
    },
    /** List durable inactive terminal projections for one project. */
    'pty.retained': (payload) => {
      const { cwd } = cwdOf(payload)
      return { sessions: ptyManager.retained(cwd) }
    },
    /** Remove one durable inactive terminal projection. */
    'pty.clear-retained': (payload) => {
      const { cwd } = cwdOf(payload)
      const tab = requireString(payload, 'tab')
      ptyManager.clearRetained(cwd, tab)
      return { ok: true }
    },
    /** Restart one shell while preserving its durable history projection. */
    'pty.restart': (payload) => {
      const { cwd } = cwdOf(payload)
      const tab = requireString(payload, 'tab')
      const cols = optionalInteger(payload, 'cols', 2, 1024) ?? 80
      const rows = optionalInteger(payload, 'rows', 2, 1024) ?? 24
      const handle = ptyManager.restart(cwd, tab, cwd, cols, rows)
      return { ok: true, incarnationId: handle.incarnationId }
    },
    // agent-pty.close stays a dormant handler — no agent-terminal sidebar
    // surface calls it today. Idempotent: releasing an already-closed agent
    // pty is a no-op.
    'agent-pty.close': (payload) => {
      const uuid = requireString(payload, 'uuid')
      agentPtyRegistry.close(uuid)
      return { ok: true }
    },
  }
}