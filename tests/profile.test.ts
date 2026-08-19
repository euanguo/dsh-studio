import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DESKTOP_BUNDLES, ensureDesktopProfile } from '../src/profile.ts'

test('desktop profile initializes required bundles and preserves user plugins', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
  try {
    const first = ensureDesktopProfile(join(root, 'home'))
    const manifestPath = join(first.profileDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, DESKTOP_BUNDLES)

    manifest.dependencies['example-plugin'] = '1.0.0'
    manifest.dsh.profile.bundles = ['example-plugin', '@dsh-studio/desktop']
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    writeFileSync(join(first.profileDir, 'cordis.patch.yml'), '- id: custom\n  disabled: true\n')

    const second = ensureDesktopProfile(join(root, 'home'))
    const upgraded = JSON.parse(readFileSync(join(second.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(upgraded.dsh.profile.bundles, [...DESKTOP_BUNDLES, 'example-plugin'])
    assert.equal(upgraded.dependencies['example-plugin'], '1.0.0')
    assert.match(readFileSync(join(second.profileDir, 'cordis.patch.yml'), 'utf8'), /custom/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
