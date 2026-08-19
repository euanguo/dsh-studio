import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LEFT_RAIL_SETTINGS_KEYS,
  LEFT_RAIL_SETTINGS_NS,
  LEFT_RAIL_SETTINGS_VERSION,
  sanitizeLeftRailSettings,
  sanitizeProjectIconPreference,
} from '@oh-dsh/shared/left-rail-preferences'

test('left-rail settings namespace and version are stable', () => {
  // Kebab-case, no dots: DSH settingsNamespace enforces /^[a-z][a-z0-9-]*$/.
  assert.equal(LEFT_RAIL_SETTINGS_NS, 'oh-dsh-left-rail')
  assert.equal(LEFT_RAIL_SETTINGS_VERSION, 1)
  assert.deepEqual(LEFT_RAIL_SETTINGS_KEYS, [
    'version', 'activeTab', 'projectGroup', 'groupIds', 'groupLabels',
    'projectAlias', 'worktreeAlias', 'projectIconOverrides',
  ])
})

test('sanitizeLeftRailSettings drops unknown keys and keeps valid fields', () => {
  const value = {
    version: 1,
    activeTab: 'group-a',
    projectGroup: { '/repo': 'group-a' },
    groupIds: ['group-a', ''],
    groupLabels: { 'group-a': 'A' },
    projectAlias: { '/repo': 'repo' },
    worktreeAlias: { '/repo/wt': 'wt' },
    projectIconOverrides: {
      '/repo': { kind: 'builtin', name: 'git' },
      '/bad': { kind: 'builtin', name: 'star' },
      '/upload': { kind: 'upload', mime: 'image/png', data: 'data:image/png;base64,AA==' },
    },
    unknown: 'dropme',
  }
  const sanitized = sanitizeLeftRailSettings(value)
  assert.ok(sanitized !== undefined)
  assert.equal(sanitized.activeTab, 'group-a')
  assert.deepEqual(sanitized.groupIds, ['group-a'])
  assert.equal('unknown' in (sanitized as Record<string, unknown>), false)
  assert.deepEqual(sanitized.projectIconOverrides, {
    '/repo': { kind: 'builtin', name: 'git' },
    '/upload': { kind: 'upload', mime: 'image/png', data: 'data:image/png;base64,AA==' },
  })
})

test('sanitizeLeftRailSettings tolerates a full-auto slice (empty override map)', () => {
  const sanitized = sanitizeLeftRailSettings({
    version: 1,
    activeTab: '__default__',
    projectGroup: {},
    projectIconOverrides: {},
  })
  assert.ok(sanitized !== undefined)
  assert.deepEqual(sanitized.projectIconOverrides, {})
  // An explicit empty override map is distinguishable from a dropped key:
  // the property is present, so a reload keeps auto instead of a stale icon.
  assert.ok('projectIconOverrides' in (sanitized as Record<string, unknown>))
})

test('sanitizeLeftRailSettings rejects non-object input', () => {
  assert.equal(sanitizeLeftRailSettings(null), undefined)
  assert.equal(sanitizeLeftRailSettings('nope'), undefined)
  assert.equal(sanitizeLeftRailSettings([1, 2]), undefined)
  assert.equal(sanitizeLeftRailSettings(undefined), undefined)
})

test('sanitizeProjectIconPreference enforces the builtin allowlist and PNG upload', () => {
  assert.deepEqual(sanitizeProjectIconPreference({ kind: 'builtin', name: 'git' }), { kind: 'builtin', name: 'git' })
  assert.equal(sanitizeProjectIconPreference({ kind: 'builtin', name: 'star' }), undefined)
  assert.equal(sanitizeProjectIconPreference({ kind: 'upload', mime: 'image/png', data: 'data:image/svg+xml;base64,AA==' }), undefined)
  assert.deepEqual(
    sanitizeProjectIconPreference({ kind: 'upload', mime: 'image/png', data: 'data:image/png;base64,AA==' }),
    { kind: 'upload', mime: 'image/png', data: 'data:image/png;base64,AA==' },
  )
})
