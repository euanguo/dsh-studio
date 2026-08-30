import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseMarketplaceCatalog } from '../plugins/plugin-marketplace/src/catalog.ts'
import { findGitHubCli, previewSandboxPolicy, previewScriptCommand, withGitHubCredentials } from '../plugins/plugin-marketplace/src/host/platform.ts'
import type { BundleBuildInput, DshCommandInput, LoadCatalogOptions, MarketplaceAuthResult, MarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import { PluginMarketplaceManager, type MarketplaceRuntime } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

function baseCatalog(): Record<string, unknown> { return { _meta: { schema_version: '1.0', generated_at: '2026-08-26T00:00:00.000Z' }, plugins: [{ id: 'test-plugin', name: 'Test', repo: 'owner/test-plugin', category: 'tools', description: { en: 'test', zh: '测试' }, stars: 4, compat: { status: 'ok' } }], watchlist: [] } }

class Runtime implements MarketplaceRuntime {
  async startLive(): Promise<void> {}
  async stopLive(): Promise<void> {}
  async startPreview(): Promise<void> {}
  async stopPreview(): Promise<void> {}
}

class Platform implements MarketplacePlatform {
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> {}
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> { return baseCatalog() }
  async resolveCommit(): Promise<string> { return COMMIT }
  async readRepositoryFile(_repository: string, path: string): Promise<string | null> {
    if (path === 'package.json') return JSON.stringify({ name: '@example/test-plugin', version: '1.0.0', license: 'MIT', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: test\n      name: ./index.js\n'
    if (path === 'index.js') return 'export default {}\n'
    return null
  }
  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> { mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'index.js'), 'export default {}\n'); writeFileSync(join(target, 'cordis.patch.yml'), '- insert:\n    - id: test\n      name: ./index.js\n') }
  async runDsh(input: DshCommandInput): Promise<void> {
    const path = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) { manifest.dependencies['@example/test-plugin'] = `link:${input.args.at(-1) as string}`; manifest.dsh.profile.bundles.push('@example/test-plugin') }
    if (input.args.includes('remove')) { delete manifest.dependencies['@example/test-plugin']; manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(entry => entry !== '@example/test-plugin') }
    writeFileSync(path, JSON.stringify(manifest) + '\n')
  }
}

function manager(): { manager: PluginMarketplaceManager; root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-plugin-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', dependencies: {}, dsh: { profile: { bundles: [] } } }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  return { manager: new PluginMarketplaceManager({ appDataPath: root, dshHome, platform: new Platform(), profile: 'desktop', runtime: new Runtime() }), root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('canonical catalog rejects legacy formats and preserves watchlist metadata', () => {
  const parsed = parseMarketplaceCatalog({ ...baseCatalog(), watchlist: [{ id: 'watch', name: 'Watch', repo: 'owner/watch', description: { en: 'watch', zh: '观察' }, watchReason: '蹭tag' }] })
  assert.equal(parsed.plugins[0]?.stars, 4)
  assert.equal(parsed.watchlist[0]?.watchReason, '蹭tag')
  assert.throws(() => parseMarketplaceCatalog({ schema: 'dsh-external-hub/v0.1', repos: [] }), /schema_version 1\.0/)
})

test('platform helpers keep GitHub credentials scoped and scripted preview fail-closed', () => {
  assert.equal(findGitHubCli({ PATH: '/tmp/bin' }, 'darwin', path => path.endsWith('/gh')), '/tmp/bin/gh')
  const env = withGitHubCredentials({ PATH: '/bin', DSH_STUDIO_DESKTOP_APP_DATA: '/tmp/dsh-test' }, null)
  assert.equal(env.GIT_CONFIG_GLOBAL, undefined)
  assert.ok(previewSandboxPolicy('/tmp/preview').includes('subpath "/tmp/preview"'))
  assert.throws(
    () => previewScriptCommand({ platform: 'linux', nodeBinary: 'node', nodeArguments: [], root: '/tmp/preview', pathExists: () => false }),
    /unavailable on linux/,
  )
})

test('manager snapshot is healthy after canonical refresh and direct execution', async () => {
  const setup = manager()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    const result = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'test-plugin', confirmations: [] })
    assert.equal(result.error, null)
    assert.equal(result.catalog[0]?.installed, true)
    assert.equal(result.progress, null)
    assert.equal(result.lifecycle.current.state, 'live')
  } finally { setup.cleanup() }
})
