import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  TerminalSessionStore,
  terminalSessionFingerprint,
  terminalSessionKey,
} from '../plugins/sidebar-host/src/terminal-session-store.ts'

test('terminal session store restores history and rotates atomic snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-terminal-store-'))
  try {
    const store = new TerminalSessionStore({ root, persistIdleMs: 1, persistMaxIntervalMs: 10 })
    const record = store.ensure({
      cwd: 'session-a',
      tabId: 'terminal:1',
      spawnCwd: '/tmp/workspace',
      cols: 80,
      rows: 24,
    })
    store.update(record.key, {
      rawHistory: 'raw\n',
      replayHistory: 'visible\n',
      cols: 90,
      rows: 30,
      status: 'inactive',
    })
    await store.flush()
    assert.equal(readFileSync(store.currentPath, 'utf8').includes('visible'), true)

    const restored = new TerminalSessionStore({ root })
    const next = restored.ensure({
      cwd: 'session-a',
      tabId: 'terminal:1',
      spawnCwd: '/tmp/workspace',
      cols: 100,
      rows: 40,
    })
    assert.equal(next.incarnationId, record.incarnationId)
    assert.equal(next.rawHistory, 'raw\n')
    assert.equal(next.replayHistory, 'visible\n')
    assert.equal(next.status, 'running')
    assert.notEqual(terminalSessionFingerprint(next), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('explicit close tombstones the incarnation and a reopen mints a new one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-terminal-store-'))
  try {
    const store = new TerminalSessionStore({ root })
    const first = store.ensure({ cwd: 's', tabId: 't', spawnCwd: '/tmp', cols: 80, rows: 24 })
    store.close(terminalSessionKey('s', 't'), first.incarnationId)
    const second = store.ensure({ cwd: 's', tabId: 't', spawnCwd: '/tmp', cols: 80, rows: 24 })
    assert.notEqual(second.incarnationId, first.incarnationId)
    await store.flush()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('inactive sessions are evicted oldest-first at the configured limit', () => {
  let now = 0
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-terminal-store-'))
  try {
    const store = new TerminalSessionStore({
      root,
      maxRetainedInactiveSessions: 1,
      now: () => now,
    })
    const first = store.ensure({ cwd: 's', tabId: 'one', spawnCwd: '/tmp', cols: 80, rows: 24 })
    now += 1
    store.markInactive(first.key)
    now += 1
    const second = store.ensure({ cwd: 's', tabId: 'two', spawnCwd: '/tmp', cols: 80, rows: 24 })
    store.markInactive(second.key)
    assert.equal(store.get(first.key), undefined)
    assert.equal(store.get(second.key)?.status, 'inactive')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
