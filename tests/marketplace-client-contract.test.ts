import test from 'node:test'
import assert from 'node:assert/strict'
import { compatibilityTone, formatMarketplaceCount, planCanInstallDirectly, sortMarketplacePlugins } from '../plugins/plugin-marketplace/src/client/marketplace-meta.ts'
import { isMarketplaceImageUrl } from '../plugins/plugin-marketplace/src/catalog.ts'

test('marketplace client derivations', async (t) => {
  const plugin = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, installed: false, stars: 1, downloads: 1, pushedAt: null, compatibility: { status: 'ok' as const }, ...extra } as any)
  await t.test('formats metrics and tones', () => {
    assert.equal(formatMarketplaceCount(1250), '1.3k'); assert.equal(formatMarketplaceCount(null), '—')
    assert.equal(compatibilityTone('ok'), 'positive'); assert.equal(compatibilityTone('broken'), 'negative')
  })
  await t.test('sorts presets with installed first', () => {
    const items = [plugin('z', { stars: 2 }), plugin('a', { stars: 9, installed: true })]
    assert.equal(sortMarketplacePlugins(items, 'stars')[0]?.id, 'a'); assert.deepEqual(sortMarketplacePlugins(items, 'name').map(p => p.id), ['a', 'z'])
    for (const preset of ['downloads', 'updated', 'smart'] as const) assert.equal(sortMarketplacePlugins(items, preset).length, 2)
    assert.equal(sortMarketplacePlugins(items, 'smart')[0]?.id, 'a')
  })
  await t.test('selects direct eligibility and trusted images', () => {
    assert.equal(planCanInstallDirectly({ fastPathEligible: true, execution: 'installable', requirements: [] } as any), true)
    assert.equal(planCanInstallDirectly({ fastPathEligible: false } as any), false)
    assert.equal(isMarketplaceImageUrl('https://raw.githubusercontent.com/a/b/main/x.png'), true)
    assert.equal(isMarketplaceImageUrl('http://evil.test/x.png'), false)
  })
})
