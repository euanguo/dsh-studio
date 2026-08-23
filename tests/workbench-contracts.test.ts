import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GLOBAL_SCOPE_BUCKET,
  resolveOpenPlan,
  resolveScopeBucket,
} from '@dsh-studio/shared/workbench-contracts'

/* ── resolveOpenPlan ──────────────────────────────────────────────── */

test('resolveOpenPlan defaults to a pinned, activated center tab', () => {
  assert.deepEqual(resolveOpenPlan({ kind: 'file' }, { previewTabs: 'default' }), {
    area: 'center-tabs',
    pinned: true,
    activate: true,
  })
})

test('resolveOpenPlan keeps exactly one replaceable preview in default mode', () => {
  assert.deepEqual(
    resolveOpenPlan({ kind: 'file', intent: 'preview' }, { previewTabs: 'default' }),
    { area: 'center-tabs', pinned: false, activate: true },
  )
})

test('resolveOpenPlan upgrades previews to permanent tabs when previews are disabled', () => {
  assert.deepEqual(
    resolveOpenPlan({ kind: 'file', intent: 'preview' }, { previewTabs: 'disabled' }),
    { area: 'center-tabs', pinned: true, activate: true },
  )
})

test('resolveOpenPlan never activates background opens', () => {
  assert.deepEqual(
    resolveOpenPlan({ kind: 'diff', intent: 'background' }, { previewTabs: 'default' }),
    { area: 'center-tabs', pinned: true, activate: false },
  )
})

test('resolveOpenPlan pins conversation-like kinds regardless of preview intent', () => {
  assert.deepEqual(
    resolveOpenPlan(
      { kind: 'conversation', intent: 'preview', alwaysPinnedKind: true },
      { previewTabs: 'default' },
    ),
    { area: 'center-tabs', pinned: true, activate: true },
  )
})

test('resolveOpenPlan routes explicit side-rail opens to permanent rail tabs', () => {
  assert.deepEqual(
    resolveOpenPlan(
      { kind: 'review', area: 'side-rail', intent: 'preview' },
      { previewTabs: 'default' },
    ),
    { area: 'side-rail', pinned: true, activate: true },
  )
})

test('resolveOpenPlan refuses rail previews instead of guessing', () => {
  assert.throws(
    () =>
      resolveOpenPlan(
        { kind: 'file', area: 'side-rail', railTabsArePermanent: false },
        { previewTabs: 'default' },
      ),
    /side-rail preview tabs are not supported/,
  )
})

/* ── resolveScopeBucket ───────────────────────────────────────────── */

test('resolveScopeBucket collapses global state onto one bucket', () => {
  assert.equal(resolveScopeBucket('global', '/repo/a'), GLOBAL_SCOPE_BUCKET)
  assert.equal(resolveScopeBucket('global', null), GLOBAL_SCOPE_BUCKET)
})

test('resolveScopeBucket buckets workspace and session state by their key', () => {
  assert.equal(resolveScopeBucket('workspace', '/repo/a'), '/repo/a')
  assert.equal(resolveScopeBucket('session', 'sess-1'), 'sess-1')
})

test('resolveScopeBucket falls back to the shared bucket when no key exists', () => {
  assert.equal(resolveScopeBucket('workspace', null), GLOBAL_SCOPE_BUCKET)
  assert.equal(resolveScopeBucket('session', '   '), GLOBAL_SCOPE_BUCKET)
})
