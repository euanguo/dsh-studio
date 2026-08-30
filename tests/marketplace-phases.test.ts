import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { BundleBuildInput, DshCommandInput, LoadCatalogOptions, MarketplaceAuthResult, MarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import { PluginMarketplaceManager, type MarketplaceRuntime } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

class Runtime implements MarketplaceRuntime {
  previewStarts = 0
  previewStops = 0
  liveStarts = 0
  async startLive(): Promise<void> { this.liveStarts += 1 }
  async stopLive(): Promise<void> {}
  async startPreview(): Promise<void> { this.previewStarts += 1 }
  async stopPreview(): Promise<void> { this.previewStops += 1 }
}

class Platform implements MarketplacePlatform {
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> {}
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> {
    return {
      _meta: { schema_version: '1.0', generated_at: '2026-08-26T00:00:00.000Z' },
      plugins: [{ id: 'phase-plugin', name: 'Phase plugin', repo: 'owner/phase-plugin', category: 'tools', description: { en: 'phase', zh: '阶段' }, stars: 1, compat: { status: 'ok' } }],
      watchlist: [],
    }
  }
  async resolveCommit(): Promise<string> { return COMMIT }
  async readRepositoryFile(_repository: string, path: string): Promise<string | null> {
    if (path === 'package.json') return JSON.stringify({ name: '@example/phase-plugin', version: '1.0.0', license: 'MIT', description: 'phase', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: phase\n      name: ./index.js\n'
    if (path === 'index.js') return 'export default {}\n'
    return null
  }
  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export default {}\n')
    writeFileSync(join(target, 'cordis.patch.yml'), '- insert:\n    - id: phase\n      name: ./index.js\n')
  }
  async runDsh(input: DshCommandInput): Promise<void> {
    const path = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) {
      manifest.dependencies['@example/phase-plugin'] = `link:${input.args.at(-1) as string}`
      manifest.dsh.profile.bundles.push('@example/phase-plugin')
    }
    if (input.args.includes('remove')) {
      delete manifest.dependencies['@example/phase-plugin']
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(entry => entry !== '@example/phase-plugin')
    }
    writeFileSync(path, JSON.stringify(manifest) + '\n')
  }
}

function fixture(): { manager: PluginMarketplaceManager; runtime: Runtime; root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-phases-clean-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const runtime = new Runtime()
  const manager = new PluginMarketplaceManager({ appDataPath: root, dshHome, platform: new Platform(), profile: 'desktop', runtime })
  return { manager, runtime, root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function refresh(manager: PluginMarketplaceManager): Promise<void> {
  assert.equal((await manager.dispatch({ type: 'refresh' })).error, null)
}

test('plan stays read-only and direct execute skips isolated preview', async () => {
  const setup = fixture()
  try {
    await refresh(setup.manager)
    const plan = await setup.manager.dispatch({ type: 'plan', action: 'install', pluginId: 'phase-plugin' })
    assert.equal(setup.manager.phase, 'planning')
    assert.equal(plan.catalog[0]?.installed, false)
    assert.equal(plan.plan?.fastPathEligible, true)
    const direct = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'phase-plugin', confirmations: [] })
    assert.equal(direct.error, null)
    assert.equal(setup.manager.phase, 'applied-with-undo')
    assert.equal(setup.runtime.previewStarts, 0)
    assert.equal(direct.undoAvailable, true)
  } finally {
    setup.cleanup()
  }
})

test('preview is explicit and apply accepts only the staged preview', async () => {
  const setup = fixture()
  try {
    await refresh(setup.manager)
    const preview = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'preview', pluginId: 'phase-plugin', confirmations: [] })
    assert.equal(preview.error, null)
    assert.equal(setup.manager.phase, 'previewing')
    assert.equal(setup.runtime.previewStarts, 1)
    const applied = await setup.manager.dispatch({ type: 'apply' })
    assert.equal(applied.error, null)
    assert.equal(setup.manager.phase, 'applied-with-undo')
    assert.equal(setup.runtime.previewStops, 1)
  } finally {
    setup.cleanup()
  }
})

test('apply and undo guards reject operations without the matching staged state', async () => {
  const setup = fixture()
  try {
    await refresh(setup.manager)
    const noApply = await setup.manager.dispatch({ type: 'apply' })
    assert.match(noApply.error ?? '', /no active staged operation/)
    const noUndo = await setup.manager.dispatch({ type: 'undo' })
    assert.match(noUndo.error ?? '', /no previous plugin profile/)
  } finally {
    setup.cleanup()
  }
})
