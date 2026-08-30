import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { BundleBuildInput, DshCommandInput, LoadCatalogOptions, MarketplaceAuthResult, MarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import { PluginMarketplaceManager, type MarketplaceRuntime } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

function catalog(): unknown {
  return {
    _meta: { schema_version: '1.0', generated_at: '2026-08-26T00:00:00.000Z' },
    plugins: [
      { id: 'safe-plugin', name: 'Safe plugin', repo: 'owner/safe-plugin', category: 'tools', description: { en: 'safe', zh: '安全' }, stars: 20, compat: { status: 'ok' }, tags: [] },
      { id: 'second-plugin', name: 'Second plugin', repo: 'owner/second-plugin', category: 'tools', description: { en: 'second', zh: '第二个' }, stars: 10, compat: { status: 'ok' }, tags: [] },
    ],
    watchlist: [],
  }
}

class Runtime implements MarketplaceRuntime {
  previewStarts = 0
  previewStops = 0
  liveStarts = 0
  liveStops = 0
  async startLive(): Promise<void> { this.liveStarts += 1 }
  async stopLive(): Promise<void> { this.liveStops += 1 }
  async startPreview(): Promise<void> { this.previewStarts += 1 }
  async stopPreview(): Promise<void> { this.previewStops += 1 }
}

class Platform implements MarketplacePlatform {
  commit = COMMIT
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> {}
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> { return catalog() }
  async resolveCommit(_repository: string): Promise<string> { return this.commit }
  async readRepositoryFile(repository: string, path: string): Promise<string | null> {
    const id = repository.split('/').at(-1) ?? repository
    if (path === 'package.json') return JSON.stringify({
      name: `@example/${id}`,
      version: '1.0.0',
      license: 'MIT',
      description: id,
      main: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: row\n      name: ./index.js\n'
    if (path === 'index.js') return 'export default {}\n'
    return null
  }
  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export default {}\n')
    writeFileSync(join(target, 'cordis.patch.yml'), '- insert:\n    - id: row\n      name: ./index.js\n')
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: '@example/fixture', version: '1.0.0' }))
  }
  async runDsh(input: DshCommandInput): Promise<void> {
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) {
      const target = input.args.at(-1) as string
      const packageName = target.includes('second-plugin') ? '@example/second-plugin' : '@example/safe-plugin'
      manifest.dependencies[packageName] = `link:${target}`
      if (!manifest.dsh.profile.bundles.includes(packageName)) manifest.dsh.profile.bundles.push(packageName)
    } else if (input.args.includes('remove')) {
      const packageName = input.args.at(-1) as string
      delete manifest.dependencies[packageName]
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(entry => entry !== packageName)
    }
    writeFileSync(profile, JSON.stringify(manifest) + '\n')
  }
}

function fixture(): { manager: PluginMarketplaceManager; platform: Platform; runtime: Runtime; root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-fast-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new Platform()
  const runtime = new Runtime()
  const manager = new PluginMarketplaceManager({ appDataPath: root, dshHome, platform, profile: 'desktop', runtime })
  return { manager, platform, runtime, root, cleanup: () => { rmSync(root, { recursive: true, force: true }) } }
}

async function refresh(manager: PluginMarketplaceManager): Promise<void> {
  const result = await manager.dispatch({ type: 'refresh' })
  assert.equal(result.error, null)
}

test('direct execution stages and applies without starting preview, then undo restores the prior profile', async () => {
  const setup = fixture()
  try {
    await refresh(setup.manager)
    const planned = await setup.manager.dispatch({ type: 'plan', action: 'install', pluginId: 'safe-plugin' })
    assert.equal(planned.plan?.fastPathEligible, true)
    assert.equal(planned.plan?.previewAvailable, true)
    const applied = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'safe-plugin' })
    assert.equal(applied.error, null)
    assert.equal(applied.preview, null)
    assert.equal(applied.undoAvailable, true)
    assert.equal(applied.catalog.find(plugin => plugin.id === 'safe-plugin')?.installed, true)
    assert.equal(setup.runtime.previewStarts, 0)
    assert.equal(setup.runtime.liveStarts, 1)
    const restored = await setup.manager.dispatch({ type: 'undo' })
    assert.equal(restored.error, null)
    assert.equal(restored.catalog.find(plugin => plugin.id === 'safe-plugin')?.installed, false)
  } finally {
    setup.cleanup()
  }
})

test('preview execution remains explicit and apply accepts the staged preview', async () => {
  const setup = fixture()
  try {
    await refresh(setup.manager)
    const preview = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'preview', pluginId: 'safe-plugin' })
    assert.equal(preview.error, null)
    assert.equal(setup.manager.phase, 'previewing')
    assert.equal(setup.runtime.previewStarts, 1)
    assert.equal(preview.preview?.pluginId, 'safe-plugin')
    const applied = await setup.manager.dispatch({ type: 'apply' })
    assert.equal(applied.error, null)
    assert.equal(setup.runtime.previewStops, 1)
    assert.equal(applied.undoAvailable, true)
  } finally {
    setup.cleanup()
  }
})

test('a candidate cannot be applied before it has been staged', async () => {
  const setup = fixture()
  try {
    await refresh(setup.manager)
    const result = await setup.manager.dispatch({ type: 'apply' })
    assert.match(result.error ?? '', /no active staged operation/)
  } finally {
    setup.cleanup()
  }
})
