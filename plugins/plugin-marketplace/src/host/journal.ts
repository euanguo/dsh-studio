import { errorMessage } from '@dsh-studio/shared/errors'
import { writeFileAtomicSync } from '@dsh-studio/shared/host-atomic-fs'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * Marketplace transaction journal (`<appData>/plugin-marketplace/rollbacks/
 * current.json`) — the crash-safety ledger for apply/undo profile swaps.
 *
 * Format history (same file name and path across versions):
 *
 * - **v1** stored `{appliedAt, backupProfile, pluginId, transactionId}` only
 *   AFTER a successful apply, so a crash mid-apply or mid-undo left an
 *   unmarked half-swapped profile on disk. A stored record without a
 *   `version` field is interpreted as v1 semantics
 *   `{version:1, phase:'applied', committed:true}` and is lazily upgraded to
 *   v2 by the next successful journal write — never batch-rewritten at
 *   startup (non-destructive data migration).
 * - **v2** stores `{version:2, phase, committed, pluginId, transactionId,
 *   backupProfile, appliedAt}`. The INTENT record
 *   (`{phase:'applying'|'undoing', committed:false}`) is durably written
 *   BEFORE the first profile rename of apply/undo; a successful apply
 *   replaces it with the TERMINAL record (`{phase:'applied', committed:true}`);
 *   a successful undo clears the journal (its terminal state is "no recovery
 *   point").
 *
 * Reconcile decision table (run once at construction; every repair warns
 * before touching disk, and a failed repair is reported into the next error
 * snapshot instead of being silently swallowed):
 *
 * | row | journal                       | disk                            | repair |
 * |-----|-------------------------------|---------------------------------|--------|
 * | 1   | absent                        | any                             | adopt nothing; sweep orphan tx directories |
 * | 2   | v1, or v2 `applied`+committed | backup present                  | adopt the recovery point (a v1 file stays v1); sweep orphans |
 * | 3   | applying, uncommitted         | P✗ B✓ (W2)                      | restore backup → profile; clear journal |
 * | 4   | applying, uncommitted         | P✓ B✓ (W3/W4)                   | quarantine candidate → `failed-candidate-*`, restore backup, sweep quarantine; clear journal |
 * | 5   | applying, uncommitted         | P✓ B✗ (W1)                      | nothing renamed yet; clear journal |
 * | 6   | applying/undoing, uncommitted | P✗ B✗ and no `replaced-*` (fatal) | rebuild an empty profile scaffold and report the loss |
 * | 7   | undoing, uncommitted          | U1 P✓B✓ → clear journal, keep recovery · U2 P✗R✓ → restore `replaced-*` → profile, journal back to terminal applied · U3 P✓B✗ → sweep `replaced-*`, clear journal |
 *
 * (P = live profile directory, B = apply backup under the rollbacks root,
 * R = a `replaced-*` directory left by an interrupted undo.)
 */

type Warn = (text: string) => void

export type MarketplaceJournalPhase = 'applying' | 'applied' | 'undoing'

/** One persisted journal record; v1 records never carried a `version`. */
export interface MarketplaceJournalRecord {
  appliedAt: string | null
  backupProfile: string
  committed: boolean
  phase: MarketplaceJournalPhase
  pluginId: string
  transactionId: string
  version: 1 | 2
}

/** Restorable "previous profile" handle adopted by the manager. */
export interface MarketplaceRecoveryPoint {
  appliedAt: string
  backupProfile: string
  pluginId: string
  transactionId: string
}

export interface JournalReconciliation {
  problems: string[]
  /** Repairs announced via warn before their disk mutation. */
  repairs: string[]
  recovery: MarketplaceRecoveryPoint | null
}

export interface ReconcileJournalInput {
  profile: string
  profileDir: string
  rollbacksRoot: string
  statePath: string
  warn: Warn
}

function message(error: unknown): string {
  return errorMessage(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Parse a stored journal payload, interpreting a missing `version` as v1. */
function parseJournalRecord(value: unknown): MarketplaceJournalRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.backupProfile !== 'string'
    || typeof value.pluginId !== 'string'
    || typeof value.transactionId !== 'string') {
    return null
  }
  if (value.version === undefined) {
    return {
      appliedAt: typeof value.appliedAt === 'string' ? value.appliedAt : new Date(0).toISOString(),
      backupProfile: value.backupProfile,
      committed: true,
      phase: 'applied',
      pluginId: value.pluginId,
      transactionId: value.transactionId,
      version: 1,
    }
  }
  if (value.version !== 2
    || (value.phase !== 'applying' && value.phase !== 'applied' && value.phase !== 'undoing')
    || typeof value.committed !== 'boolean') {
    return null
  }
  return {
    appliedAt: typeof value.appliedAt === 'string' ? value.appliedAt : null,
    backupProfile: value.backupProfile,
    committed: value.committed,
    phase: value.phase,
    pluginId: value.pluginId,
    transactionId: value.transactionId,
    version: 2,
  }
}

/**
 * Load the journal. `valid: false` means the file exists but cannot be
 * interpreted: reconcile then deliberately repairs NOTHING (a corrupt ledger
 * must not trigger destructive sweeps over backups it can no longer read).
 */
export function loadJournal(
  statePath: string,
  warn: Warn,
): { record: MarketplaceJournalRecord | null; valid: boolean } {
  if (!existsSync(statePath)) return { record: null, valid: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(statePath, 'utf8')) as unknown
  } catch (error) {
    warn(`marketplace: cannot read rollback state: ${message(error)}`)
    return { record: null, valid: false }
  }
  const record = parseJournalRecord(parsed)
  if (record === null) {
    warn(`marketplace: ignoring invalid rollback state at ${statePath}`)
    return { record: null, valid: false }
  }
  return { record, valid: true }
}

/** Validate a committed journal record into an adoptable recovery point. */
export function recoveryFromRecord(
  record: MarketplaceJournalRecord | null,
  rollbacksRoot: string,
  warn: Warn,
): MarketplaceRecoveryPoint | null {
  if (record === null) return null
  const root = resolve(rollbacksRoot)
  const backup = resolve(record.backupProfile)
  if (backup !== root && !backup.startsWith(root + sep)) {
    warn(`marketplace: ignoring rollback state outside ${rollbacksRoot}`)
    return null
  }
  if (!existsSync(record.backupProfile)) {
    warn(`marketplace: the apply backup at ${record.backupProfile} is gone; dropping the recovery point`)
    return null
  }
  return {
    appliedAt: record.appliedAt ?? new Date(0).toISOString(),
    backupProfile: record.backupProfile,
    pluginId: record.pluginId,
    transactionId: record.transactionId,
  }
}

export function journalIntentRecord(
  phase: 'applying' | 'undoing',
  details: {
    appliedAt?: string | null
    backupProfile: string
    pluginId: string
    transactionId: string
  },
): MarketplaceJournalRecord {
  return {
    appliedAt: details.appliedAt ?? null,
    backupProfile: details.backupProfile,
    committed: false,
    phase,
    pluginId: details.pluginId,
    transactionId: details.transactionId,
    version: 2,
  }
}

export function journalAppliedRecord(details: {
  appliedAt: string
  backupProfile: string
  pluginId: string
  transactionId: string
}): MarketplaceJournalRecord {
  return {
    appliedAt: details.appliedAt,
    backupProfile: details.backupProfile,
    committed: true,
    phase: 'applied',
    pluginId: details.pluginId,
    transactionId: details.transactionId,
    version: 2,
  }
}

/** Atomically persist one journal record (tmp + rename, never a half file). */
export function writeJournal(statePath: string, record: MarketplaceJournalRecord): void {
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  writeFileAtomicSync(statePath, `${JSON.stringify(record, undefined, 2)}\n`, { mode: 0o600 })
}

/** The currently stored raw journal payload, verbatim in any version. */
export function readRawJournal(statePath: string): unknown {
  try {
    if (!existsSync(statePath)) return null
    return JSON.parse(readFileSync(statePath, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** Restore the journal to a verbatim prior payload (`null` clears it). */
export function restoreJournal(statePath: string, raw: unknown): void {
  if (raw === null) {
    clearJournal(statePath)
    return
  }
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  writeFileAtomicSync(statePath, `${JSON.stringify(raw, undefined, 2)}\n`, { mode: 0o600 })
}

export function clearJournal(statePath: string): void {
  rmSync(statePath, { force: true })
}

/**
 * Reconcile-side tree removal. Unlike best-effort cleanup elsewhere, a
 * failure here is reported (warn AND problem) instead of silently swallowed:
 * a leftover tree changes what the next reconcile decides.
 */
function removeTree(path: string, problems: string[], warn: Warn): void {
  try {
    rmSync(path, { force: true, recursive: true })
  } catch (error) {
    const text = `failed to clean the marketplace transaction directory at ${path}: ${message(error)}`
    warn(`plugin-marketplace: ${text}`)
    problems.push(text)
  }
}

function moveSync(from: string, to: string, problems: string[], warn: Warn): boolean {
  try {
    renameSync(from, to)
    return true
  } catch (error) {
    const text = `failed to move ${from} to ${to}: ${message(error)}`
    warn(`plugin-marketplace: ${text}`)
    problems.push(text)
    return false
  }
}

/** Announce a repair before its disk mutation (warn-first discipline). */
function repair(repairs: string[], warn: Warn, text: string): void {
  warn(`plugin-marketplace reconcile: ${text}`)
  repairs.push(text)
}

function replacedDirectories(rollbacksRoot: string): string[] {
  if (!existsSync(rollbacksRoot)) return []
  return readdirSync(rollbacksRoot).filter(entry => entry.startsWith('replaced-'))
}

function unusedSibling(parent: string, base: string): string {
  let candidate = join(parent, base)
  let index = 0
  while (existsSync(candidate)) {
    index += 1
    candidate = join(parent, `${base}-${String(index)}`)
  }
  return candidate
}

/**
 * Last-resort repair for the fatal row: neither the live profile nor any
 * backup survived. Rebuild the minimal scaffold the manager and the pinned
 * runtime expect from a fresh profile, and report the data loss explicitly.
 */
function scaffoldEmptyProfile(profileDir: string, profile: string, problems: string[]): void {
  try {
    mkdirSync(profileDir, { recursive: true, mode: 0o700 })
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
      dependencies: {},
      dsh: { profile: { bundles: [] } },
      name: profile,
      private: true,
    }, undefined, 2)}\n`, { mode: 0o600 })
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n', { mode: 0o600 })
  } catch (error) {
    problems.push(`failed to rebuild an empty desktop profile at ${profileDir}: ${message(error)}`)
  }
}

/**
 * Sweep every rollbacks-root entry that an adopted recovery point does not
 * reference: orphaned transaction directories, `failed-candidate-*`
 * quarantines, and leftover `replaced-*` directories.
 */
function sweepTransactionOrphans(
  rollbacksRoot: string,
  keepRoot: string | null,
  statePath: string,
  problems: string[],
  repairs: string[],
  warn: Warn,
): void {
  if (!existsSync(rollbacksRoot)) return
  const keep = keepRoot === null ? null : resolve(keepRoot)
  const journalFile = resolve(statePath)
  for (const entry of readdirSync(rollbacksRoot)) {
    const path = join(rollbacksRoot, entry)
    // The journal file itself lives directly under the root; it is never an
    // orphan.
    if (resolve(path) === journalFile) continue
    if (keep !== null && resolve(path) === keep) continue
    repair(repairs, warn, `removing an unreconciled marketplace transaction directory: ${path}`)
    removeTree(path, problems, warn)
  }
}

/**
 * Decide, from the journal plus the on-disk facts, what happened to an
 * interrupted transaction and repair it warn-first. See the module decision
 * table for rows 1-7.
 */
export function reconcileJournal(input: ReconcileJournalInput): JournalReconciliation {
  const { profile, profileDir, rollbacksRoot, statePath, warn } = input
  const problems: string[] = []
  const repairs: string[] = []
  const loaded = loadJournal(statePath, warn)
  if (!loaded.valid) {
    // A corrupt ledger must not trigger destructive repairs over backups it
    // can no longer interpret; the warning above is the whole action.
    return { problems, recovery: null, repairs }
  }
  const record = loaded.record
  let recovery = recoveryFromRecord(record, rollbacksRoot, warn)

  if (record !== null && !record.committed) {
    const fatalLoss = (): void => {
      // Row 6: neither the live profile nor a restorable source survived.
      const direction = record.phase === 'applying' ? 'apply' : 'undo'
      repair(repairs, warn,
        `no desktop profile or backup survived the interrupted ${direction} of ${record.pluginId}; rebuilding an empty profile`)
      scaffoldEmptyProfile(profileDir, profile, problems)
      problems.push(
        `the previous desktop profile could not be recovered after an interrupted marketplace ${direction} `
        + `for ${record.pluginId}; an empty profile was rebuilt and the transaction was discarded`,
      )
      clearJournal(statePath)
      recovery = null
    }

    if (record.phase === 'applying') {
      recovery = null
      const profileExists = existsSync(profileDir)
      const backupExists = existsSync(record.backupProfile)
      if (!profileExists && backupExists) {
        // Row 3 (W2): the live profile was renamed away but the candidate
        // never moved in — restore the backup.
        repair(repairs, warn,
          `restoring the desktop profile from its apply backup after an interrupted install of ${record.pluginId}`)
        if (moveSync(record.backupProfile, profileDir, problems, warn)) clearJournal(statePath)
      } else if (profileExists && backupExists) {
        // Row 4 (W3/W4): the candidate was swapped in but the terminal
        // journal write never happened — conservatively roll back to the
        // backup, quarantining the half-applied candidate for deletion.
        repair(repairs, warn,
          `rolling back the interrupted apply of ${record.pluginId}: the half-applied profile is discarded and the previous profile restored`)
        const quarantine = unusedSibling(rollbacksRoot, 'failed-candidate')
        const movedCandidate = moveSync(profileDir, quarantine, problems, warn)
        const movedBackup = moveSync(record.backupProfile, profileDir, problems, warn)
        if (movedCandidate) removeTree(quarantine, problems, warn)
        if (movedBackup) clearJournal(statePath)
      } else if (profileExists) {
        // Row 5 (W1): intent written, no rename happened yet.
        repair(repairs, warn,
          `discarding an apply intent for ${record.pluginId} that never renamed the desktop profile`)
        clearJournal(statePath)
      } else {
        fatalLoss()
      }
    } else {
      const replacedEntries = replacedDirectories(rollbacksRoot)
      const replacedPath = replacedEntries.length > 0 ? join(rollbacksRoot, replacedEntries[0] as string) : null
      const profileExists = existsSync(profileDir)
      const backupExists = existsSync(record.backupProfile)
      if (profileExists && backupExists) {
        // Row 7 / U1: the undo never renamed anything; the recovery point
        // from before the undo attempt stays valid.
        repair(repairs, warn,
          `discarding an undo intent for ${record.pluginId} that never renamed the desktop profile`)
        clearJournal(statePath)
      } else if (!profileExists && replacedPath !== null) {
        // Row 7 / U2: the swap was interrupted mid-flight; the applied
        // profile sits at replaced-* — put it back and re-terminalize the
        // journal (our own v2 record, not a v1 rewrite).
        repair(repairs, warn,
          `restoring the desktop profile from the interrupted undo of ${record.pluginId}`)
        if (moveSync(replacedPath, profileDir, problems, warn)) {
          writeJournal(statePath, journalAppliedRecord({
            appliedAt: record.appliedAt ?? new Date().toISOString(),
            backupProfile: record.backupProfile,
            pluginId: record.pluginId,
            transactionId: record.transactionId,
          }))
          recovery = recoveryFromRecord(
            journalAppliedRecord({
              appliedAt: record.appliedAt ?? new Date().toISOString(),
              backupProfile: record.backupProfile,
              pluginId: record.pluginId,
              transactionId: record.transactionId,
            }),
            rollbacksRoot,
            warn,
          )
        }
      } else if (profileExists) {
        // Row 7 / U3: the backup already moved back in — finish the undo by
        // sweeping the replaced tree and releasing the recovery point.
        repair(repairs, warn,
          `finishing the interrupted undo for ${record.pluginId}: the recovery point is released`)
        for (const entry of replacedEntries) {
          removeTree(join(rollbacksRoot, entry as string), problems, warn)
        }
        clearJournal(statePath)
        recovery = null
      } else {
        fatalLoss()
      }
    }
  }

  sweepTransactionOrphans(
    rollbacksRoot,
    recovery === null ? null : dirname(recovery.backupProfile),
    statePath,
    problems,
    repairs,
    warn,
  )
  return { problems, recovery, repairs }
}
