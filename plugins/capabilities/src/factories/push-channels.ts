/**
 * The gateway's push channels: one terminal WebSocket upgrade serving both
 * UI-tab terminals (?tab=...) and agent-owned terminals (?uuid=...), the
 * agent-terminals list push for the sidebar view, and the git freshness
 * watcher (one cheap status-fingerprint loop per subscribed cwd replacing
 * the sidebar's fixed poll — see git/git-watch.ts). All three ride the same
 * browser-trust fence as the JSON API.
 */
import { WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import { attachAgentList, attachTerminal } from '../terminal/terminal-route.ts'
import { GitWatchCoordinator, attachGitWatch } from '../git/git-watch.ts'
import type { AgentPtyRegistry } from '../terminal/agent-pty.ts'
import type { PtyManager } from '../terminal/pty-manager.ts'
import type { TerminalSubscriptionCoordinator } from '../terminal/terminal-subscription-coordinator.ts'
import type { TerminalRuntimePolicy } from '../terminal/terminal-policy.ts'
import type { Context } from '../context-types.ts'

export interface PushChannels {
  wss: WebSocketServer
  agentListWss: WebSocketServer
  gitWatchWss: WebSocketServer
  gitWatchCoordinator: GitWatchCoordinator
}

export function registerPushChannels(
  ctx: Context,
  opts: {
    fence(req: IncomingMessage): boolean
    ptyManager: PtyManager
    agentPtyRegistry: AgentPtyRegistry
    terminalSubscriptions: TerminalSubscriptionCoordinator
    getTerminalPolicy(): TerminalRuntimePolicy
  },
): PushChannels {
  // ── Terminal WebSocket ──────────────────────────────────────────────────
  // Input frames are raw text, resize frames are JSON
  // `{type:'resize',cols,rows}`, and a close frame `{type:'close'}` releases
  // the underlying pty (immediate for agent terminals, scheduled-0 for UI
  // tabs which keep the same reconnect grace contract the host has always
  // had).
  const wss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/capabilities/ws/terminal',
    handler: (req, socket, head) => {
      if (!opts.fence(req)) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void attachTerminal(ctx, opts.ptyManager, opts.agentPtyRegistry, opts.terminalSubscriptions, ws, req, opts.getTerminalPolicy)
      })
    },
  }), 'capabilities: terminal WebSocket')

  // ── Agent terminals push WebSocket ──────────────────────────────────────
  // Pushes the live list of agent terminals for one session; the client
  // reconciles by adding tabs for new uuids and dropping tabs whose uuids
  // disappeared (closing a tab sends `{type:'close'}` on the terminal WS,
  // which kills the pty, which fires a change here, which converges).
  const agentListWss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/capabilities/ws/agent-terminals',
    handler: (req, socket, head) => {
      if (!opts.fence(req)) {
        socket.destroy()
        return
      }
      agentListWss.handleUpgrade(req, socket, head, (ws) => {
        void attachAgentList(opts.agentPtyRegistry, ws, req)
      })
    },
  }), 'capabilities: agent-terminals push WebSocket')

  // ── Git freshness push WebSocket ────────────────────────────────────────
  const gitWatchWss = new WebSocketServer({ noServer: true })
  const gitWatchCoordinator = new GitWatchCoordinator()
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/capabilities/ws/git-watch',
    handler: (req, socket, head) => {
      if (!opts.fence(req)) {
        socket.destroy()
        return
      }
      gitWatchWss.handleUpgrade(req, socket, head, (ws) => {
        attachGitWatch(gitWatchCoordinator, ws, req)
      })
    },
  }), 'capabilities: git-watch push WebSocket')

  return { wss, agentListWss, gitWatchWss, gitWatchCoordinator }
}
