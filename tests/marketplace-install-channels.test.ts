import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import type { BundleBuildInput, DshCommandInput, LoadCatalogOptions, MarketplaceAuthResult, MarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import { PluginMarketplaceManager, type MarketplaceRuntime } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import { validateMarketplaceSourceLock } from '../plugins/plugin-marketplace/src/host/source-lock.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const TARBALL = Buffer.from('verified release artifact')
const TARBALL_DIGEST = createHash('sha256').update(TARBALL).digest('hex')

function catalog(): unknown {
  return {
    _meta: { schema_version: '1.0', generated_at: '2026-08-26T00:00:00.000Z' },
    plugins: [
      { id: 'npm-plugin', name: 'Npm plugin', repo: 'owner/npm-plugin', category: 'tools', description: { en: 'npm', zh: 'npm' }, npm: '@owner/npm-plugin', stars: 2, compat: { status: 'ok' } },
      { id: 'tarball-plugin', name: 'Tarball plugin', repo: 'owner/tarball-plugin', category: 'tools', description: { en: 'tarball', zh: 'tarball' }, releaseAssetUrl: 'https://github.com/owner/tarball-plugin/releases/download/v1.0.0/plugin.tgz', releaseAssetDigest: TARBALL_DIGEST, stars: 1, compat: { status: 'ok' } },
      { id: 'github-plugin', name: 'Github plugin', repo: 'owner/github-plugin', category: 'tools', description: { en: 'github', zh: 'github' }, stars: 1, compat: { status: 'ok' } },
    ],
    watchlist: [],
  }
}

class Runtime implements MarketplaceRuntime {
  async startLive(): Promise<void> {}
  async stopLive(): Promise<void> {}
  async startPreview(): Promise<void> {}
  async stopPreview(): Promise<void> {}
}

class Platform implements MarketplacePlatform {
  readonly added: string[] = []
  artifactDigest = TARBALL_DIGEST
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> {}
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> { return catalog() }
  async resolveCommit(_repository: string): Promise<string> { return COMMIT }
  async readRepositoryFile(repository: string, path: string): Promise<string | null> {
    const id = repository.split('/').at(-1) ?? repository
    if (path === 'package.json') return JSON.stringify({
      name: `@owner/${id}`,
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
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: '@owner/plugin', version: '1.0.0' }))
  }
  async downloadArtifact(input: { target: string; url: string }): Promise<{ digest: string; target: string }> {
    mkdirSync(dirname(input.target), { recursive: true })
    writeFileSync(input.target, TARBALL)
    return { digest: this.artifactDigest, target: input.target }
  }
  async runDsh(input: DshCommandInput): Promise<void> {
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) {
      const target = input.args.at(-1) as string
      this.added.push(target)
      const packageName = target.startsWith('@owner/npm-plugin')
        ? '@owner/npm-plugin'
        : target.includes('tarball-plugin') ? '@owner/tarball-plugin' : target.includes('github-plugin') ? '@owner/github-plugin' : '@owner/plugin'
      manifest.dependencies[packageName] = target.startsWith('@') ? target : `link:${target}`
      if (!manifest.dsh.profile.bundles.includes(packageName)) manifest.dsh.profile.bundles.push(packageName)
    }
    writeFileSync(profile, JSON.stringify(manifest) + '\n')
  }
}

function fixture(): { manager: PluginMarketplaceManager; platform: Platform; root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-channel-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new Platform()
  const manager = new PluginMarketplaceManager({ appDataPath: root, dshHome, platform, profile: 'desktop', runtime: new Runtime() })
  return { manager, platform, root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function install(setup: ReturnType<typeof fixture>, pluginId: string): Promise<ReturnType<PluginMarketplaceManager['getSnapshot']>> {
  assert.equal((await setup.manager.dispatch({ type: 'refresh' })).error, null)
  const result = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId })
  assert.equal(result.error, null)
  return result
}

test('catalog entries select exact npm and tarball channels before staging', async () => {
  const setup = fixture()
  try {
    const npm = await install(setup, 'npm-plugin')
    assert.equal(npm.plan, null)
    assert.ok(setup.platform.added.some(target => target === '@owner/npm-plugin@1.0.0'))
    const planSnapshot = await setup.manager.dispatch({ type: 'plan', action: 'install', pluginId: 'tarball-plugin' })
    assert.equal(planSnapshot.plan?.channel, 'tarball')
    const tarball = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'tarball-plugin' })
    assert.equal(tarball.error, null)
    assert.ok(setup.platform.added.some(target => target.endsWith('.tgz')))
    assert.equal(tarball.sourceLocks.find(lock => lock.pluginId === 'tarball-plugin')?.channel, 'tarball')
    assert.equal(tarball.sourceLocks.find(lock => lock.pluginId === 'tarball-plugin')?.artifactDigest, TARBALL_DIGEST)
    assert.equal(tarball.sourceLocks.find(lock => lock.pluginId === 'npm-plugin')?.channel, 'npm')
  } finally {
    setup.cleanup()
  }
})

test('tarball digest mismatch fails closed before a profile swap', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    setup.platform.artifactDigest = 'f'.repeat(64)
    const result = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'tarball-plugin' })
    assert.match(result.error ?? '', /digest mismatch/)
    assert.equal(result.undoAvailable, false)
    assert.equal(result.catalog.find(plugin => plugin.id === 'tarball-plugin')?.installed, false)
  } finally {
    setup.cleanup()
  }
})

test('source locks validate channel-specific exact specs and reject floating inputs', () => {
  const common = {
    artifactDigest: 'a'.repeat(64), canonicalSource: 'github:owner/plugin', catalogSourceId: 'builtin', firstSeenCommit: COMMIT,
    manifestHash: 'b'.repeat(64), manifestPath: 'package.json', mechanism: 'bundle' as const, packageName: '@owner/plugin', patchHash: null,
    pluginId: 'plugin', recordedAt: '2026-08-26T00:00:00.000Z', requestedRef: null, resolvedCommit: COMMIT, subpath: null,
  }
  assert.equal(validateMarketplaceSourceLock({ ...common, channel: 'github', version: '1.0.0', artifactUrl: null, installSpec: `github:owner/plugin#${COMMIT}` }), true)
  assert.equal(validateMarketplaceSourceLock({ ...common, channel: 'npm', version: '1.0.0', artifactUrl: null, installSpec: 'npm:@owner/plugin@1.0.0' }), true)
  assert.equal(validateMarketplaceSourceLock({ ...common, channel: 'npm', version: 'latest', artifactUrl: null, installSpec: 'npm:@owner/plugin@latest' }), false)
  assert.equal(validateMarketplaceSourceLock({ ...common, channel: 'tarball', version: '1.0.0', artifactUrl: 'https://github.com/owner/plugin/releases/download/v1.0.0/plugin.tgz', installSpec: `tarball:https://github.com/owner/plugin/releases/download/v1.0.0/plugin.tgz#${'c'.repeat(64)}` }), true)
})
