/**
 * /capabilities terminal WebSocket wiring: attach one socket to a pty
 * (UI-tab or agent-owned), replay the transcript, pump both directions and
 * own the output pause/resume ref-counting across the two socket modes.
 * Split from index.ts.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WebSocket } from 'ws'
import type { Context } from '../context-types.ts'
import type { AgentPtyRegistry } from './agent-pty.ts'
import { clampDims } from './agent-pty.ts'
import type { PtyManager } from './pty-manager.ts'
import { TerminalOutputBatcher } from './terminal-batcher.ts'
import type { TerminalSubscriptionCoordinator } from './terminal-subscription-coordinator.ts'
import { buildTerminalReplayPayload, type TerminalReplaySource } from './terminal-replay.ts'
import type { TerminalRuntimePolicy } from './terminal-policy.ts'
import { sessionCwdOf } from '../routes/shared.ts'
import type { TerminalOutputAck, TerminalOutputFrame } from '@dsh-studio/shared/terminal-wire'
import { errorMessage } from '@dsh-studio/shared/errors'

/** A pty that honors output pause/resume while a newer socket is still
 *  flow-controlled. */
type PausablePty = { pause(): void; resume(): void }
const ptyPauseOwners = new Map<string, Set<string>>()

function setPtyOutputPaused(
  key: string,
  pty: PausablePty,
  owner: string,
  paused: boolean,
): void {
  const owners = ptyPauseOwners.get(key) ?? new Set<string>()
  if (paused) owners.add(owner)
  else owners.delete(owner)
  if (owners.size === 0) {
    ptyPauseOwners.delete(key)
    pty.resume()
  } else {
    ptyPauseOwners.set(key, owners)
    pty.pause()
  }
}

function releasePtyOutputOwner(key: string, pty: PausablePty, owner: string): void {
  const owners = ptyPauseOwners.get(key)
  if (owners === undefined || !owners.delete(owner)) return
  if (owners.size === 0) {
    ptyPauseOwners.delete(key)
    pty.resume()
  } else {
    ptyPauseOwners.set(key, owners)
  }
}

/** Push the live agent-terminal list for one session to a connected sidebar view. */
export async function attachAgentList(
  registry: AgentPtyRegistry,
  ws: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null) {
      ws.close(1008, 'sessionId is required')
      return
    }
    const send = (): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(registry.list(sessionId)))
      }
    }
    send()
    const unsubscribe = registry.subscribe(send)
    ws.on('close', () => { unsubscribe() })
    ws.on('error', () => { unsubscribe() })
  } catch (error) {
    ws.close(1011, errorMessage(error))
  }
}

function sendReplayFrame(
  batcher: TerminalOutputBatcher,
  handle: TerminalReplaySource,
  ws: WebSocket,
): void {
  const replay = buildTerminalReplayPayload(handle)
  if (replay === '' || ws.readyState !== WebSocket.OPEN) return
  const replayFrame: TerminalOutputFrame = {
    type: 'output',
    epoch: batcher.outputEpoch,
    sequence: 0,
    bytes: Buffer.byteLength(replay, 'utf8'),
    data: replay,
    replay: true,
  }
  ws.send(JSON.stringify(replayFrame))
}

/** The pty surface a socket pump drives (shared by UI-tab and agent handles). */
interface PumpPty {
  resize(cols: number, rows: number): void
  write(text: string): void
  pause(): void
  resume(): void
  /** node-pty subscription surface consumed by the coordinator. */
  onData(callback: (data: string) => void): { dispose(): void }
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

/** Options for {@link createTerminalSocketPump}. */
interface TerminalSocketPumpOptions {
  terminalSubscriptions: TerminalSubscriptionCoordinator
  ws: WebSocket
  handle: {
    pty: PumpPty
    modeReplay?: { resize(cols: number, rows: number): void } | null
    exited: boolean
  } & TerminalReplaySource
  /** Pause-owner key (the UI/agent output-key namespace). */
  outputKey: string
  /** Runs on a `{type:'close'}` frame after the socket severs. */
  onCloseFrame(): void
  /** Runs on a bare socket drop (reconnect grace / agent-lifetime policy). */
  onSocketClose(): void
  /**
   * When true an unrecognized JSON control frame is forwarded as terminal
   * input (the UI-tab path); when false it is dropped (the agent path, where
   * no realistic JSON input exists).
   */
  forwardUnparsedJson: boolean
  /**
   * When true, a process that already exited ignores every subsequent frame
   * including ack/resync (the agent path); when false only input/resize are
   * gated on `exited` while ack/resync still work (the UI-tab path).
   */
  guardExitedFirst: boolean
}

/**
 * One socket ↔ pty pump, shared by the UI-tab and agent attach modes (RD-24).
 * Batcher construction, data/exit forwarding, control-frame parsing
 * (close/ack/resync/resize), replay and socket-close cleanup were duplicated
 * across the two paths; this single pump keeps them identical and gives the
 * close frame one authoritative short-circuit (D16): once `{type:'close'}`
 * is seen, `closing` ignores every later data/control frame instead of just
 * gating input, so a stale socket can never drive a pty it asked to close.
 */
function createTerminalSocketPump(options: TerminalSocketPumpOptions): void {
  const { terminalSubscriptions, ws, handle, outputKey, onCloseFrame, onSocketClose, forwardUnparsedJson, guardExitedFirst } = options
  const outputOwner = randomUUID()
  const batcher = new TerminalOutputBatcher({
    send: frame => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify(frame))
    },
    bufferedAmount: () => ws.bufferedAmount,
    pause: () => { setPtyOutputPaused(outputKey, handle.pty, outputOwner, true) },
    resume: () => { setPtyOutputPaused(outputKey, handle.pty, outputOwner, false) },
  })
  const onData = (data: string): void => { batcher.append(data) }
  const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
    batcher.append(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
    batcher.flush()
    releasePtyOutputOwner(outputKey, handle.pty, outputOwner)
  }
  // Subscribe before taking the replay snapshot. Any bytes produced during
  // the snapshot are queued behind it in WebSocket order, so reconnects do
  // not create a history/live-output gap.
  const subscription = terminalSubscriptions.attach(outputKey, handle.pty, { onData, onExit })
  // Replay is a normal versioned frame, so reconnect uses the same ACK and
  // sequence path as live output. The first frame is marked replay for the
  // client diagnostics; it is still parsed by xterm before ACK.
  sendReplayFrame(batcher, handle, ws)
  // D16: once a close frame is received this socket is done — ignore every
  // later frame (data and control) rather than letting resize/input reach a
  // pty that is already scheduled for destruction.
  let closing = false
  ws.on('message', (data) => {
    if (closing) return
    if (guardExitedFirst && handle.exited) return
    const text = data.toString('utf8')
    // Control frames are JSON with a known shape; anything else (including
    // JSON that is not a recognized control) is terminal input, verbatim.
    let parsed: unknown = null
    let control: { type?: unknown; cols?: unknown; rows?: unknown } | null = null
    try {
      parsed = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') {
        control = parsed as { type?: unknown; cols?: unknown; rows?: unknown }
      }
    } catch {
      // Not JSON: terminal input.
    }
    if (control !== null && control.type === 'close') {
      closing = true
      onCloseFrame()
      batcher.dispose()
      return
    }
    if (control !== null && control.type === 'ack') {
      const ack = parsed as Partial<TerminalOutputAck>
      batcher.acknowledge({
        type: 'ack',
        epoch: typeof ack.epoch === 'string' ? ack.epoch : '',
        sequence: typeof ack.sequence === 'number' ? ack.sequence : -1,
        bytes: typeof ack.bytes === 'number' ? ack.bytes : -1,
      })
      return
    }
    if (control !== null && control.type === 'resync') {
      batcher.resetEpoch()
      sendReplayFrame(batcher, handle, ws)
      return
    }
    if (handle.exited) return
    if (
      control !== null
      && control.type === 'resize'
      && typeof control.cols === 'number' && typeof control.rows === 'number'
    ) {
      const dims = clampDims(control.cols, control.rows)
      handle.pty.resize(dims.cols, dims.rows)
      handle.modeReplay?.resize(dims.cols, dims.rows)
    } else if (control === null || forwardUnparsedJson) {
      handle.pty.write(text)
    }
  })
  ws.on('close', () => {
    subscription.dispose()
    batcher.dispose()
    releasePtyOutputOwner(outputKey, handle.pty, outputOwner)
    onSocketClose()
  })
}

/**
 * Wire one terminal socket to its pty: replay transcript, pump both ways.
 * Two attach modes share the wire protocol via {@link createTerminalSocketPump}:
 * - `?uuid=...` attaches to an agent-owned terminal (created by the
 *   `terminal_create` tool). The close frame kills the pty immediately
 *   (the agent's terminal closes when the user closes the sidebar tab); a
 *   bare socket drop (refresh, tab switch) leaves the pty alive for the
 *   reconnect grace, exactly like UI-tab terminals.
 * - `?tab=...&sessionId=...` attaches to a UI-tab terminal (the user
 *   created it from the + menu). The close frame schedules a 0-ms close
 *   (the host's reconnect grace keeps the shell alive across a refresh).
 */
export async function attachTerminal(
  ctx: Context,
  ptyManager: PtyManager,
  agentPtyRegistry: AgentPtyRegistry,
  terminalSubscriptions: TerminalSubscriptionCoordinator,
  ws: WebSocket,
  req: IncomingMessage,
  getPolicy: () => TerminalRuntimePolicy,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const uuid = url.searchParams.get('uuid')
    if (uuid !== null) {
      const handle = agentPtyRegistry.get(uuid)
      if (handle === undefined) {
        ws.close(1011, `agent terminal "${uuid}" not found`)
        return
      }
      createTerminalSocketPump({
        terminalSubscriptions,
        ws,
        handle,
        outputKey: `agent:${handle.uuid}`,
        // The agent's terminal closes when the user closes the sidebar tab.
        onCloseFrame: () => { agentPtyRegistry.close(handle.uuid) },
        onSocketClose: () => {
          // A bare socket drop (refresh, tab switch) leaves the agent's pty
          // alive. The agent owns the lifetime: only `terminal_close`, a
          // `{type:'close'}` frame, or plugin teardown kills it.
        },
        forwardUnparsedJson: false,
        guardExitedFirst: true,
      })
      return
    }
    // UI-tab terminal: `?sessionId=<owner>&tab=...&cwd=...`. The owner is the
    // PROJECT cwd (project-shared PTY); the client maps its workspace cwd into
    // the owner slot and also sends the authoritative cwd. The pty is keyed
    // `owner:tab`, so the same project reconnects to the same shell across
    // conversations and refreshes.
    const owner = url.searchParams.get('sessionId')
    const tabId = url.searchParams.get('tab')
    if (owner === null || tabId === null) {
      ws.close(1008, 'either ?uuid or ?sessionId+?tab are required')
      return
    }
    const cwd = sessionCwdOf(ctx, owner, url.searchParams.get('cwd') ?? undefined)
    const handle = ptyManager.open(owner, tabId, cwd, 80, 24)
    createTerminalSocketPump({
      terminalSubscriptions,
      ws,
      handle,
      outputKey: handle.key,
      // The owning tab was closed: release the quota immediately.
      onCloseFrame: () => { ptyManager.scheduleClose(handle.key, 0) },
      onSocketClose: () => {
        // A bare socket drop (refresh, tab switch) leaves the process alive
        // for a grace period so a quick reconnect keeps it; the reconnect's
        // open() cancels the pending close.
        ptyManager.scheduleClose(handle.key, getPolicy().reconnectGraceMs, handle.incarnationId)
      },
      forwardUnparsedJson: true,
      guardExitedFirst: false,
    })
  } catch (error) {
    ws.close(1011, errorMessage(error))
  }
}

/** Clear every pause owner at teardown (index.ts dispose). */
export function clearPtyPauseOwners(): void {
  ptyPauseOwners.clear()
}