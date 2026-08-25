/**
 * Git freshness push (`/capabilities/ws/git-watch?cwd=…`).
 *
 * One coordinator loop per subscribed cwd runs a CHEAP status fingerprint
 * (`git status --porcelain=v2 --branch`, a single subprocess — NOT the full
 * four-process `git.status` route pipeline) and notifies subscribers only
 * when the fingerprint changes. Clients pull the real data through the
 * normal `git.status` RPC on notification (pull-on-push), so the frame is a
 * few bytes and the serialization path stays single-sourced.
 *
 * This replaces the sidebar's fixed 4s polling: the loop lives only while at
 * least one subscriber exists (panel open), pauses entirely otherwise, and
 * the client keeps its old interval purely as a disconnected-fallback.
 */
import * as git from '@dsh-studio/shared/git-core'

/** How often the per-cwd fingerprint loop runs while subscribed. */
export const GIT_WATCH_INTERVAL_MS = 1000

/** Compute the cheap freshness fingerprint for one workspace cwd. */
export type GitWatchProbe = (cwd: string) => Promise<string>

/** Default probe: one porcelain v2 exec covering branch + working tree. */
export function createStatusFingerprintProbe(): GitWatchProbe {
  return async cwd => {
    const result = await git.statusV2(cwd)
    return JSON.stringify([result.isRepo, result.branch ?? '', result.ahead, result.behind, result.entries])
  }
}

interface WatchRoom {
  subscribers: Set<() => void>
  /** Fingerprint of the last completed tick; null until the first one. */
  lastKey: string | null
  timer: ReturnType<typeof setInterval> | null
  busy: boolean
}

/** Options for {@link GitWatchCoordinator}. */
export interface GitWatchCoordinatorOptions {
  probe?: GitWatchProbe
  intervalMs?: number
  /** Optional sink for loop diagnostics (probe failures). */
  onProbeError?(error: unknown): void
}

/**
 * Fan-one-loop-out-to-many-subscribers git freshness feed. The first tick of
 * a room establishes the baseline without notifying (the subscriber performs
 * its initial load anyway); every later differing fingerprint notifies once.
 */
export class GitWatchCoordinator {
  private readonly rooms = new Map<string, WatchRoom>()
  private readonly probe: GitWatchProbe
  private readonly intervalMs: number
  private readonly onProbeError: ((error: unknown) => void) | undefined

  constructor(options: GitWatchCoordinatorOptions = {}) {
    this.probe = options.probe ?? createStatusFingerprintProbe()
    this.intervalMs = options.intervalMs ?? GIT_WATCH_INTERVAL_MS
    this.onProbeError = options.onProbeError
  }

  /**
   * Subscribe one listener to a cwd. Returns the unsubscriber. The room's
   * loop starts lazily and stops again when the last listener leaves.
   */
  subscribe(cwd: string, notify: () => void): () => void {
    const room = this.rooms.get(cwd) ?? this.createRoom(cwd)
    room.subscribers.add(notify)
    return () => {
      room.subscribers.delete(notify)
      if (room.subscribers.size === 0) this.stopRoom(cwd)
    }
  }

  /** Run one fingerprint round immediately (also the unit-test seam). */
  async pollOnce(cwd: string): Promise<void> {
    const room = this.rooms.get(cwd)
    if (room === undefined || room.busy) return
    room.busy = true
    try {
      const key = await this.probe(cwd)
      const changed = room.lastKey !== null && room.lastKey !== key
      room.lastKey = key
      if (changed) {
        for (const notify of [...room.subscribers]) notify()
      }
    } catch (error) {
      // A failed probe must not kill the loop; the next tick retries and the
      // previous fingerprint stays authoritative until one succeeds.
      this.onProbeError?.(error)
    } finally {
      room.busy = false
    }
  }

  /** Diagnostic surface: subscriber count / timer presence for one cwd. */
  roomState(cwd: string): { subscribers: number; looping: boolean } | undefined {
    const room = this.rooms.get(cwd)
    if (room === undefined) return undefined
    return { subscribers: room.subscribers.size, looping: room.timer !== null }
  }

  /** Stop every loop (plugin teardown). */
  dispose(): void {
    for (const cwd of [...this.rooms.keys()]) this.stopRoom(cwd)
  }

  private createRoom(cwd: string): WatchRoom {
    const room: WatchRoom = { subscribers: new Set(), lastKey: null, timer: null, busy: false }
    const timer = setInterval(() => { void this.pollOnce(cwd) }, this.intervalMs)
    // A live watch loop must not pin the process alive by itself: the DSH
    // runtime has plenty of other work keeping it up, and an unref'd timer
    // lets tests and teardown drains exit without walking every room.
    timer.unref?.()
    room.timer = timer
    this.rooms.set(cwd, room)
    return room
  }

  private stopRoom(cwd: string): void {
    const room = this.rooms.get(cwd)
    if (room === undefined) return
    if (room.timer !== null) clearInterval(room.timer)
    this.rooms.delete(cwd)
  }
}

/** Minimal socket face attach uses (structural, so tests can stub it). */
export interface GitWatchSocket {
  readyState: number
  send(data: string): unknown
  close(code?: number, reason?: string): void
  on(event: 'close' | 'error', listener: () => void): unknown
}

/** Whether the socket is in the OPEN state (mirrors the `ws` constant). */
const OPEN = 1

/**
 * Attach one connected websocket as a single-cwd subscription: the connection
 * IS the subscription, mirroring the agent-terminals route lifecycle. The
 * server pushes `{type:'changed', cwd}` frames on fingerprint diffs.
 */
export function attachGitWatch(
  coordinator: GitWatchCoordinator,
  ws: GitWatchSocket,
  req: { url?: string | undefined },
): void {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const cwd = url.searchParams.get('cwd')
    if (cwd === null || cwd === '') {
      ws.close(1008, 'cwd is required')
      return
    }
    const notify = (): void => {
      if (ws.readyState === OPEN) ws.send(JSON.stringify({ type: 'changed', cwd }))
    }
    const unsubscribe = coordinator.subscribe(cwd, notify)
    ws.on('close', unsubscribe)
    ws.on('error', unsubscribe)
  } catch {
    ws.close(1011, 'git-watch attach failed')
  }
}
