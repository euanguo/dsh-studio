/**
 * Left-rail view state, persisted through the desktop host's settings service
 * into its OWN `dsh-studio-left-rail` namespace (→ the profile settings document),
 * NOT browser localStorage and NOT the sidebar prefs section. The slice is a
 * versioned DTO; writes go through the shared `persistVia` facade's settings
 * backend below: each save diffs the next slice against a FRESH read and
 * expresses the difference as deletion-capable path ops, CAS-guarded by that
 * read's revision. Deletions — icon reset to auto, alias clear, group
 * unassign — therefore survive reloads, while keys owned by other surfaces
 * (the worktree location preferences) are never touched by a browser-view
 * save because they compare equal against the fresh base. projects/worktrees
 * themselves stay derived from git. See docs/persistence-architecture.md
 * (decision B).
 */
import { callCapabilitiesGlobalApi } from '@dsh-studio/shared/capabilities-api'
import {
  persistVia,
  type PersistBackend,
  type PersistViaHandle,
} from '@dsh-studio/shared/store-persistence'
import {
  LEFT_RAIL_SETTINGS_NS,
  LEFT_RAIL_SETTINGS_VERSION,
  sanitizeLeftRailSettings,
  type LeftRailSettings,
} from '@dsh-studio/shared/left-rail-preferences'

export type { LeftRailSettings } from '@dsh-studio/shared/left-rail-preferences'

/** A settings response envelope (namespace value + revision for CAS). */
export interface LeftRailSettingsView {
  value: LeftRailSettings
  revision: number
}

/** Read the persisted slice (empty DTO + revision when absent), sanitized. */
export async function loadLeftRailSettings(signal?: AbortSignal): Promise<LeftRailSettingsView> {
  const result = await callCapabilitiesGlobalApi<{ value?: unknown; revision?: number }>(
    'settings.get',
    { ns: LEFT_RAIL_SETTINGS_NS },
    signal,
  )
  return {
    value: sanitizeLeftRailSettings(result.value) ?? {},
    revision: result.revision ?? 0,
  }
}

/** One deletion-capable path edit on the namespace's top-level keys. */
interface SettingsSectionOp {
  op: 'set' | 'unset'
  path: [string]
  value?: unknown
}

/** JSON-value equality over the slice's plain-data fields (order-sensitive arrays). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]))
  }
  if (Array.isArray(a) || Array.isArray(b)) return false
  const recordA = a as Record<string, unknown>
  const recordB = b as Record<string, unknown>
  const keysA = Object.keys(recordA)
  const keysB = Object.keys(recordB)
  if (keysA.length !== keysB.length) return false
  return keysA.every(key => jsonEqual(recordA[key], recordB[key]))
}

/**
 * Diff two whole slices into top-level path ops: `set` for added/changed
 * keys, `unset` for removed ones. Undefined counts as absent on both sides.
 */
export function diffSettingsOps(base: LeftRailSettings, next: LeftRailSettings): SettingsSectionOp[] {
  const ops: SettingsSectionOp[] = []
  const keys = new Set([...Object.keys(base), ...Object.keys(next)])
  for (const key of keys) {
    const before = base[key as keyof LeftRailSettings]
    const after = next[key as keyof LeftRailSettings]
    if (before === undefined && after === undefined) continue
    if (after === undefined) ops.push({ op: 'unset', path: [key] })
    else if (!jsonEqual(before, after)) ops.push({ op: 'set', path: [key], value: after })
  }
  return ops
}

/**
 * Persist the complete next slice. The write is a CAS-guarded batch of
 * deletion-capable path ops derived against a fresh read of the namespace:
 * equal keys produce no op, so concurrent edits by another surface ride
 * untouched instead of being replaced by this caller's (possibly stale) copy.
 * A caller whose base is already stale gets the same revision conflict the
 * CAS retry helper ({@linkcode withSettingsCas}) heals by rebuilding over the
 * latest slice.
 */
export async function saveLeftRailSettings(
  section: LeftRailSettings,
  expectedRevision?: number,
): Promise<LeftRailSettingsView> {
  const current = await loadLeftRailSettings()
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    throw new Error(`settings conflict: stored revision ${current.revision} != expected ${expectedRevision}`)
  }
  const target = { ...section, version: LEFT_RAIL_SETTINGS_VERSION }
  const ops = diffSettingsOps(current.value, target)
  // An empty diff means the stored slice already IS the target: skipping the
  // write keeps the revision (and any concurrent writer) untouched.
  if (ops.length === 0) return current
  const result = await callCapabilitiesGlobalApi<{ value?: unknown; revision?: number }>(
    'settings.mutate',
    {
      ns: LEFT_RAIL_SETTINGS_NS,
      ops,
      expectedRevision: current.revision,
    },
  )
  return {
    value: sanitizeLeftRailSettings(result.value) ?? {},
    revision: result.revision ?? 0,
  }
}

/**
 * Persist the complete next slice with CAS and one self-healing retry. On a
 * conflict (another surface wrote meanwhile) or a transport failure the
 * latest slice is re-read and the write retried once over THAT base — a
 * conflict never wedges persistence until reload and never reverts another
 * surface's keys with a stale copy. A second failure is propagated to the
 * caller (never silently swallowed) so the surface can surface it.
 * @param base - the caller's last-known slice for the first attempt.
 * @param revision - the caller's last-known revision for the first attempt.
 * @param build - derive the next slice from a base (used on the retry too).
 * @returns the accepted view; the caller adopts its value + revision.
 */
export async function withSettingsCas(
  base: LeftRailSettings,
  revision: number,
  build: (nextBase: LeftRailSettings) => LeftRailSettings,
): Promise<LeftRailSettingsView> {
  try {
    return await saveLeftRailSettings(build(base), revision)
  } catch {
    const latest = await loadLeftRailSettings()
    return saveLeftRailSettings(build(latest.value), latest.revision)
  }
}

/* ── persistVia settings backend ───────────────────────────────────────── */

/**
 * The settings-domain backend handed to the shared persistVia facade: loads
 * are sanitized reads (`loadStrict` throws so an outage reads as "unknown",
 * never as "empty"), and each save runs one serialized whole-section CAS job
 * per {@linkcode saveLeftRailSettings}. Writes are pull-driven — the facade's
 * fire() persists the latest snapshot pushed by the surface.
 */
function createLeftRailSettingsBackend(
  onWriteFailed: (error: unknown) => void,
): PersistBackend<LeftRailSettings> {
  let queue: Promise<void> = Promise.resolve()
  return {
    load: async () => (await loadLeftRailSettings()).value,
    loadStrict: async () => (await loadLeftRailSettings()).value,
    save(value) {
      queue = queue.then(async () => {
        try {
          await saveLeftRailSettings(value)
        } catch (error) {
          onWriteFailed(error)
        }
      })
    },
    flush: () => queue,
  }
}

/** The persistVia-driven write pump for the browser's user-profile slice. */
export interface LeftRailSettingsPump {
  /**
   * Snapshot the next whole slice and fire the facade. Failures surface
   * asynchronously through the pump's write-failed callback.
   */
  write(section: LeftRailSettings): void
  /** Drain pending writes (unmount flush); never rejects. */
  flush(): Promise<void>
  /** Release the pump (unsubscribes; queued writes still drain on flush). */
  stop(): void
}

/**
 * One browser-mount persistence channel: every profile write goes through
 * the shared persistVia facade over the settings backend above. Hydration is
 * owned by the surface (its load effect + hydrate action), matching the
 * pre-unification semantics: saves stay enabled after a failed load and the
 * fresh-read diff inside each CAS job protects other surfaces' keys.
 */
export function startLeftRailSettingsPersistence(options: {
  onWriteFailed?: (error: unknown) => void
} = {}): LeftRailSettingsPump {
  let snapshot: LeftRailSettings = {}
  const onWriteFailed = options.onWriteFailed ?? (() => {})
  const handle: PersistViaHandle = persistVia<LeftRailSettings>(
    {
      subscribe: () => () => {},
      snapshot: () => snapshot,
      apply: value => { snapshot = value },
    },
    {
      backend: createLeftRailSettingsBackend(onWriteFailed),
      // Required by the facade contract but unreachable here: hydration is
      // owned by the surface's load effect + hydrate action.
      merge: stored => stored,
      hydrate: false,
    },
  )
  return {
    write(section) {
      snapshot = section
      handle.fire()
    },
    flush: async () => {
      try {
        await handle.flush()
      } catch {
        // The surface is unmounting; nothing left to render.
      }
    },
    stop: () => handle.stop(),
  }
}
