import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { BundleBuildInput, DshCommandInput, LoadCatalogOptions, MarketplaceAuthResult, MarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import { PluginMarketplaceManager, type MarketplaceRuntime } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

const COMMITS = new Map([
  ['owner/one', '0123456789abcdef0123456789abcdef01234567'],
  ['owner/two', 'fedcba9876543210fedcba9876543210fedcba98'],
])

function catalog(): unknown {
  return {
    _meta: { schema_version: '1.0', generated_at: '2026-08-26T00:00:00.000Z' },
    plugins: [
      { id: 'one', name: 'One', repo: 'owner/one', category: 'tools', description: { en: 'one', zh: '一' }, stars: 5, compat: { status: 'ok' }, isOfficialBeta: true },
      { id: 'two', name: 'Two', repo: 'owner/two', category: 'tools', description: { en: 'two', zh: '二' }, stars: 4, compat: { status: 'ok' }, isOfficialBeta: true },
    ],
    watchlist: [],
  }
}

class Runtime implements MarketplaceRuntime {
  starts = 0
  stops = 0
  async startLive(): Promise<void> { this.starts += 1 }
  async stopLive(): Promise<void> { this.stops += 1 }
  async startPreview(): Promise<void> {}
  async stopPreview(): Promise<void> {}
}

class Platform implements MarketplacePlatform {
  added: string[] = []
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> {}
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> { return catalog() }
  async resolveCommit(repository: string): Promise<string> { return COMMITS.get(repository) ?? [...COMMITS.values()][0]! }
  async readRepositoryFile(repository: string, path: string): Promise<string | null> {
    const id = repository.split('/').at(-1) ?? repository
    if (path === 'package.json') return JSON.stringify({ name: `@example/${id}`, version: '1.0.0', license: 'MIT', description: id, main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: row\n      name: ./index.js\n'
    if (path === 'index.js') return 'export default {}\n'
    return null
  }
  async cloneRepository(repository: string, _commit: string, target: string): Promise<void> {
    const id = repository.split('/').at(-1) ?? repository
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export default {}\n')
    writeFileSync(join(target, 'cordis.patch.yml'), '- insert:\n    - id: row\n      name: ./index.js\n')
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: `@example/${id}`, version: '1.0.0' }))
  }
  async runDsh(input: DshCommandInput): Promise<void> {
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) {
      const target = input.args.at(-1) as string
      this.added.push(target)
      const id = target.includes('two') ? 'two' : 'one'
      const packageName = `@example/${id}`
      manifest.dependencies[packageName] = `link:${target}`
      if (!manifest.dsh.profile.bundles.includes(packageName)) manifest.dsh.profile.bundles.push(packageName)
    }
    writeFileSync(profile, JSON.stringify(manifest) + '\n')
  }
}

function fixture(): { manager: PluginMarketplaceManager; platform: Platform; runtime: Runtime; root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-pack-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new Platform()
  const runtime = new Runtime()
  const manager = new PluginMarketplaceManager({ appDataPath: root, dshHome, platform, profile: 'desktop', runtime })
  return { manager, platform, runtime, root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('pack preview metadata identifies the pack and every member action', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    const preview = await setup.manager.dispatch({ type: 'pack', packId: 'recommended', mode: 'preview', confirmations: [] })
    assert.equal(preview.error, null)
    assert.equal(preview.preview?.action, 'pack')
    assert.equal(preview.preview?.packId, 'recommended')
    assert.deepEqual(preview.preview?.actions, ['install', 'install'])
    assert.equal((await setup.manager.dispatch({ type: 'discard' })).error, null)
  } finally {
    setup.cleanup()
  }
})

test('recommended pack installs all members with one live restart and one undo point', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    const before = setup.runtime.starts
    const result = await setup.manager.dispatch({ type: 'pack', packId: 'recommended', mode: 'direct', confirmations: [] })
    assert.equal(result.error, null)
    assert.equal(result.catalog.filter(plugin => plugin.installed).length, 2)
    assert.equal(result.undoAvailable, true)
    assert.equal(setup.runtime.starts - before, 1)
    assert.equal(setup.platform.added.length, 2)
    const restored = await setup.manager.dispatch({ type: 'undo' })
    assert.equal(restored.error, null)
    assert.equal(restored.catalog.filter(plugin => plugin.installed).length, 0)
  } finally {
    setup.cleanup()
  }
})
