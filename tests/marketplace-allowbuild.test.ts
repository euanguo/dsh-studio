import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { BundleBuildInput, DshCommandInput, LoadCatalogOptions, MarketplaceAuthResult, MarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import { regenerateManagedAllowBuilds } from '../plugins/plugin-marketplace/src/host/allowbuild-yaml.ts'
import { PluginMarketplaceManager, type MarketplaceRuntime } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

const BEGIN = '# >>> DSH Studio allowed plugin builds'
const END = '# <<< DSH Studio allowed plugin builds'
const COMMIT = '0123456789abcdef0123456789abcdef01234567'

test('managed build allowance is deterministic, sorted and non-destructive', () => {
  const original = '# operator comment\npackages:\n  - .\n\nminimumReleaseAge: 1440\n'
  const first = regenerateManagedAllowBuilds(original, '@example/z')
  const second = regenerateManagedAllowBuilds(first, '@example/a')
  assert.equal(regenerateManagedAllowBuilds(second, '@example/z'), second)
  assert.match(second, new RegExp(`${BEGIN}[\\s\\S]+${END}`))
  assert.match(second, /'@example\/a': true/)
  assert.match(second, /'@example\/z': true/)
  assert.match(second, /# operator comment/)
  assert.match(second, /minimumReleaseAge: 1440/)
  assert.throws(() => regenerateManagedAllowBuilds('allowBuilds:\n  rogue: true\n', '@example/x'), /outside the managed/)
})

class Runtime implements MarketplaceRuntime {
  previewStarts = 0
  liveStarts = 0
  async startLive(): Promise<void> { this.liveStarts += 1 }
  async stopLive(): Promise<void> {}
  async startPreview(): Promise<void> { this.previewStarts += 1 }
  async stopPreview(): Promise<void> {}
}

class Platform implements MarketplacePlatform {
  builds = 0
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> { this.builds += 1 }
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> {
    return { _meta: { schema_version: '1.0' }, plugins: [{ id: 'script-plugin', name: 'Script plugin', repo: 'owner/script-plugin', category: 'tools', description: { en: 'script', zh: '脚本' }, compat: { status: 'ok' } }], watchlist: [] }
  }
  async resolveCommit(): Promise<string> { return COMMIT }
  async readRepositoryFile(_repository: string, path: string): Promise<string | null> {
    if (path === 'package.json') return JSON.stringify({ name: '@example/script-plugin', version: '1.0.0', license: 'MIT', main: './dist/index.js', scripts: { prepare: 'pnpm build' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: script\n      name: ./dist/index.js\n'
    if (path === 'dist/index.js') return 'export default {}\n'
    return null
  }
  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(join(target, 'dist'), { recursive: true })
    writeFileSync(join(target, 'dist/index.js'), 'export default {}\n')
    writeFileSync(join(target, 'cordis.patch.yml'), '- insert:\n    - id: script\n      name: ./dist/index.js\n')
  }
  async runDsh(input: DshCommandInput): Promise<void> {
    const path = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) {
      manifest.dependencies['@example/script-plugin'] = `link:${input.args.at(-1) as string}`
      if (!manifest.dsh.profile.bundles.includes('@example/script-plugin')) manifest.dsh.profile.bundles.push('@example/script-plugin')
    }
    writeFileSync(path, JSON.stringify(manifest) + '\n')
  }
}

function fixture(): { manager: PluginMarketplaceManager; platform: Platform; runtime: Runtime; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-allow-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', dependencies: {}, dsh: { profile: { bundles: [] } } }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new Platform()
  const runtime = new Runtime()
  const manager = new PluginMarketplaceManager({ appDataPath: root, dshHome, platform, profile: 'desktop', runtime })
  return { manager, platform, runtime, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('build scripts remain confirmation-gated while direct mode skips only preview', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    const planned = await setup.manager.dispatch({ type: 'plan', action: 'install', pluginId: 'script-plugin' })
    assert.deepEqual(planned.plan?.requirements, ['allow-build-scripts'])
    const denied = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'script-plugin', confirmations: [] })
    assert.match(denied.error ?? '', /confirmation required/)
    const applied = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'script-plugin', confirmations: ['allow-build-scripts'] })
    assert.equal(applied.error, null)
    assert.equal(setup.platform.builds, 1)
    assert.equal(setup.runtime.previewStarts, 0)
    assert.equal(applied.undoAvailable, true)
  } finally {
    setup.cleanup()
  }
})
