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
  MarketplaceBusyError,
  PluginMarketplaceManager,
  type MarketplacePhase,
  type MarketplacePreviewRuntimeInput,
  type MarketplaceRuntime,
} from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import type { MarketplaceSnapshot } from '../plugins/plugin-marketplace/src/protocol.ts'

// Behavior tests for the explicit marketplace phase machine
// (idle → catalog-ready → planning → previewing → applying →
// applied-with-undo → undoing) and its command×phase guard matrix. The
// external snapshot DTO is asserted only through its published fields.

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const UPDATED_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98'

function catalogDocument(): unknown {
  return {
    schema: 'dsh-external-hub/v0.1',
    generated: '2026-08-10T17:17:56.572Z',
    repos: [
      {
        name: 'bundle-demo',
        repo: 'dsh-external/bundle-demo',
        category: 'plugin',
        description: 'Bundle demo',
        bundle: true,
        repository: false,
        tags: ['web-ui'],
      },
      {
        name: 'safe-demo',
        repo: 'omdsh-dev/safe-demo',
        category: 'plugin',
        description: 'Safe bundle demo',
        bundle: true,
        repository: false,
      },
    ],
  }
}

class FakePlatform implements MarketplacePlatform {
  latestCommit = COMMIT

  async authStatus(): Promise<MarketplaceAuthResult> {
    return { detail: 'test auth', status: 'ready' }
  }

  async buildBundle(_input: BundleBuildInput): Promise<void> {}

  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export function apply() {}\n')
  }

  async loadCatalog(_options: LoadCatalogOptions = {}): Promise<unknown> {
    return catalogDocument()
  }

  async readRepositoryFile(repository: string, path: string): Promise<string | null> {
    const pluginId = repository.split('/').at(-1) ?? repository
    const bundlePackages: Record<string, { name: string; prepare?: string }> = {
      'bundle-demo': { name: '@example/bundle-demo', prepare: 'node build.mjs' },
      'safe-demo': { name: '@example/safe-demo' },
    }
    const bundle = bundlePackages[pluginId]
    if (bundle !== undefined) {
      if (path === 'package.json') {
        return JSON.stringify({
          name: bundle.name,
          description: `${pluginId} manifest`,
          dsh: { bundle: { patch: './cordis.patch.yml' } },
          license: 'MIT',
          main: './index.js',
          scripts: bundle.prepare === undefined ? {} : { prepare: bundle.prepare },
          version: '1.0.0',
        })
      }
      if (path === 'cordis.patch.yml') return '- insert:\n    - id: fixture-row\n      name: ./index.js\n'
      if (path === 'index.js') return 'export function apply() {}\n'
    }
    return null
  }

  async resolveCommit(_repository: string): Promise<string> {
    return this.latestCommit
  }

  async runDsh(input: DshCommandInput): Promise<void> {
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8'))
    if (input.args.includes('add')) {
      const checkout = input.args.at(-1) as string
      const dependency = checkout.includes('safe-demo')
        ? '@example/safe-demo'
        : '@example/bundle-demo'
      manifest.dependencies[dependency] = `link:${checkout}`
      if (!manifest.dsh.profile.bundles.includes(dependency)) {
        manifest.dsh.profile.bundles.push(dependency)
      }
    } else if (input.args.includes('remove')) {
      const dependency = input.args.at(-1) as string
      delete manifest.dependencies[dependency]
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles
        .filter((entry: string) => entry !== dependency)
    }
    writeFileSync(profile, JSON.stringify(manifest, undefined, 2) + '\n')
  }
}

class FakeRuntime implements MarketplaceRuntime {
  liveStarts = 0
  liveStops = 0
  previewStarts: MarketplacePreviewRuntimeInput[] = []
  previewStops = 0
  gateLiveStops: Promise<void> | null = null
  failStartLiveFrom = Number.POSITIVE_INFINITY

  async startLive(): Promise<void> {
    this.liveStarts += 1
    if (this.liveStarts >= this.failStartLiveFrom) throw new Error('simulated start failure')
  }
  async stopLive(): Promise<void> {
    if (this.gateLiveStops !== null) await this.gateLiveStops
    this.liveStops += 1
  }
  async startPreview(input: MarketplacePreviewRuntimeInput): Promise<void> {
    this.previewStarts.push(input)
  }
  async stopPreview(): Promise<void> {
    this.previewStops += 1
  }
}

interface Fixture {
  appDataPath: string
  cleanup(): void
  manager: PluginMarketplaceManager
  platform: FakePlatform
  profileDir: string
  runtime: FakeRuntime
}

function fixture(): Fixture {
  const appDataPath = mkdtempSync(join(tmpdir(), 'dsh-studio-marketplace-phases-'))
  const dshHome = join(appDataPath, 'dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@dsh-studio/desktop'] } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new FakePlatform()
  const runtime = new FakeRuntime()
  const manager = new PluginMarketplaceManager({
    appDataPath,
    dshHome,
    platform,
    profile: 'desktop',
    runtime,
  })
  return {
    appDataPath,
    cleanup: () => { rmSync(appDataPath, { recursive: true, force: true }) },
    manager,
    platform,
    profileDir,
    runtime,
  }
}

/** Drive a fresh manager to the given resting phase via real commands. */
async function driveTo(setup: Fixture, phase: MarketplacePhase): Promise<void> {
  if (phase === 'idle') return
  assert.equal((await setup.manager.dispatch({ type: 'refresh' })).error, null)
  if (phase === 'catalog-ready') return
  assert.equal(
    (await setup.manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'safe-demo' })).error,
    null,
  )
  if (phase === 'planning') return
  assert.equal((await setup.manager.dispatch({ type: 'preview' })).error, null)
  if (phase === 'previewing') return
  assert.equal((await setup.manager.dispatch({ type: 'apply' })).error, null)
  assert.equal(phase, 'applied-with-undo')
}

const RESTING_PHASES: readonly MarketplacePhase[] = [
  'idle',
  'catalog-ready',
  'planning',
  'previewing',
  'applied-with-undo',
]

test('the transaction walks every phase explicitly through refresh/inspect/preview/apply/undo', async () => {
  const setup = fixture()
  try {
    const { manager } = setup
    assert.equal(manager.phase, 'idle')
    assert.equal((await manager.dispatch({ type: 'refresh' })).error, null)
    assert.equal(manager.phase, 'catalog-ready')
    await manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'safe-demo' })
    assert.equal(manager.phase, 'planning')
    await manager.dispatch({ type: 'preview' })
    assert.equal(manager.phase, 'previewing')
    let snapshot = await manager.dispatch({ type: 'apply' })
    assert.equal(snapshot.error, null)
    assert.equal(manager.phase, 'applied-with-undo')
    snapshot = manager.getSnapshot()
    assert.equal(snapshot.undoAvailable, true)
    assert.equal(snapshot.preview, null)
    assert.notEqual(snapshot.lifecycle.previous?.transactionId, undefined)

    // Undo returns the machine to its catalog-loaded resting phase.
    assert.equal((await manager.dispatch({ type: 'undo' })).error, null)
    assert.equal(manager.phase, 'catalog-ready')
    assert.equal(manager.getSnapshot().undoAvailable, false)
  } finally {
    setup.cleanup()
  }
})

test('prepare cascades into preview through an explicit planning→previewing transition', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'catalog-ready')
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'safe-demo',
    })
    assert.equal(snapshot.error, null)
    assert.equal(setup.manager.phase, 'previewing')
    assert.equal(snapshot.preview?.pluginId, 'safe-demo')
    assert.equal(snapshot.plan?.requirements.length, 0)
  } finally {
    setup.cleanup()
  }
})

test('a plan with confirmation requirements stops at planning until preview confirms them', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'catalog-ready')
    const prepared = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    assert.equal(prepared.error, null)
    assert.equal(setup.manager.phase, 'planning')
    assert.deepEqual(prepared.plan?.requirements, ['allow-build-scripts'])

    const rejected = await setup.manager.dispatch({ type: 'preview' })
    assert.match(rejected.error ?? '', /allow-build-scripts/)
    assert.equal(setup.manager.phase, 'planning')
    assert.equal(rejected.preview, null)

    const confirmed = await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts'],
    })
    assert.equal(confirmed.error, null)
    assert.equal(setup.manager.phase, 'previewing')
  } finally {
    setup.cleanup()
  }
})

test('command×phase guard matrix rejects every out-of-place command without mutating state', async () => {
  for (const phase of RESTING_PHASES) {
    const setup = fixture()
    try {
      await driveTo(setup, phase)
      const before = setup.manager.getSnapshot()

      // inspect / prepare are rejected while a preview is active.
      for (const type of ['inspect', 'prepare'] as const) {
        if (phase !== 'previewing') continue
        const snapshot = await setup.manager.dispatch({ type, action: 'install', pluginId: 'safe-demo' })
        assert.match(
          snapshot.error ?? '',
          /Apply or discard the current preview first\./,
          `${type} @ ${phase}`,
        )
      }

      // preview requires planning.
      if (phase !== 'planning') {
        const snapshot = await setup.manager.dispatch({ type: 'preview' })
        assert.match(
          snapshot.error ?? '',
          phase === 'previewing'
            ? /A plugin preview is already active\./
            : /Inspect a plugin before starting its preview\./,
          `preview @ ${phase}`,
        )
      }

      // apply requires previewing.
      if (phase !== 'previewing') {
        const snapshot = await setup.manager.dispatch({ type: 'apply' })
        assert.match(
          snapshot.error ?? '',
          /There is no prepared preview to apply\./,
          `apply @ ${phase}`,
        )
      }

      // undo requires applied-with-undo.
      if (phase !== 'applied-with-undo') {
        const snapshot = await setup.manager.dispatch({ type: 'undo' })
        assert.match(
          snapshot.error ?? '',
          /There is no previous plugin profile to restore\./,
          `undo @ ${phase}`,
        )
      }

      // Rejections leave both the phase and the published state untouched.
      assert.equal(setup.manager.phase, phase)
      const after = setup.manager.getSnapshot()
      assert.deepEqual(after.busy, before.busy)
      assert.deepEqual(after.preview, before.preview)
      assert.deepEqual(after.plan, before.plan)
      assert.deepEqual(after.undoAvailable, before.undoAvailable)
      assert.deepEqual(after.installed.map(entry => entry.pluginId), before.installed.map(entry => entry.pluginId))
    } finally {
      setup.cleanup()
    }
  }
})

test('refresh and discard are accepted in every resting phase and never regress the phase', async () => {
  for (const phase of RESTING_PHASES) {
    const setup = fixture()
    try {
      await driveTo(setup, phase)
      const settledPhase: MarketplacePhase = phase === 'idle' ? 'catalog-ready' : phase
      const refreshed = await setup.manager.dispatch({ type: 'refresh', force: true })
      assert.equal(refreshed.error, null, `refresh @ ${phase}`)
      assert.equal(setup.manager.phase, settledPhase, `refresh keeps the phase @ ${phase}`)

      const discarded = await setup.manager.dispatch({ type: 'discard' })
      assert.equal(discarded.error, null, `discard @ ${phase}`)
      if (phase === 'planning') {
        assert.equal(setup.manager.phase, 'catalog-ready')
        assert.equal(discarded.plan, null)
      } else if (phase === 'previewing') {
        assert.equal(setup.manager.phase, 'catalog-ready')
        assert.equal(discarded.preview, null)
        assert.equal(setup.runtime.previewStops, 1)
      } else if (phase === 'applied-with-undo') {
        // A recovery point survives discarding a non-existent preview.
        assert.equal(setup.manager.phase, 'applied-with-undo')
        assert.equal(discarded.undoAvailable, true)
      } else {
        assert.equal(setup.manager.phase, settledPhase)
      }
    } finally {
      setup.cleanup()
    }
  }
})

test('inspect is accepted in idle, catalog-ready, planning, and applied-with-undo', async () => {
  const cells: ReadonlyArray<{
    command: Parameters<PluginMarketplaceManager['dispatch']>[0]
    from: MarketplacePhase
  }> = [
    { command: { type: 'inspect', action: 'install', sourceRef: { kind: 'repository', input: 'omdsh-dev/safe-demo' } }, from: 'idle' },
    { command: { type: 'inspect', action: 'install', sourceRef: { kind: 'repository', input: 'omdsh-dev/safe-demo' } }, from: 'catalog-ready' },
    { command: { type: 'inspect', action: 'install', sourceRef: { kind: 'repository', input: 'omdsh-dev/safe-demo' } }, from: 'planning' },
    { command: { type: 'inspect', action: 'disable', pluginId: 'safe-demo' }, from: 'applied-with-undo' },
  ]
  for (const cell of cells) {
    const setup = fixture()
    try {
      await driveTo(setup, cell.from)
      const snapshot = await setup.manager.dispatch(cell.command)
      assert.equal(snapshot.error, null, `inspect @ ${cell.from}: ${JSON.stringify(cell.command)}`)
      assert.equal(setup.manager.phase, 'planning', `inspect @ ${cell.from}`)
      assert.notEqual(snapshot.plan, null)
      assert.equal(snapshot.preview, null)
    } finally {
      setup.cleanup()
    }
  }
})

test('prepare without confirmation requirements is accepted wherever inspection is', async () => {
  for (const from of ['idle', 'catalog-ready', 'applied-with-undo'] as const) {
    const setup = fixture()
    try {
      await driveTo(setup, from)
      // The idle row has no catalog to resolve a pluginId against, so it uses
      // the direct repository sourceRef like any cold-start inspect. The
      // applied-with-undo row manages the plugin it just installed.
      const snapshot = await setup.manager.dispatch({
        type: 'prepare',
        ...(from === 'idle'
          ? { action: 'install', sourceRef: { kind: 'repository', input: 'omdsh-dev/safe-demo' } }
          : from === 'applied-with-undo'
            ? { action: 'disable', pluginId: 'safe-demo' }
            : { action: 'install', pluginId: 'safe-demo' }),
      } as Parameters<PluginMarketplaceManager['dispatch']>[0])
      assert.equal(snapshot.error, null, `prepare @ ${from}`)
      if (from === 'idle') {
        // A direct-repository candidate is untrusted-source risk: the plan
        // carries accept-high-risk, so prepare correctly stops at planning.
        assert.equal(setup.manager.phase, 'planning', `prepare @ ${from}`)
        assert.equal(snapshot.preview, null)
        assert.ok(snapshot.plan?.requirements.includes('accept-high-risk'))
      } else {
        assert.equal(setup.manager.phase, 'previewing', `prepare @ ${from}`)
        assert.equal(snapshot.preview?.pluginId, 'safe-demo')
      }
    } finally {
      setup.cleanup()
    }
  }
})

test('apply runs inside the explicit applying phase and undo inside undoing; concurrent commands hit the busy guard', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'previewing')
    let release: (() => void) | undefined
    setup.runtime.gateLiveStops = new Promise<void>(resolve => { release = resolve })

    const applying = setup.manager.dispatch({ type: 'apply' })
    await new Promise(resolve => { setImmediate(resolve) })
    assert.equal(setup.manager.phase, 'applying')
    await assert.rejects(
      setup.manager.dispatch({ type: 'refresh' }),
      (error: unknown) => error instanceof MarketplaceBusyError
        && error.kind === 'marketplace-busy',
      'concurrent command during applying must be a typed busy rejection',
    )
    release?.()
    const applied = await applying
    assert.equal(applied.error, null)
    assert.equal(applied.busy, false)
    assert.equal(setup.manager.phase, 'applied-with-undo')

    release = undefined
    let undoRelease: (() => void) | undefined
    setup.runtime.gateLiveStops = new Promise<void>(resolve => { undoRelease = resolve })
    const undoing = setup.manager.dispatch({ type: 'undo' })
    await new Promise(resolve => { setImmediate(resolve) })
    assert.equal(setup.manager.phase, 'undoing')
    await assert.rejects(
      setup.manager.dispatch({ type: 'discard' }),
      (error: unknown) => error instanceof MarketplaceBusyError,
      'concurrent command during undoing must be a typed busy rejection',
    )
    undoRelease?.()
    const undone = await undoing
    assert.equal(undone.error, null)
    assert.equal(setup.manager.phase, 'catalog-ready')

    // A quiet host accepts commands again after the busy window closes.
    const refreshed = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(refreshed.error, null)
  } finally {
    setup.cleanup()
  }
})

test('a failed preview keeps the plan and stays in planning', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'planning')
    setup.runtime.startPreview = async (): Promise<void> => {
      throw new Error('preview runtime refused to start')
    }
    const snapshot = await setup.manager.dispatch({ type: 'preview' })
    assert.match(snapshot.error ?? '', /preview runtime refused to start/)
    assert.equal(snapshot.preview, null)
    assert.equal(setup.manager.phase, 'planning')
    assert.notEqual(snapshot.plan, null)
    // The failed candidate tree was cleaned up.
    assert.equal(existsSync(join(setup.appDataPath, 'plugin-marketplace', 'previews')), true)
    assert.deepEqual(readDirNames(join(setup.appDataPath, 'plugin-marketplace', 'previews')), [])
    assert.equal(setup.runtime.previewStops, 1)
  } finally {
    setup.cleanup()
  }
})

test('a rolled-back apply surfaces the error and lands back in previewing with the live profile intact', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'previewing')
    setup.platform.runDsh = async (input: DshCommandInput): Promise<void> => {
      if (input.sandboxed === false) throw new Error('live re-home exploded')
    }
    const snapshot = await setup.manager.dispatch({ type: 'apply' })
    assert.match(snapshot.error ?? '', /failed to apply and was rolled back/)
    // The preview handle survives exactly as before the explicit phase model,
    // so the client can still see what failed to apply.
    assert.equal(setup.manager.phase, 'previewing')
    assert.equal(snapshot.preview?.pluginId, 'safe-demo')
    assert.equal(snapshot.undoAvailable, false)
    const manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dependencies, {})
  } finally {
    setup.cleanup()
  }
})

test('a failed undo keeps the recovery point and lands back in applied-with-undo', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'applied-with-undo')
    setup.runtime.failStartLiveFrom = 2
    const snapshot = await setup.manager.dispatch({ type: 'undo' })
    assert.match(snapshot.error ?? '', /failed to restore the previous plugin profile/)
    assert.equal(setup.manager.phase, 'applied-with-undo')
    assert.equal(snapshot.undoAvailable, true)
    const manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.notEqual(manifest.dependencies['@example/safe-demo'], undefined)
  } finally {
    setup.cleanup()
  }
})

test('undo without a backup on disk clears the recovery point and settles the phase', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'applied-with-undo')
    rmSync(join(setup.appDataPath, 'plugin-marketplace', 'rollbacks'), { recursive: true, force: true })
    const snapshot = await setup.manager.dispatch({ type: 'undo' })
    assert.match(snapshot.error ?? '', /There is no previous plugin profile to restore\./)
    assert.equal(snapshot.undoAvailable, false)
    assert.equal(setup.manager.phase, 'catalog-ready')
  } finally {
    setup.cleanup()
  }
})

test('a rejected inspection settles back to the catalog-ready resting phase', async () => {
  const setup = fixture()
  try {
    await driveTo(setup, 'catalog-ready')
    const snapshot = await setup.manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'missing-plugin',
    })
    assert.match(snapshot.error ?? '', /not present in the loaded catalog/)
    assert.equal(snapshot.plan, null)
    assert.equal(setup.manager.phase, 'catalog-ready')
  } finally {
    setup.cleanup()
  }
})

test('a fresh host resumes in applied-with-undo when a recovery point exists on disk', async () => {
  const first = fixture()
  try {
    await driveTo(first, 'applied-with-undo')
    const resumed = new PluginMarketplaceManager({
      appDataPath: first.appDataPath,
      dshHome: join(first.appDataPath, 'dsh'),
      platform: first.platform,
      profile: 'desktop',
      runtime: first.runtime,
    })
    assert.equal(resumed.phase, 'applied-with-undo')
    assert.equal(resumed.getSnapshot().undoAvailable, true)
  } finally {
    first.cleanup()
  }
})

function readDirNames(path: string): string[] {
  return existsSync(path) ? readdirSync(path) : []
}
