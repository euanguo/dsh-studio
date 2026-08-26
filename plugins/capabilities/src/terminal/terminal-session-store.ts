import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic, writeFileAtomicSync } from '@dsh-studio/shared/host-atomic-fs'
import {
  capHistoryByLimits,
  type HistoryLimits,
} from './terminal-history.ts'

const STORE_VERSION = 1
const DEFAULT_PERSIST_IDLE_MS = 500
const DEFAULT_PERSIST_MAX_INTERVAL_MS = 2_000
const DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS = 128
const MAX_STORE_BYTES = 32 * 1024 * 1024

export interface TerminalSessionRecord {
  key: string
  /** The project cwd owning this terminal (project-shared PTY). */
  cwd: string
  tabId: string
  spawnCwd: string
  incarnationId: string
  rawHistory: string
  replayHistory: string
  cols: number
  rows: number
  status: 'running' | 'inactive'
  updatedAt: number
  revision: number
}

interface PersistedTerminalStore {
  version: number
  records: TerminalSessionRecord[]
  tombstones: Record<string, string>
}

export interface TerminalSessionStoreOptions {
  /**
   * The DSH data root, resolved by the host and injected at the construction
   * point (M1). The store creates only a terminal-sessions child under it.
   * Required so a bare launch or missing env can never fall back to a guessed
   * root (which would silently write dev-channel history into the stable pair).
   */
  root: string
  maxRetainedInactiveSessions?: number | (() => number)
  historyLimits?: HistoryLimits | (() => HistoryLimits)
  persistIdleMs?: number
  persistMaxIntervalMs?: number
  now?: () => number
}

export interface TerminalSessionRestoreInput {
  cwd: string
  tabId: string
  spawnCwd: string
  cols: number
  rows: number
}

export interface TerminalSessionPersistencePatch {
  rawHistory: string
  replayHistory: string
  cols: number
  rows: number
  status?: 'running' | 'inactive'
}

/**
 * Durable metadata/history owner for local terminal sessions.
 *
 * The PTY remains process-owned by PtyManager; this module owns the state that
 * can survive a host/plugin restart. Writes are debounced, serialized, and
 * published with current/previous atomic snapshots. The file is intentionally
 * a projection rather than a second process manager, so a restored session
 * always starts a fresh shell in its recorded cwd.
 */
export class TerminalSessionStore {
  readonly directory: string
  readonly currentPath: string
  readonly previousPath: string

  private readonly records = new Map<string, TerminalSessionRecord>()
  private readonly tombstones = new Map<string, string>()
  private readonly maxRetainedInactiveSessions: number | (() => number)
  private readonly historyLimits: HistoryLimits | (() => HistoryLimits)
  private readonly persistIdleMs: number
  private readonly persistMaxIntervalMs: number
  private readonly now: () => number
  private readonly pendingUpdates = new Map<string, () => TerminalSessionPersistencePatch>()
  /**
   * Set when the on-disk snapshot carries a version this build does not
   * understand (newer, or unknown). In that state the store reads nothing and
   * disables write-back, so the old file is preserved byte-for-byte — the
   * non-destructive degrade contract (M4c): never overwrite a version we
   * cannot interpret. In-memory records still work for the running process,
   * they just no longer persist.
   */
  private readonlyDegraded = false
  private disposed = false
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private maxPersistTimer: ReturnType<typeof setTimeout> | null = null
  private persistQueue: Promise<void> = Promise.resolve()
  private lastPersistedHash = ''
  private dirty = false

  constructor(options: TerminalSessionStoreOptions) {
    this.directory = join(options.root, 'terminal-sessions')
    this.currentPath = join(this.directory, 'sessions.json')
    this.previousPath = join(this.directory, 'sessions.previous.json')
    this.maxRetainedInactiveSessions = options.maxRetainedInactiveSessions
      ?? DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS
    this.historyLimits = options.historyLimits ?? { maxBytes: 8 * 1024 * 1024, maxLines: 50_000 }
    this.persistIdleMs = Math.max(1, Math.floor(options.persistIdleMs ?? DEFAULT_PERSIST_IDLE_MS))
    this.persistMaxIntervalMs = Math.max(
      this.persistIdleMs,
      Math.floor(options.persistMaxIntervalMs ?? DEFAULT_PERSIST_MAX_INTERVAL_MS),
    )
    this.now = options.now ?? Date.now
    this.load()
  }

  get size(): number {
    return this.records.size
  }

  get(key: string): TerminalSessionRecord | undefined {
    const record = this.records.get(key)
    return record === undefined ? undefined : cloneRecord(record)
  }

  listInactive(): TerminalSessionRecord[] {
    return [...this.records.values()]
      .filter(record => record.status === 'inactive')
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .map(cloneRecord)
  }

  /** Restore or create one identity. A tombstoned key always receives a new incarnation. */
  ensure(input: TerminalSessionRestoreInput): TerminalSessionRecord {
    const key = terminalSessionKey(input.cwd, input.tabId)
    const existing = this.records.get(key)
    if (existing !== undefined && existing.cwd === input.cwd) {
      existing.status = 'running'
      existing.cols = clampDimension(input.cols, existing.cols)
      existing.rows = clampDimension(input.rows, existing.rows)
      existing.updatedAt = this.now()
      existing.revision += 1
      this.queuePersist()
      return cloneRecord(existing)
    }

    const record: TerminalSessionRecord = {
      key,
      cwd: input.cwd,
      tabId: input.tabId,
      spawnCwd: input.spawnCwd,
      incarnationId: randomUUID(),
      rawHistory: existing?.rawHistory ?? '',
      replayHistory: existing?.replayHistory ?? '',
      cols: clampDimension(input.cols, 80),
      rows: clampDimension(input.rows, 24),
      status: 'running',
      updatedAt: this.now(),
      revision: (existing?.revision ?? 0) + 1,
    }
    this.records.set(key, record)
    this.tombstones.delete(key)
    this.queuePersist()
    return cloneRecord(record)
  }

  update(key: string, patch: TerminalSessionPersistencePatch): void {
    this.applyPatch(key, patch)
    this.queuePersist()
  }

  /** Coalesce hot PTY output without materializing the full history per chunk. */
  queueUpdate(key: string, materialize: () => TerminalSessionPersistencePatch): void {
    if (!this.records.has(key)) return
    this.pendingUpdates.set(key, materialize)
    this.queuePersist()
  }

  private applyPatch(key: string, patch: TerminalSessionPersistencePatch): void {
    const record = this.records.get(key)
    if (record === undefined) return
    const limits = this.resolveHistoryLimits()
    record.rawHistory = capHistoryByLimits(patch.rawHistory, limits)
    record.replayHistory = capHistoryByLimits(patch.replayHistory, limits)
    record.cols = clampDimension(patch.cols, record.cols)
    record.rows = clampDimension(patch.rows, record.rows)
    record.status = patch.status ?? record.status
    record.updatedAt = this.now()
    record.revision += 1
    this.pruneInactive()
  }

  private applyPendingUpdates(): void {
    if (this.pendingUpdates.size === 0) return
    const pending = [...this.pendingUpdates.entries()]
    this.pendingUpdates.clear()
    for (const [key, materialize] of pending) {
      try {
        this.applyPatch(key, materialize())
      } catch {
        // A terminal that is exiting must not prevent other records from saving.
      }
    }
  }

  markInactive(key: string, patch?: Partial<TerminalSessionPersistencePatch>): void {
    const record = this.records.get(key)
    if (record === undefined) return
    this.update(key, {
      rawHistory: patch?.rawHistory ?? record.rawHistory,
      replayHistory: patch?.replayHistory ?? record.replayHistory,
      cols: patch?.cols ?? record.cols,
      rows: patch?.rows ?? record.rows,
      status: 'inactive',
    })
  }

  /** Explicit close removes state and records an identity tombstone. */
  close(key: string, incarnationId?: string): void {
    const record = this.records.get(key)
    if (record !== undefined && (incarnationId === undefined || record.incarnationId === incarnationId)) {
      this.pendingUpdates.delete(key)
      this.tombstones.set(key, record.incarnationId)
      this.records.delete(key)
      this.queuePersist()
    }
  }

  clear(key: string): void {
    this.pendingUpdates.delete(key)
    if (!this.records.delete(key)) return
    this.tombstones.delete(key)
    this.queuePersist()
  }

  /** Synchronous shutdown checkpoint used before Cordis releases the host. */
  flushSync(): void {
    this.clearPersistTimers()
    this.applyPendingUpdates()
    if (!this.dirty || this.readonlyDegraded) return
    this.dirty = false
    const snapshot = {
      version: STORE_VERSION,
      records: [...this.records.values()].map(cloneRecord),
      tombstones: Object.fromEntries(this.tombstones),
    } satisfies PersistedTerminalStore
    this.pruneForSize(snapshot)
    const payload = JSON.stringify(snapshot) + '\n'
    const hash = createHash('sha256').update(payload).digest('hex')
    if (hash === this.lastPersistedHash) return
    try {
      writeSnapshotAtomic(
        this.directory,
        this.currentPath,
        this.previousPath,
        payload,
        true,
      )
      this.lastPersistedHash = hash
    } catch {
      this.dirty = true
    }
  }

  /** Force a durable snapshot before host teardown. */
  async flush(): Promise<void> {
    this.clearPersistTimers()
    this.applyPendingUpdates()
    await this.persistQueue
    if (this.dirty && !this.readonlyDegraded) await this.writeSnapshot()
    await this.persistQueue
  }

  // `dispose()` drains the terminal session store's teardown — public
  // contract kept for host shutdown parity. `flush()` must run before the
  // store is marked dead so a final pending write survives Cordis teardown.
  async dispose(): Promise<void> {
    await this.flush()
    this.disposed = true
  }

  private resolveHistoryLimits(): HistoryLimits {
    const value = typeof this.historyLimits === 'function'
      ? this.historyLimits()
      : this.historyLimits
    return {
      maxBytes: Math.max(1, Math.floor(value.maxBytes)),
      maxLines: Math.max(1, Math.floor(value.maxLines)),
    }
  }

  private resolveRetainedLimit(): number {
    const value = typeof this.maxRetainedInactiveSessions === 'function'
      ? this.maxRetainedInactiveSessions()
      : this.maxRetainedInactiveSessions
    return Math.max(0, Math.floor(value))
  }

  private pruneInactive(): void {
    const limit = this.resolveRetainedLimit()
    const inactive = [...this.records.values()]
      .filter(record => record.status === 'inactive')
      .sort((left, right) => left.updatedAt - right.updatedAt)
    for (const record of inactive.slice(0, Math.max(0, inactive.length - limit))) {
      this.tombstones.set(record.key, record.incarnationId)
      this.records.delete(record.key)
    }
  }

  private load(): void {
    const raw = readSnapshot(this.currentPath) ?? readSnapshot(this.previousPath)
    if (raw === undefined) return
    // A snapshot exists but with a version we do not understand (future or
    // unknown): degrade to read-only. The in-memory store starts empty and
    // queuePersist is disabled, so no later flush rewrites the file — the old
    // data is preserved untouched (M4c non-destructive contract).
    if (raw.version !== STORE_VERSION) {
      this.readonlyDegraded = true
      return
    }
    for (const record of raw.records) {
      if (!isRecordValid(record)) continue
      this.records.set(record.key, {
        ...record,
        status: 'inactive',
        rawHistory: capHistoryByLimits(record.rawHistory, this.resolveHistoryLimits()),
        replayHistory: capHistoryByLimits(record.replayHistory, this.resolveHistoryLimits()),
      })
    }
    for (const [key, incarnationId] of Object.entries(raw.tombstones)) {
      if (typeof incarnationId === 'string' && incarnationId !== '') {
        this.tombstones.set(key, incarnationId)
      }
    }
    this.pruneInactive()
  }

  private queuePersist(): void {
    if (this.readonlyDegraded || this.disposed) return
    this.dirty = true
    if (this.persistTimer === null) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null
        void this.writeSnapshot()
      }, this.persistIdleMs)
      this.persistTimer.unref?.()
    }
    if (this.maxPersistTimer === null) {
      this.maxPersistTimer = setTimeout(() => {
        this.maxPersistTimer = null
        void this.writeSnapshot()
      }, this.persistMaxIntervalMs)
      this.maxPersistTimer.unref?.()
    }
  }

  private clearPersistTimers(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer)
    if (this.maxPersistTimer !== null) clearTimeout(this.maxPersistTimer)
    this.persistTimer = null
    this.maxPersistTimer = null
  }

  private async writeSnapshot(): Promise<void> {
    if (!this.dirty || this.readonlyDegraded || this.disposed) return
    this.applyPendingUpdates()
    this.dirty = false
    const snapshot = {
      version: STORE_VERSION,
      records: [...this.records.values()].map(cloneRecord),
      tombstones: Object.fromEntries(this.tombstones),
    } satisfies PersistedTerminalStore
    const payload = JSON.stringify(snapshot) + '\n'
    if (Buffer.byteLength(payload, 'utf8') > MAX_STORE_BYTES) {
      this.pruneForSize(snapshot)
    }
    const nextPayload = JSON.stringify(snapshot) + '\n'
    const nextHash = createHash('sha256').update(nextPayload).digest('hex')
    if (nextHash === this.lastPersistedHash) return
    this.persistQueue = this.persistQueue.then(async () => {
      await writeSnapshotAtomic(
        this.directory,
        this.currentPath,
        this.previousPath,
        nextPayload,
        false,
      )
      this.lastPersistedHash = nextHash
    }).catch(() => {
      // A read-only or unavailable data root must not kill the terminal host.
      this.dirty = true
    })
    await this.persistQueue
  }

  private pruneForSize(snapshot: PersistedTerminalStore): void {
    snapshot.records.sort((left, right) => left.status === right.status
      ? left.updatedAt - right.updatedAt
      : left.status === 'inactive' ? -1 : 1)
    while (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_STORE_BYTES && snapshot.records.length > 0) {
      const index = snapshot.records.findIndex(record => record.status === 'inactive')
      if (index === -1) break
      snapshot.records.splice(index, 1)
    }
  }
}

export function terminalSessionKey(sessionId: string, tabId: string): string {
  return `${sessionId}:${tabId}`
}

/**
 * Atomic five-step snapshot write shared by the sync and async flush paths
 * mkdir → rotate current→previous → shared tmp+rename atomic write → 0600. Reusing one helper removes the duplicated block and guarantees both
 * paths apply the same rotation/atomicity contract. The tmp+rename atomic
 * step is delegated to `host-atomic-fs.writeFileAtomic[Sync]` (W1); `sync`
 * selects the synchronous shutdown-checkpoint variant (`flushSync`) from the
 * asynchronous queue variant (`writeSnapshot`).
 */
function writeSnapshotAtomic(
  directory: string,
  currentPath: string,
  previousPath: string,
  nextPayload: string,
  sync: boolean,
): Promise<void> {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (existsSync(currentPath)) {
    try { renameSync(currentPath, previousPath) } catch { /* best effort */ }
  }
  const finish = (): void => { try { chmodSync(currentPath, 0o600) } catch { /* best effort */ } }
  if (sync) {
    writeFileAtomicSync(currentPath, nextPayload, { mode: 0o600, suffix: 'sessions' })
    finish()
    return Promise.resolve()
  }
  return writeFileAtomic(currentPath, nextPayload, { mode: 0o600, suffix: 'sessions' }).then(finish)
}

function clampDimension(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(2, Math.min(1024, Math.floor(value))) : fallback
}

function cloneRecord(record: TerminalSessionRecord): TerminalSessionRecord {
  return { ...record }
}

function isRecordValid(value: unknown): value is TerminalSessionRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<TerminalSessionRecord>
  return typeof record.key === 'string'
    && typeof record.cwd === 'string'
    && typeof record.tabId === 'string'
    && typeof record.spawnCwd === 'string'
    && typeof record.incarnationId === 'string'
    && typeof record.rawHistory === 'string'
    && typeof record.replayHistory === 'string'
    && typeof record.cols === 'number'
    && typeof record.rows === 'number'
    && (record.status === 'running' || record.status === 'inactive')
    && typeof record.updatedAt === 'number'
    && typeof record.revision === 'number'
}

function readSnapshot(path: string): PersistedTerminalStore | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return undefined
    const snapshot = parsed as Partial<PersistedTerminalStore>
    if (snapshot.version !== STORE_VERSION || !Array.isArray(snapshot.records)) return undefined
    const tombstones = snapshot.tombstones
    return {
      version: STORE_VERSION,
      records: snapshot.records.filter(isRecordValid),
      tombstones: tombstones !== null && typeof tombstones === 'object'
        ? tombstones as Record<string, string>
        : {},
    }
  } catch {
    return undefined
  }
}

export function terminalSessionFingerprint(record: Pick<TerminalSessionRecord, 'key' | 'incarnationId' | 'revision'>): string {
  return createHash('sha256')
    .update(`${record.key}\0${record.incarnationId}\0${record.revision}`)
    .digest('hex')
}
