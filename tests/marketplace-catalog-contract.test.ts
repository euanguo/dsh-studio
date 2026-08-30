import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isMarketplaceArtifactUrl, parseMarketplaceCatalog, isMarketplaceImageUrl } from '../plugins/plugin-marketplace/src/catalog.ts'
import {
  formatMarketplaceCount,
  localizedDescription,
  marketplaceScore,
  sortMarketplacePlugins,
} from '../plugins/plugin-marketplace/src/client/marketplace-meta.ts'
import { parseMarketplaceCommand } from '../plugins/plugin-marketplace/src/protocol.ts'

const canonicalCatalog = {
  _meta: { schema_version: '1.0', generated_at: '2026-08-26T00:00:00.000Z' },
  plugins: [
    {
      id: 'alpha',
      name: 'Alpha',
      repo: 'owner/alpha',
      url: 'https://github.com/owner/alpha',
      category: 'tools',
      description: { en: 'Alpha English', zh: 'Alpha 中文' },
      stars: 1200,
      downloads: 12_000,
      last_push: '2026-08-25T00:00:00.000Z',
      npm: '@owner/alpha',
      compat: { status: 'ok', dshVersion: '0.1.0-rc.8', lastVerified: '2026-08-24T00:00:00.000Z' },
      screenshots: ['https://raw.githubusercontent.com/owner/alpha/main/assets/shot.png', 'https://evil.example/shot.png'],
      evidence: { level: 2 },
      install: 'dsh plugin --profile web add @owner/alpha',
      tags: ['tools', 'search'],
    },
    {
      id: 'beta',
      name: 'Beta',
      repo: 'owner/beta',
      url: 'https://github.com/owner/beta',
      category: 'ui',
      description: { en: 'Beta English', zh: 'Beta 中文' },
      stars: 4,
      downloads: null,
      compat: { status: 'unknown' },
      screenshots: [],
      tags: [],
    },
  ],
  watchlist: [{
    id: 'candidate',
    name: 'Candidate',
    repo: 'owner/candidate',
    url: 'https://github.com/owner/candidate',
    category: 'utility',
    description: { en: 'Candidate', zh: '候选' },
    stars: 1,
    compat: { status: 'unknown' },
    watchReason: '蹭tag',
  }],
}

test('canonical DSH catalog preserves rich metadata and filters unsafe screenshots', () => {
  const catalog = parseMarketplaceCatalog(canonicalCatalog)
  assert.equal(catalog.generatedAt, '2026-08-26T00:00:00.000Z')
  assert.equal(catalog.plugins.length, 2)
  assert.equal(catalog.watchlist.length, 1)
  const alpha = catalog.plugins.find(plugin => plugin.id === 'alpha')
  assert.ok(alpha)
  assert.equal(alpha.stars, 1200)
  assert.equal(alpha.downloads, 12_000)
  assert.equal(alpha.npm, '@owner/alpha')
  assert.equal(alpha.descriptionByLocale.zh, 'Alpha 中文')
  assert.deepEqual(alpha.screenshots, ['https://raw.githubusercontent.com/owner/alpha/main/assets/shot.png'])
  assert.equal(alpha.installCommand, 'dsh plugin --profile web add @owner/alpha')
  assert.equal(catalog.watchlist[0]?.watchReason, '蹭tag')
})

test('catalog ids stay unique when upstream rows reuse a display slug', () => {
  const parsed = parseMarketplaceCatalog({
    ...canonicalCatalog,
    plugins: [canonicalCatalog.plugins[0], { ...canonicalCatalog.plugins[0], repo: 'other/alpha' }],
  })
  assert.equal(new Set(parsed.plugins.map(plugin => plugin.id)).size, 2)
  assert.notEqual(parsed.plugins[0]?.id, parsed.plugins[1]?.id)
})

test('legacy catalog schemas are rejected instead of maintaining a second reader', () => {
  assert.throws(
    () => parseMarketplaceCatalog({ schema: 'dsh-external-hub/v0.1', repos: [] }),
    /expected schema_version 1\.0/,
  )
  assert.throws(
    () => parseMarketplaceCatalog({ _meta: { schema_version: '0.9' }, plugins: [] }),
    /expected schema_version 1\.0/,
  )
})

test('marketplace metadata helpers provide locale, metric and ordering behavior', () => {
  const catalog = parseMarketplaceCatalog(canonicalCatalog)
  const alpha = catalog.plugins.find(plugin => plugin.id === 'alpha')
  const beta = catalog.plugins.find(plugin => plugin.id === 'beta')
  assert.ok(alpha)
  assert.ok(beta)
  assert.equal(localizedDescription(alpha, 'zh-CN'), 'Alpha 中文')
  assert.equal(localizedDescription(alpha, 'en-US'), 'Alpha English')
  assert.equal(formatMarketplaceCount(1200), '1.2k')
  assert.equal(formatMarketplaceCount(null), '—')
  assert.equal(sortMarketplacePlugins([beta, alpha], 'stars').map(plugin => plugin.id).join(','), 'alpha,beta')
  assert.ok(marketplaceScore(alpha) > marketplaceScore(beta))
})

test('command parser exposes the clean execution contract and rejects removed aliases', () => {
  const command = parseMarketplaceCommand({
    type: 'execute',
    action: 'install',
    mode: 'direct',
    pluginId: 'alpha',
  })
  assert.deepEqual(command, { type: 'execute', action: 'install', mode: 'direct', confirmations: [], pluginId: 'alpha' })
  assert.deepEqual(parseMarketplaceCommand({
    type: 'provide',
    transactionId: 'tx-1',
    answers: { API_KEY: 'secret' },
  }), { type: 'provide', transactionId: 'tx-1', answers: { API_KEY: 'secret' } })
  assert.throws(() => parseMarketplaceCommand({ type: 'prepare', action: 'install', pluginId: 'alpha' }), /unsupported marketplace command/)
})

test('artifact validation accepts only clean GitHub release URLs', () => {
  assert.equal(isMarketplaceArtifactUrl('https://github.com/owner/plugin/releases/download/v1.0.0/plugin.tgz'), true)
  assert.equal(isMarketplaceArtifactUrl('https://objects.githubusercontent.com/github-production-release-asset/plugin.tgz'), true)
  assert.equal(isMarketplaceArtifactUrl('https://evil.example/plugin.tgz'), false)
  assert.equal(isMarketplaceArtifactUrl('https://github.com/owner/plugin/archive/refs/heads/main.zip'), false)
  assert.equal(isMarketplaceArtifactUrl('https://github.com/owner/plugin/releases/download/v1.0.0/plugin.tgz?token=secret'), false)
})

test('image validation accepts only HTTPS marketplace image hosts', () => {
  assert.equal(isMarketplaceImageUrl('https://raw.githubusercontent.com/owner/alpha/main/shot.png'), true)
  assert.equal(isMarketplaceImageUrl('http://raw.githubusercontent.com/owner/alpha/main/shot.png'), false)
  assert.equal(isMarketplaceImageUrl('https://evil.example/shot.png'), false)
})
