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
    plugins: [{ id: 'input-plugin', name: 'Input plugin', repo: 'owner/input-plugin', category: 'tools', description: { en: 'input', zh: '输入' }, stars: 1, compat: { status: 'ok' }, tags: [] }],
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
  readonly events: string[] = []
  includeInput = false
  readonly environments: Array<Record<string, string> | undefined> = []
  delayClone = false
  resolveClone: (() => void) | null = null
  async authStatus(): Promise<MarketplaceAuthResult> { return { detail: 'ready', status: 'ready' } }
  async buildBundle(_input: BundleBuildInput): Promise<void> {}
  async loadCatalog(_options?: LoadCatalogOptions): Promise<unknown> { return catalog() }
  async resolveCommit(_repository: string): Promise<string> { return COMMIT }
  async readRepositoryFile(_repository: string, path: string): Promise<string | null> {
    if (path === 'package.json') return JSON.stringify({ name: '@example/input-plugin', version: '1.0.0', license: 'MIT', description: 'input', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: input\n      name: ./index.js\n'
    if (path === 'index.js') return 'export default {}\n'
    if (path === 'README.md' && this.includeInput) return 'Configure OPENAI_API_KEY before starting.'
    return null
  }
  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    if (this.delayClone) await new Promise<void>(resolve => { this.resolveClone = resolve })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export default {}\n')
    writeFileSync(join(target, 'cordis.patch.yml'), '- insert:\n    - id: input\n      name: ./index.js\n')
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: '@example/input-plugin', version: '1.0.0' }))
  }
  async runDsh(input: DshCommandInput): Promise<void> {
    this.environments.push(input.environment)
    this.events.push(input.args.join(' '))
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    if (input.args.includes('add')) {
      const target = input.args.at(-1) as string
      const packageName = '@example/input-plugin'
      manifest.dependencies[packageName] = target.startsWith('@') ? target : `link:${target}`
      if (!manifest.dsh.profile.bundles.includes(packageName)) manifest.dsh.profile.bundles.push(packageName)
    }
    writeFileSync(profile, JSON.stringify(manifest) + '\n')
  }
}

function fixture(): { manager: PluginMarketplaceManager; platform: Platform; root: string; changes: number; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-progress-'))
  const dshHome = join(root, 'dsh')
  const profile = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }) + '\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new Platform()
  let changes = 0
  const manager = new PluginMarketplaceManager({ appDataPath: root, dshHome, onStateChange: () => { changes += 1 }, platform, profile: 'desktop', runtime: new Runtime() })
  return { manager, platform, root, get changes() { return changes }, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('material requirements pause execution and provide resumes without exposing values', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    setup.platform.includeInput = true
    const planned = await setup.manager.dispatch({ type: 'plan', action: 'install', pluginId: 'input-plugin' })
    assert.deepEqual(planned.plan?.environmentRequirements.map(requirement => requirement.name), ['OPENAI_API_KEY'])
    const waiting = await setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'input-plugin' })
    assert.equal(waiting.inputRequest?.requirements[0]?.name, 'OPENAI_API_KEY')
    const transactionId = waiting.inputRequest?.transactionId
    assert.ok(transactionId)
    const completed = await setup.manager.dispatch({ type: 'provide', transactionId, answers: { OPENAI_API_KEY: 'secret-value' } })
    assert.equal(completed.error, null)
    assert.equal(completed.inputRequest, null)
    assert.equal(completed.catalog[0]?.installed, true)
    assert.ok(setup.platform.environments.some(environment => environment?.OPENAI_API_KEY === 'secret-value'))
    assert.equal(JSON.stringify(completed).includes('secret-value'), false)
  } finally {
    setup.cleanup()
  }
})

test('progress pushes include stage information and cancellation leaves live profile unchanged', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    setup.platform.includeInput = false
    setup.platform.delayClone = true
    const executing = setup.manager.dispatch({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'input-plugin' })
    await new Promise<void>(resolve => setImmediate(resolve))
    const current = setup.manager.getSnapshot()
    const transactionId = current.progress?.transactionId
    assert.ok(transactionId)
    assert.equal(current.progress?.stage, 'install')
    const cancelled = await setup.manager.dispatch({ type: 'cancel', transactionId })
    assert.equal(cancelled.catalog[0]?.installed, false)
    setup.platform.resolveClone?.()
    const result = await executing
    assert.equal(result.catalog[0]?.installed, false)
    assert.equal(setup.changes > 0, true)
    assert.equal(setup.platform.events.some(event => event.includes('add')), false)
  } finally {
    setup.platform.resolveClone?.()
    setup.cleanup()
  }
})
