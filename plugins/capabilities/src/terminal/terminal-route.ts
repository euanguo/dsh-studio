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
import type { AgentPtyRegistry, AgentTerminalHandle } from './agent-pty.ts'
import { clampDims } from './agent-pty.ts'
import type { PtyManager } from './pty-manager.ts'
import { TerminalOutputBatcher } from './terminal-batcher.ts'
import type { TerminalSubscriptionCoordinator } from './terminal-subscription-coordinator.ts'
import { buildTerminalReplayPayload, type TerminalReplaySource } from './terminal-replay.ts'
import type { TerminalRuntimePolicy } from './terminal-policy.ts'
import { sessionCwdOf } from '../routes/shared.ts'
import type { TerminalOutputAck, TerminalOutputFrame } from '@dsh-studio/shared/terminal-wire'

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
    ws.close(1011, error instanceof Error ? error.message : String(error))
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

/**
 * Wire one terminal socket to its pty: replay transcript, pump both ways.
 * Two attach modes share the wire protocol:
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
      pumpAgentTerminal(agentPtyRegistry, terminalSubscriptions, handle, ws)
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
    const outputOwner = randomUUID()
    const batcher = new TerminalOutputBatcher({
      send: frame => {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify(frame))
      },
      bufferedAmount: () => ws.bufferedAmount,
      pause: () => { setPtyOutputPaused(handle.key, handle.pty, outputOwner, true) },
      resume: () => { setPtyOutputPaused(handle.key, handle.pty, outputOwner, false) },
    })
    const onData = (data: string): void => { batcher.append(data) }
    const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
      batcher.append(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
      batcher.flush()
      releasePtyOutputOwner(handle.key, handle.pty, outputOwner)
    }
    // Subscribe before taking the replay snapshot. Any bytes produced during
    // the snapshot are queued behind it in WebSocket order, so reconnects do
    // not create a history/live-output gap.
    const subscription = terminalSubscriptions.attach(handle.key, handle.pty, {
      onData,
      onExit,
    })
    // Replay is a normal versioned frame, so reconnect uses the same ACK and
    // sequence path as live output. The first frame is marked replay for the
    // client diagnostics; it is still parsed by xterm before ACK.
    sendReplayFrame(batcher, handle, ws)
    ws.on('message', (data) => {
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
        // The owning tab was closed: release the quota immediately.
        ptyManager.scheduleClose(handle.key, 0)
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
      } else {
        handle.pty.write(text)
      }
    })
    ws.on('close', () => {
      subscription.dispose()
      batcher.dispose()
      releasePtyOutputOwner(handle.key, handle.pty, outputOwner)
      // A bare socket drop (refresh, tab switch) leaves the process alive
      // for a grace period so a quick reconnect keeps it; the reconnect's
      // open() cancels the pending close.
      ptyManager.scheduleClose(
        handle.key,
        getPolicy().reconnectGraceMs,
        handle.incarnationId,
      )
    })
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Pump one agent terminal's pty to a connected view. The close frame kills
 * the pty immediately (the agent's terminal closes when the user closes the
 * sidebar tab); a bare socket drop leaves the pty alive — the agent owns
 * the lifetime, and only `terminal_close`, a `{type:'close'}` frame, or
 * plugin teardown kills it.
 */
function pumpAgentTerminal(
  registry: AgentPtyRegistry,
  terminalSubscriptions: TerminalSubscriptionCoordinator,
  handle: AgentTerminalHandle,
  ws: WebSocket,
): void {
  const outputOwner = randomUUID()
  const batcher = new TerminalOutputBatcher({
    send: frame => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify(frame))
    },
    bufferedAmount: () => ws.bufferedAmount,
    pause: () => { setPtyOutputPaused(`agent:${handle.uuid}`, handle.pty, outputOwner, true) },
    resume: () => { setPtyOutputPaused(`agent:${handle.uuid}`, handle.pty, outputOwner, false) },
  })
  const onData = (data: string): void => { batcher.append(data) }
  const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
    batcher.append(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
    batcher.flush()
    releasePtyOutputOwner(`agent:${handle.uuid}`, handle.pty, outputOwner)
  }
  const subscription = terminalSubscriptions.attach(`agent:${handle.uuid}`, handle.pty, {
    onData,
    onExit,
  })
  sendReplayFrame(batcher, handle, ws)
  ws.on('message', (data) => {
    if (handle.exited) return
    const text = data.toString('utf8')
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
      // The user closed the sidebar tab: kill the pty immediately. The
      // agent's next terminal_list / terminal_send will see it gone.
      registry.close(handle.uuid)
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
    if (
      control !== null
      && control.type === 'resize'
      && typeof control.cols === 'number' && typeof control.rows === 'number'
    ) {
      const dims = clampDims(control.cols, control.rows)
      handle.pty.resize(dims.cols, dims.rows)
    } else if (control === null) {
      // Raw text input (a JSON-looking string the pty would have received
      // verbatim is reachable in theory but is exotic for an agent terminal;
      // preserve the UI-tab semantics and forward as input).
      handle.pty.write(text)
    }
    // An unrecognized JSON control frame is dropped (the UI-tab path also
    // treats non-resize JSON controls as input, but for an agent terminal
    // there is no realistic input that is also valid JSON).
  })
  ws.on('close', () => {
    subscription.dispose()
    batcher.dispose()
    releasePtyOutputOwner(`agent:${handle.uuid}`, handle.pty, outputOwner)
    // A bare socket drop (refresh, tab switch) leaves the agent's pty alive.
    // The agent owns the lifetime: only `terminal_close`, a `{type:'close'}`
    // frame, or plugin teardown kills it. A reconnecting view reattaches the
    // same shell and gets the full transcript replayed.
  })
}

/** Clear every pause owner at teardown (index.ts dispose). */
export function clearPtyPauseOwners(): void {
  ptyPauseOwners.clear()
}