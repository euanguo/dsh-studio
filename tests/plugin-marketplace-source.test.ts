import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMarketplaceCatalog } from '../plugins/plugin-marketplace/src/catalog.ts'
import { parseMarketplaceCommand } from '../plugins/plugin-marketplace/src/protocol.ts'
import { DefaultMarketplaceSourceResolver, MarketplaceSourceError, canonicalizeRepositorySource, normalizedInstallSpec } from '../plugins/plugin-marketplace/src/host/source-resolver.ts'
import { resolveInstallCandidate } from '../plugins/plugin-marketplace/src/host/state-file.ts'
import { FIXTURE_COMMIT, PINNED_DSH_VERSION, type RepositorySourceAdapter } from '../plugins/plugin-marketplace/src/host/source-types.ts'
import { sourceLockFromCandidate, validateMarketplaceSourceLock } from '../plugins/plugin-marketplace/src/host/source-lock.ts'
import type { MarketplaceCandidate } from '../plugins/plugin-marketplace/src/host/source-types.ts'

const REPOSITORY = 'owner/plugin'
const MANIFEST = JSON.stringify({ name: '@owner/plugin', version: '1.0.0', license: 'MIT', description: 'fixture', main: './dist/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } }, peerDependencies: { '@deepseek-ai/dsh': '>=0.1.0-rc.5 <0.1.0' } })
const PATCH = '- insert:\n    - id: plugin\n      name: ./dist/index.js\n'

class Adapter implements RepositorySourceAdapter {
  async resolveCommit(): Promise<string> { return FIXTURE_COMMIT }
  async readFile(_repository: string, path: string): Promise<string | null> {
    if (path === 'package.json') return MANIFEST
    if (path === 'cordis.patch.yml') return PATCH
    if (path === 'dist/index.js') return 'export default {}\n'
    return null
  }
}

test('repository sources normalize to exact commit-pinned GitHub specs', () => {
  assert.deepEqual(canonicalizeRepositorySource({ kind: 'repository', input: 'github:owner/plugin#feature/test', requestedRef: null, subpath: null }), {
    locator: 'https://github.com/owner/plugin', repository: REPOSITORY, requestedRef: 'feature/test', subpath: null,
  })
  assert.equal(normalizedInstallSpec(REPOSITORY, FIXTURE_COMMIT), `github:${REPOSITORY}#${FIXTURE_COMMIT}`)
  assert.throws(() => canonicalizeRepositorySource({ kind: 'repository', input: 'owner/plugin;rm -rf', requestedRef: null, subpath: null }), MarketplaceSourceError)
})

test('resolver validates manifest, patch, entry and peer compatibility', async () => {
  const resolver = new DefaultMarketplaceSourceResolver({ dshVersion: PINNED_DSH_VERSION, repository: new Adapter() })
  const candidate = await resolver.resolveRepository({ kind: 'repository', input: REPOSITORY, catalogSourceId: 'builtin', requestedRef: null, subpath: null })
  assert.equal(candidate.execution, 'installable')
  assert.equal(candidate.mechanism, 'bundle')
  assert.equal(candidate.source.resolvedCommit, FIXTURE_COMMIT)
  assert.equal(candidate.source.installSpec, `github:${REPOSITORY}#${FIXTURE_COMMIT}`)
  assert.equal(candidate.evidence.compatibility?.compatible, true)
  const plan = resolver.makePlan(candidate, 'install')
  assert.equal(plan.fastPathEligible, true)
  assert.equal(plan.previewAvailable, true)
})

test('marketplace self-update is the only protected entry admitted for update', async () => {
  const resolver = new DefaultMarketplaceSourceResolver({ dshVersion: PINNED_DSH_VERSION, repository: new Adapter() })
  const catalog = parseMarketplaceCatalog({ _meta: { schema_version: '1.0' }, plugins: [{ id: 'plugin-marketplace', name: 'Marketplace', repo: REPOSITORY, compat: { status: 'ok' } }], watchlist: [] }).plugins
  const candidate = await resolveInstallCandidate({ action: 'update', catalog, pluginId: 'plugin-marketplace', resolver, stateEntries: [] })
  assert.equal(candidate.identity.pluginId, 'plugin-marketplace')
})

test('canonical command parser rejects removed lifecycle aliases and accepts direct execution', () => {
  assert.deepEqual(parseMarketplaceCommand({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'plugin' }), { type: 'execute', action: 'install', mode: 'direct', confirmations: [], pluginId: 'plugin' })
  assert.throws(() => parseMarketplaceCommand({ type: 'inspect', action: 'install', pluginId: 'plugin' }), /unsupported marketplace command/)
  assert.throws(() => parseMarketplaceCommand({ type: 'prepare', action: 'install', pluginId: 'plugin' }), /unsupported marketplace command/)
  assert.throws(() => parseMarketplaceCommand({ type: 'execute', action: 'install', mode: 'direct', pluginId: 'plugin', sourceRef: { kind: 'repository', input: REPOSITORY } }), /either pluginId or sourceRef/)
})

test('source lock binds the channel and exact artifact facts', () => {
  const candidate: MarketplaceCandidate = {
    buildScripts: {},
    description: 'fixture',
    diagnostics: [],
    environmentRequirements: [],
    evidence: { compatibility: null, filesPresent: ['package.json'], license: 'MIT', release: null, signature: null },
    execution: 'installable',
    identity: { packageName: '@owner/plugin', pluginId: 'plugin', repository: REPOSITORY, subpath: null },
    manifest: { artifactDigest: 'a'.repeat(64), bundlePatch: 'cordis.patch.yml', entryTargets: ['dist/index.js'], hash: 'b'.repeat(64), license: 'MIT', patchHash: 'c'.repeat(64), path: 'package.json', version: '1.0.0' },
    mechanism: 'bundle',
    risk: { level: 'low', reasons: [], requiredConfirmations: [] },
    source: { artifactUrl: null, catalogSourceId: 'builtin', channel: 'npm', installSpec: 'npm:@owner/plugin@1.0.0', kind: 'catalog', locator: 'https://github.com/owner/plugin', requestedRef: null, resolvedCommit: FIXTURE_COMMIT, version: '1.0.0' },
  }
  const lock = sourceLockFromCandidate(candidate)
  assert.equal(lock.channel, 'npm')
  assert.equal(validateMarketplaceSourceLock(lock), true)
  assert.equal(validateMarketplaceSourceLock({ ...lock, installSpec: 'npm:@owner/plugin@latest' }), false)
})
