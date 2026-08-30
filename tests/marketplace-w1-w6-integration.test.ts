import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMarketplaceCommand, type MarketplaceCommand, type MarketplaceSnapshot } from '../plugins/plugin-marketplace/src/protocol.ts'
import { requireHealthyMarketplaceSnapshot } from '../src/marketplace-tools.ts'
import { createMarketplaceStore, runMarketplaceCommand } from '../plugins/plugin-marketplace/src/client/store.ts'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'

test('canonical command envelope survives the UI/IPC/Agent boundary', () => {
  const commands: unknown[] = [
    { type: 'refresh', force: true },
    { type: 'plan', action: 'install', pluginId: 'alpha' },
    { type: 'execute', action: 'install', mode: 'direct', confirmations: [], pluginId: 'alpha' },
    { type: 'execute', action: 'install', mode: 'preview', confirmations: [], pluginId: 'alpha' },
    { type: 'pack', packId: 'recommended', mode: 'direct', confirmations: [] },
    { type: 'cancel', transactionId: 'tx-1' },
    { type: 'provide', transactionId: 'tx-1', answers: { API_KEY: 'secret' } },
    { type: 'discard' },
    { type: 'apply' },
    { type: 'undo' },
  ]
  const parsed = commands.map(parseMarketplaceCommand)
  assert.equal(parsed.length, 10)
  assert.equal(parsed[2]?.type, 'execute')
  assert.equal(parsed[4]?.type, 'pack')
  assert.throws(() => parseMarketplaceCommand({ type: 'prepare', action: 'install', pluginId: 'alpha' }), /unsupported marketplace command/)
})

test('the marketplace store applies one accepted snapshot and rejects a host error clearly', async () => {
  const snapshot: MarketplaceSnapshot = {
    auth: { detail: 'ready', status: 'ready' }, busy: false, candidate: null, catalog: [], catalogGeneratedAt: null,
    catalogWatchlist: [], error: null, installed: [], inputRequest: null, lastAction: null,
    lifecycle: { candidate: null, current: { profile: 'desktop', state: 'live' }, previous: null },
    packs: [], plan: null, preview: null, progress: null, selfUpdate: null, sourceLocks: [], undoAvailable: false,
  }
  const bridge = {
    pluginMarketplace: {
      dispatch: async (command: MarketplaceCommand) => {
        assert.equal(command.type, 'refresh')
        return snapshot
      },
      getSnapshot: async () => snapshot,
      onSnapshotChanged: () => () => {},
    },
  } as unknown as DesktopBridge
  const store = createMarketplaceStore()
  const outcome = await runMarketplaceCommand(bridge, store, { type: 'refresh' })
  assert.equal(outcome.rejected, null)
  assert.equal(store.getState().snapshot?.error, null)
  assert.deepEqual(requireHealthyMarketplaceSnapshot(snapshot), snapshot)
})
