import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { BundleBuildInput, DshCommandInput, LoadCatalogOptions, MarketplaceAuthResult, MarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import { PluginMarketplaceManager, type MarketplaceRuntime } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

class Runtime implements MarketplaceRuntime {
  failNextStart = false
  async startLive(): Promise<void> { if (this.failNextStart) { this.failNextStart = false; throw new Error('simulated live-start failure') } }
  async stopLive(): Promise<void> {}
  async startPreview(): Promise<void> {}
  async stopPreview(): Promise<void> {}
}

class Platform implements MarketplacePlatform {
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> {}
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> { return { _meta: { schema_version: '1.0' }, plugins: [{ id: 'reconcile-plugin', name: 'Reconcile', repo: 'owner/reconcile-plugin', category: 'tools', description: { en: 'reconcile', zh: '恢复' }, compat: { status: 'ok' } }], watchlist: [] } }
  async resolveCommit(): Promise<string> { return COMMIT }
  async readRepositoryFile(_repository: string, path: string): Promise<string | null> {
    if (path === 'package.json') return JSON.stringify({ name: '@example/reconcile-plugin', version: '1.0.0', license: 'MIT', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: reconcile\n      name: ./index.js\n'
    if (path === 'index.js') return 'export default {}\n'
    return null
  }
  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> { mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'index.js'), 'export default {}\n'); writeFileSync(join(target, 'cordis.patch.yml'), '- insert:\n    - id: reconcile\n      name: ./index.js\n') }
  async runDsh(input: DshCommandInput): Promise<void> {
    const path = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) { manifest.dependencies['@example/reconcile-plugin'] = `link:${input.args.at(-1) as string}`; if (!manifest.dsh.profile.bundles.includes('@example/reconcile-plugin')) manifest.dsh.profile.bundles.push('@example/reconcile-plugin') }
    writeFileSync(path, JSON.stringify(manifest) + '\n')
  }
}

function fixture(): { manager: PluginMarketplaceManager; runtime: Runtime; profile: string; root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-reconcile-clean-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', dependencies: {}, dsh: { profile: { bundles: [] } } }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const runtime = new Runtime()
  const manager = new PluginMarketplaceManager({ appDataPath: root, dshHome, platform: new Platform(), profile: 'desktop', runtime })
  return { manager, runtime, profile, root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('failed direct apply restores the live profile and retains an error', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    setup.runtime.failNextStart = true
    const result = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'reconcile-plugin', confirmations: [] })
    assert.match(result.error ?? '', /failed to apply and was rolled back/)
    const manifest = JSON.parse(readFileSync(join(setup.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    assert.deepEqual(manifest.dependencies, {})
    assert.equal(result.undoAvailable, false)
  } finally { setup.cleanup() }
})

test('successful direct apply leaves a durable undo point', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    const applied = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'reconcile-plugin', confirmations: [] })
    assert.equal(applied.error, null)
    assert.equal(applied.undoAvailable, true)
    const restored = await setup.manager.dispatch({ type: 'undo' })
    assert.equal(restored.error, null)
    assert.equal(restored.undoAvailable, false)
    assert.equal(existsSync(join(setup.profile, 'package.json')), true)
  } finally { setup.cleanup() }
})
