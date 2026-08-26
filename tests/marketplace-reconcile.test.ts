import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type {
  BundleBuildInput,
  DshCommandInput,
  LoadCatalogOptions,
  MarketplaceAuthResult,
  MarketplacePlatform,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import {
  PluginMarketplaceManager,
  type MarketplacePreviewRuntimeInput,
  type MarketplaceRuntime,
} from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

// Crash-window fixture tests for the marketplace transaction journal
// (current.json v2) and its constructor-time reconcile. Each fixture rebuilds
// one interrupted-apply (W1..W5) or interrupted-undo (U1..U3) disk state in a
// fresh temp directory and asserts the documented reconcile outcome, plus the
// v1 rollback.json lazy-upgrade contract.

const TX = 'crash-fixture-tx'
const COMMIT = '0123456789abcdef0123456789abcdef01234567'

type Marker = 'original' | 'candidate'

interface DeadPlatformOptions {
  failLiveReHome?: boolean
}

/** Platform stub for construction-only fixtures; no command ever reaches it. */
class DeadPlatform implements MarketplacePlatform {
  readonly #options: DeadPlatformOptions

  constructor(options: DeadPlatformOptions = {}) {
    this.#options = options
  }

  async authStatus(): Promise<MarketplaceAuthResult> {
    return { detail: 'test auth', status: 'ready' }
  }

  async buildBundle(_input: BundleBuildInput): Promise<void> {}

  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export function apply() {}\n')
  }

  async loadCatalog(_options: LoadCatalogOptions = {}): Promise<unknown> {
    return {
      generated: '2026-08-10T17:17:56.572Z',
      repos: [{
        bundle: true,
        category: 'plugin',
        description: 'Safe bundle demo',
        name: 'safe-demo',
        repo: 'omdsh-dev/safe-demo',
        repository: false,
      }],
      schema: 'dsh-external-hub/v0.1',
    }
  }

  async readRepositoryFile(repository: string, path: string): Promise<string | null> {
    if (repository !== 'omdsh-dev/safe-demo') return null
    if (path === 'package.json') {
      return JSON.stringify({
        description: 'safe-demo manifest',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        license: 'MIT',
        main: './index.js',
        name: '@example/safe-demo',
        scripts: {},
        version: '1.0.0',
      })
    }
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: fixture-row\n      name: ./index.js\n'
    if (path === 'index.js') return 'export function apply() {}\n'
    return null
  }

  async resolveCommit(_repository: string): Promise<string> {
    return COMMIT
  }

  async runDsh(input: DshCommandInput): Promise<void> {
    if (input.sandboxed === false && this.#options.failLiveReHome === true) {
      throw new Error('simulated live re-home failure')
    }
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    if (input.args.includes('add')) {
      manifest.dependencies['@example/safe-demo'] = `link:${String(input.args.at(-1))}`
      if (!manifest.dsh.profile.bundles.includes('@example/safe-demo')) {
        manifest.dsh.profile.bundles.push('@example/safe-demo')
      }
    } else if (input.args.includes('remove')) {
      delete manifest.dependencies['@example/safe-demo']
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles
        .filter(entry => entry !== '@example/safe-demo')
    }
    writeFileSync(profile, `${JSON.stringify(manifest, undefined, 2)}\n`)
  }
}

class FixtureRuntime implements MarketplaceRuntime {
  liveStarts = 0
  failStartLiveFrom = Number.POSITIVE_INFINITY
  gateLiveStops: Promise<void> | null = null
  gateLiveStarts: Promise<void> | null = null

  async startLive(): Promise<void> {
    if (this.gateLiveStarts !== null) await this.gateLiveStarts
    this.liveStarts += 1
    if (this.liveStarts >= this.failStartLiveFrom) throw new Error('simulated start failure')
  }

  async stopLive(): Promise<void> {
    if (this.gateLiveStops !== null) await this.gateLiveStops
  }

  async startPreview(_input: MarketplacePreviewRuntimeInput): Promise<void> {}

  async stopPreview(): Promise<void> {}
}

function writeProfileTree(dir: string, marker: Marker): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    dependencies: { [`@marker/${marker}`]: '*' },
    dsh: { profile: { bundles: ['@dsh-studio/desktop'] } },
    name: 'desktop',
    private: true,
  }, undefined, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
}

function markerDependency(profileDir: string): string | null {
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  return Object.keys(manifest.dependencies)[0] ?? null
}

function applyIntentJournal(backupProfile: string, overrides: Record<string, unknown> = {}):
Record<string, unknown> {
  return {
    appliedAt: null,
    backupProfile,
    committed: false,
    phase: 'applying',
    pluginId: 'safe-demo',
    transactionId: TX,
    version: 2,
    ...overrides,
  }
}

function undoIntentJournal(backupProfile: string): Record<string, unknown> {
  // appliedAt rides along so an interrupted-undo reconcile can re-terminalize
  // the journal without rebasing the recovery point.
  return applyIntentJournal(backupProfile, {
    appliedAt: '2026-08-26T00:00:00.000Z',
    phase: 'undoing',
  })
}

function appliedJournalRecord(backupProfile: string): Record<string, unknown> {
  return {
    appliedAt: '2026-08-26T00:00:00.000Z',
    backupProfile,
    committed: true,
    phase: 'applied',
    pluginId: 'safe-demo',
    transactionId: TX,
    version: 2,
  }
}

function v1RollbackJson(backupProfile: string): Record<string, unknown> {
  // The legacy format: no version field at all.
  return {
    appliedAt: '2026-08-26T00:00:00.000Z',
    backupProfile,
    pluginId: 'safe-demo',
    transactionId: TX,
  }
}

interface CrashSpec {
  /** Content of the apply backup at rollbacks/<TX>/desktop. */
  backup?: Marker | null
  extraRollbackEntries?: string[]
  /** Builds current.json from the (world-dependent) backup path. */
  journal?: (backupProfile: string) => Record<string, unknown> | null
  /** Platform behavior knobs for fixtures that drive real commands. */
  platform?: DeadPlatformOptions
  /** A leftover replaced-* directory and its content marker. */
  replaced?: Marker | null
  /** The live profile directory state at construction time. */
  profile?: Marker | 'missing'
}

interface CrashWorld {
  appDataPath: string
  backupProfile: string
  cleanup(): void
  manager(): PluginMarketplaceManager
  profileDir: string
  rollbacksRoot: string
  statePath: string
  warnings: string[]
}

function crashFixture(spec: CrashSpec): CrashWorld {
  const appDataPath = mkdtempSync(join(tmpdir(), 'dsh-studio-marketplace-reconcile-'))
  const profileDir = join(appDataPath, 'dsh', 'profiles', 'desktop')
  const rollbacksRoot = join(appDataPath, 'plugin-marketplace', 'rollbacks')
  const statePath = join(rollbacksRoot, 'current.json')
  const backupProfile = join(rollbacksRoot, TX, 'desktop')

  if (spec.profile === 'missing') {
    mkdirSync(join(profileDir, '..'), { recursive: true })
  } else if (spec.profile !== undefined) {
    writeProfileTree(profileDir, spec.profile)
  }
  if (spec.backup != null) writeProfileTree(backupProfile, spec.backup)
  if (spec.replaced != null) {
    writeProfileTree(join(rollbacksRoot, 'replaced-fixture'), spec.replaced)
  }
  for (const entry of spec.extraRollbackEntries ?? []) {
    mkdirSync(join(rollbacksRoot, entry), { recursive: true })
    writeFileSync(join(rollbacksRoot, entry, 'junk.txt'), 'orphan\n')
  }
  const journal = spec.journal?.(backupProfile)
  if (journal != null) {
    mkdirSync(rollbacksRoot, { recursive: true, mode: 0o700 })
    writeFileSync(statePath, `${JSON.stringify(journal, undefined, 2)}\n`)
  }

  const warnings: string[] = []
  return {
    appDataPath,
    backupProfile,
    cleanup: () => { rmSync(appDataPath, { recursive: true, force: true }) },
    manager: () => new PluginMarketplaceManager({
      appDataPath,
      dshHome: join(appDataPath, 'dsh'),
      onWarn: text => { warnings.push(text) },
      platform: new DeadPlatform(spec.platform),
      profile: 'desktop',
      runtime: new FixtureRuntime(),
    }),
    profileDir,
    rollbacksRoot,
    statePath,
    warnings,
  }
}

/**
 * Seed a marketplace receipt plus an enabled-bundle manifest entry for
 * `safe-demo`, matching what a real install leaves behind, so manage-actions
 * (disable etc.) resolve against the fixture profile.
 */
function installReceipt(profileDir: string): void {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  manifest.dependencies['@example/safe-demo'] = `link:.dsh-studio/sources/safe-demo-${COMMIT.slice(0, 12)}`
  if (!manifest.dsh.profile.bundles.includes('@example/safe-demo')) {
    manifest.dsh.profile.bundles.push('@example/safe-demo')
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  mkdirSync(join(profileDir, '.dsh-studio'), { recursive: true, mode: 0o700 })
  writeFileSync(join(profileDir, '.dsh-studio', 'marketplace.json'), `${JSON.stringify({
    entries: [{
      installedAt: '2026-08-25T00:00:00.000Z',
      mechanism: 'bundle',
      packageName: '@example/safe-demo',
      pluginId: 'safe-demo',
      resolvedCommit: COMMIT,
      source: `github:omdsh-dev/safe-demo#${COMMIT}`,
    }],
    locks: [],
    version: 3,
  }, undefined, 2)}\n`)
}

function readJournal(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Apply crash windows W1..W5
// ---------------------------------------------------------------------------

test('W1: an apply intent that never renamed the profile is discarded warn-first', () => {
  const world = crashFixture({
    backup: null,
    journal: backup => applyIntentJournal(backup),
    profile: 'original',
  })
  try {
    const manager = world.manager()
    assert.equal(markerDependency(world.profileDir), '@marker/original')
    assert.equal(manager.phase, 'idle')
    assert.equal(manager.getSnapshot().undoAvailable, false)
    assert.equal(readJournal(world.statePath), null)
    assert.ok(!existsSync(join(world.rollbacksRoot, TX)), 'the orphan tx root is swept')
    assert.ok(world.warnings.some(text => /apply intent/.test(text)))
  } finally {
    world.cleanup()
  }
})

test('W2: a crash between the two apply renames restores the backup', () => {
  const world = crashFixture({
    backup: 'original',
    journal: backup => applyIntentJournal(backup),
    profile: 'missing',
  })
  try {
    const manager = world.manager()
    assert.equal(markerDependency(world.profileDir), '@marker/original')
    assert.equal(manager.phase, 'idle')
    assert.equal(manager.getSnapshot().undoAvailable, false)
    assert.equal(readJournal(world.statePath), null)
    assert.ok(!existsSync(join(world.rollbacksRoot, TX)), 'the consumed tx root is swept')
    assert.ok(!existsSync(world.backupProfile))
    assert.ok(world.warnings.some(text => /restoring the desktop profile/.test(text)))
    assert.deepEqual(manager.getSnapshot().error, null)
  } finally {
    world.cleanup()
  }
})

test('W3/W4: a half-applied candidate is quarantined and rolled back to the backup', () => {
  for (const installed of [false, true]) {
    const world = crashFixture({
      backup: 'original',
      journal: backup => applyIntentJournal(backup),
      profile: 'candidate',
    })
    try {
      if (installed) {
        // W4: the candidate finished installing before the crash — on-disk
        // indistinguishable from W3, so reconcile conservatively rolls back.
        mkdirSync(join(world.profileDir, 'node_modules'), { recursive: true })
        writeFileSync(join(world.profileDir, 'node_modules', '.store-ok'), '')
      }
      const manager = world.manager()
      assert.equal(markerDependency(world.profileDir), '@marker/original')
      assert.equal(manager.phase, 'idle')
      assert.equal(readJournal(world.statePath), null)
      assert.deepEqual(readdirSync(world.rollbacksRoot), [], 'quarantine and tx root are swept')
      assert.ok(world.warnings.some(text => /rolling back the interrupted apply/.test(text)))
      assert.deepEqual(manager.getSnapshot().error, null)
    } finally {
      world.cleanup()
    }
  }
})

test('W5: a terminal committed journal resumes as applied-with-undo', () => {
  const world = crashFixture({
    backup: 'original',
    journal: backup => appliedJournalRecord(backup),
    profile: 'candidate',
  })
  try {
    const manager = world.manager()
    assert.equal(manager.phase, 'applied-with-undo')
    assert.equal(markerDependency(world.profileDir), '@marker/candidate')
    assert.equal(manager.getSnapshot().undoAvailable, true)
    assert.deepEqual(
      readJournal(world.statePath),
      appliedJournalRecord(world.backupProfile),
      'a healthy terminal journal is not rewritten',
    )
    assert.ok(existsSync(join(world.rollbacksRoot, TX)), 'the referenced tx root is kept')
  } finally {
    world.cleanup()
  }
})

// ---------------------------------------------------------------------------
// Undo crash windows U1..U3
// ---------------------------------------------------------------------------

test('U1: an undo intent that never renamed the profile keeps the recovery point', () => {
  const world = crashFixture({
    backup: 'original',
    journal: backup => undoIntentJournal(backup),
    profile: 'candidate',
  })
  try {
    const manager = world.manager()
    assert.equal(manager.phase, 'applied-with-undo')
    assert.equal(markerDependency(world.profileDir), '@marker/candidate')
    assert.equal(manager.getSnapshot().undoAvailable, true)
    assert.ok(existsSync(world.backupProfile))
    assert.equal(readJournal(world.statePath), null)
    assert.ok(world.warnings.some(text => /undo intent/.test(text)))
  } finally {
    world.cleanup()
  }
})

test('U2: an interrupted undo swap restores replaced-* and re-terminalizes the journal', () => {
  const world = crashFixture({
    backup: 'original',
    journal: backup => undoIntentJournal(backup),
    profile: 'missing',
    replaced: 'original',
  })
  try {
    const manager = world.manager()
    assert.equal(markerDependency(world.profileDir), '@marker/original')
    assert.equal(manager.phase, 'applied-with-undo')
    assert.equal(manager.getSnapshot().undoAvailable, true)
    assert.deepEqual(
      readJournal(world.statePath),
      appliedJournalRecord(world.backupProfile),
      'our own v2 intent is normalized back to terminal applied',
    )
    assert.ok(existsSync(world.backupProfile), 'the recovery point survives')
    assert.ok(!existsSync(join(world.rollbacksRoot, 'replaced-fixture')))
    assert.ok(world.warnings.some(text => /interrupted undo/.test(text)))
  } finally {
    world.cleanup()
  }
})

test('U3: a completed-on-disk undo is finished by sweeping replaced-* and clearing the journal', () => {
  const world = crashFixture({
    backup: null,
    journal: backup => undoIntentJournal(backup),
    profile: 'original',
    replaced: 'candidate',
  })
  try {
    const manager = world.manager()
    assert.equal(manager.phase, 'idle')
    assert.equal(markerDependency(world.profileDir), '@marker/original')
    assert.equal(manager.getSnapshot().undoAvailable, false)
    assert.equal(readJournal(world.statePath), null)
    assert.ok(!existsSync(join(world.rollbacksRoot, 'replaced-fixture')))
    assert.ok(world.warnings.some(text => /finishing the interrupted undo/.test(text)))
  } finally {
    world.cleanup()
  }
})

test('fatal P✗B✗: an unrestorable state rebuilds an empty profile and reports an error snapshot', () => {
  const world = crashFixture({
    backup: null,
    journal: backup => applyIntentJournal(backup),
    profile: 'missing',
  })
  try {
    const manager = world.manager()
    assert.ok(existsSync(join(world.profileDir, 'package.json')), 'an empty profile was rebuilt')
    const manifest = JSON.parse(readFileSync(join(world.profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      name: string
    }
    assert.deepEqual(manifest.dependencies, {})
    assert.equal(manifest.name, 'desktop')
    assert.match(manager.getSnapshot().error ?? '', /could not be recovered/)
    assert.equal(manager.getSnapshot().undoAvailable, false)
    assert.equal(readJournal(world.statePath), null)
    assert.ok(world.warnings.some(text => /rebuilding an empty profile/.test(text)))
  } finally {
    world.cleanup()
  }
})

// ---------------------------------------------------------------------------
// Orphan recovery + corrupt ledger conservatism
// ---------------------------------------------------------------------------

test('orphan transaction directories, failed-candidate and replaced leftovers are swept warn-first', () => {
  const world = crashFixture({
    extraRollbackEntries: ['deadbeef-tx', 'failed-candidate', 'replaced-zzz'],
    profile: 'original',
  })
  try {
    const manager = world.manager()
    assert.deepEqual(readdirSync(world.rollbacksRoot), [])
    assert.equal(markerDependency(world.profileDir), '@marker/original')
    assert.match(world.warnings.join('\n'), /unreconciled marketplace transaction directory/)
    assert.deepEqual(manager.getSnapshot().error, null)
  } finally {
    world.cleanup()
  }
})

test('a corrupt ledger disables repair entirely instead of sweeping unreadable backups', () => {
  const world = crashFixture({
    backup: 'original',
    profile: 'candidate',
  })
  try {
    writeFileSync(world.statePath, '{not json')
    const manager = world.manager()
    assert.equal(manager.phase, 'idle')
    assert.equal(manager.getSnapshot().undoAvailable, false)
    assert.ok(existsSync(world.backupProfile), 'the backup is untouched')
    assert.equal(markerDependency(world.profileDir), '@marker/candidate')
    assert.match(world.warnings.join('\n'), /cannot read rollback state/)
  } finally {
    world.cleanup()
  }
})

// ---------------------------------------------------------------------------
// v1 rollback.json compatibility (lazy upgrade)
// ---------------------------------------------------------------------------

test('v1 rollback.json reads as an applied recovery point and is lazily upgraded by the next successful transaction', async () => {
  const world = crashFixture({
    backup: 'original',
    journal: backup => v1RollbackJson(backup),
    profile: 'candidate',
  })
  try {
    installReceipt(world.profileDir)
    const rawBefore = readFileSync(world.statePath, 'utf8')
    const manager = world.manager()
    // v1 semantics interpreted: phase applied + committed.
    assert.equal(manager.phase, 'applied-with-undo')
    assert.equal(manager.getSnapshot().undoAvailable, true)
    // Lazy upgrade: construction alone must NOT batch-rewrite the file.
    assert.equal(readFileSync(world.statePath, 'utf8'), rawBefore)

    // Drive one real successful transaction; its terminal journal write is
    // where the v1 record upgrades to v2.
    assert.equal((await manager.dispatch({ type: 'refresh' })).error, null)
    assert.equal((await manager.dispatch({ type: 'inspect', action: 'disable', pluginId: 'safe-demo' })).error, null)
    assert.equal((await manager.dispatch({ type: 'preview' })).error, null)
    const applied = await manager.dispatch({ type: 'apply' })
    assert.equal(applied.error, null)

    const upgraded = readJournal(world.statePath)
    assert.notEqual(upgraded, null)
    assert.equal(upgraded?.version, 2)
    assert.equal(upgraded?.phase, 'applied')
    assert.equal(upgraded?.committed, true)
    assert.equal(applied.undoAvailable, true)
    // Atomic upgrade: no temporary sibling survives.
    assert.deepEqual(
      readdirSync(world.rollbacksRoot).filter(entry => entry.includes('.tmp')),
      [],
    )
  } finally {
    world.cleanup()
  }
})

test('v1 rollback.json survives a failed transaction attempt without being rewritten', async () => {
  const world = crashFixture({
    backup: 'original',
    journal: backup => v1RollbackJson(backup),
    platform: { failLiveReHome: true },
    profile: 'candidate',
  })
  try {
    installReceipt(world.profileDir)
    const manager = world.manager()
    assert.equal(manager.getSnapshot().undoAvailable, true)
    assert.equal((await manager.dispatch({ type: 'refresh' })).error, null)
    assert.equal((await manager.dispatch({ type: 'inspect', action: 'disable', pluginId: 'safe-demo' })).error, null)
    assert.equal((await manager.dispatch({ type: 'preview' })).error, null)
    // The live re-home fails, so the apply rolls back after both renames.
    const snapshot = await manager.dispatch({ type: 'apply' })
    assert.match(snapshot.error ?? '', /failed to apply and was rolled back/)

    const raw = readJournal(world.statePath)
    assert.notEqual(raw, null)
    assert.equal(raw?.version, undefined, 'the v1 record is preserved verbatim')
    assert.equal(raw?.transactionId, TX)
    assert.equal(snapshot.undoAvailable, true)
  } finally {
    world.cleanup()
  }
})

// ---------------------------------------------------------------------------
// Live intent/terminal timing over real transactions
// ---------------------------------------------------------------------------

interface FlowFixture {
  appDataPath: string
  cleanup(): void
  manager: PluginMarketplaceManager
  platformOptions: DeadPlatformOptions
  profileDir: string
  rollbacksRoot: string
  runtime: FixtureRuntime
  statePath: string
}

function flowFixture(options: DeadPlatformOptions = {}): FlowFixture {
  const appDataPath = mkdtempSync(join(tmpdir(), 'dsh-studio-marketplace-reconcile-flow-'))
  const profileDir = join(appDataPath, 'dsh', 'profiles', 'desktop')
  const rollbacksRoot = join(appDataPath, 'plugin-marketplace', 'rollbacks')
  writeProfileTree(profileDir, 'original')
  const runtime = new FixtureRuntime()
  const platform = new DeadPlatform(options)
  const warnings: string[] = []
  const manager = new PluginMarketplaceManager({
    appDataPath,
    dshHome: join(appDataPath, 'dsh'),
    onWarn: text => { warnings.push(text) },
    platform,
    profile: 'desktop',
    runtime,
  })
  return {
    appDataPath,
    cleanup: () => { rmSync(appDataPath, { recursive: true, force: true }) },
    manager,
    // DeadPlatform reads this object per call, so tests can flip knobs mid-flow.
    platformOptions: options,
    profileDir,
    rollbacksRoot,
    runtime,
    statePath: join(rollbacksRoot, 'current.json'),
  }
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500 && !condition(); attempt += 1) {
    await new Promise(resolve => { setImmediate(resolve) })
  }
  assert.ok(condition(), 'timed out waiting for the gated phase')
}

test('the applying intent is durable before the first rename and becomes terminal after success', async () => {
  const setup = flowFixture()
  try {
    const { manager, runtime, statePath } = setup
    assert.equal((await manager.dispatch({ type: 'refresh' })).error, null)
    assert.equal((await manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'safe-demo' })).error, null)
    assert.equal((await manager.dispatch({ type: 'preview' })).error, null)

    let release: (() => void) | undefined
    runtime.gateLiveStops = new Promise<void>(resolve => { release = resolve })
    const applying = manager.dispatch({ type: 'apply' })
    await until(() => existsSync(statePath))
    const intent = readJournal(statePath)
    assert.equal(intent?.version, 2)
    assert.equal(intent?.phase, 'applying')
    assert.equal(intent?.committed, false)
    release?.()

    const applied = await applying
    assert.equal(applied.error, null)
    const terminal = readJournal(statePath)
    assert.equal(terminal?.version, 2)
    assert.equal(terminal?.phase, 'applied')
    assert.equal(terminal?.committed, true)
    assert.equal(applied.undoAvailable, true)

    let undoRelease: (() => void) | undefined
    runtime.gateLiveStarts = new Promise<void>(resolve => { undoRelease = resolve })
    const undoing = manager.dispatch({ type: 'undo' })
    await until(() => {
      const journal = readJournal(statePath)
      return journal !== null && journal.phase === 'undoing'
    })
    const undoIntent = readJournal(statePath)
    assert.equal(undoIntent?.committed, false)
    undoRelease?.()

    const undone = await undoing
    assert.equal(undone.error, null)
    assert.equal(undone.undoAvailable, false)
    assert.equal(readJournal(statePath), null, 'a completed undo clears the journal')
  } finally {
    setup.cleanup()
  }
})

test('a failed apply restores the prior journal record verbatim', async () => {
  const setup = flowFixture()
  try {
    const { manager, platformOptions, statePath } = setup
    assert.equal((await manager.dispatch({ type: 'refresh' })).error, null)
    assert.equal((await manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'safe-demo' })).error, null)
    assert.equal((await manager.dispatch({ type: 'preview' })).error, null)
    assert.equal((await manager.dispatch({ type: 'apply' })).error, null)
    const priorRaw = readFileSync(statePath, 'utf8')

    // Second transaction: disable the plugin, then fail the live re-home.
    assert.equal((await manager.dispatch({ type: 'inspect', action: 'disable', pluginId: 'safe-demo' })).error, null)
    assert.equal((await manager.dispatch({ type: 'preview' })).error, null)
    platformOptions.failLiveReHome = true
    const snapshot = await manager.dispatch({ type: 'apply' })
    assert.match(snapshot.error ?? '', /failed to apply and was rolled back/)
    assert.equal(readFileSync(statePath, 'utf8'), priorRaw)
    assert.equal(snapshot.undoAvailable, true)
  } finally {
    setup.cleanup()
  }
})

test('a failed undo restores the applied journal verbatim', async () => {
  const setup = flowFixture()
  try {
    const { manager, runtime, statePath } = setup
    assert.equal((await manager.dispatch({ type: 'refresh' })).error, null)
    assert.equal((await manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'safe-demo' })).error, null)
    assert.equal((await manager.dispatch({ type: 'preview' })).error, null)
    assert.equal((await manager.dispatch({ type: 'apply' })).error, null)
    const priorRaw = readFileSync(statePath, 'utf8')

    runtime.failStartLiveFrom = 2
    const snapshot = await manager.dispatch({ type: 'undo' })
    assert.match(snapshot.error ?? '', /failed to restore the previous plugin profile/)
    assert.equal(readFileSync(statePath, 'utf8'), priorRaw)
    assert.equal(snapshot.undoAvailable, true)
    assert.equal(manager.phase, 'applied-with-undo')
  } finally {
    setup.cleanup()
  }
})
