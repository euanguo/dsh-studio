import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  nearestVersionTag,
  normalizeVersionTag,
  resolveProductVersion,
} from '../src/version.ts'

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
}

test('product version follows the nearest reachable release tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-version-'))
  try {
    git(root, 'init', '--quiet')
    git(root, 'config', 'user.name', 'DSH Studio Test')
    git(root, 'config', 'user.email', 'test@example.com')
    writeFileSync(join(root, 'package.json'), '{"version":"9.9.9"}\n')
    git(root, 'add', 'package.json')
    git(root, 'commit', '--quiet', '-m', 'initial')
    git(root, 'tag', 'v1.2.3')
    writeFileSync(join(root, 'next.txt'), 'next\n')
    git(root, 'add', 'next.txt')
    git(root, 'commit', '--quiet', '-m', 'next')

    assert.equal(nearestVersionTag(root), '1.2.3')
    assert.equal(resolveProductVersion(root), '1.2.3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release tag normalization preserves prerelease versions', () => {
  assert.equal(normalizeVersionTag('v0.2.0-rc.3\n'), '0.2.0-rc.3')
  assert.equal(normalizeVersionTag('release-0.2.0'), undefined)
})
