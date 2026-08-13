import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { DSH_SOURCE_SPEC, resolveDshSource } from '../scripts/dsh-source.mjs'

test('desktop release source pins a full DSH commit', () => {
  assert.equal(DSH_SOURCE_SPEC.version, '0.1.0-rc.5')
  assert.equal(DSH_SOURCE_SPEC.repository, 'https://github.com/deepseek-ai/deepseek-harness.git')
  assert.match(DSH_SOURCE_SPEC.ref, /^[0-9a-f]{40}$/)
  assert.match(DSH_SOURCE_SPEC.revision, /^[0-9a-f]{40}$/)
  assert.equal(DSH_SOURCE_SPEC.ref, DSH_SOURCE_SPEC.revision)
})

test('DSH source override must match the pinned package version', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-source-'))
  const previous = process.env.DSH_SOURCE
  try {
    mkdirSync(join(root, 'apps', 'cli'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-root',
      version: DSH_SOURCE_SPEC.version,
    }))
    writeFileSync(join(root, 'apps', 'cli', 'package.json'), '{}\n')
    process.env.DSH_SOURCE = root
    assert.equal(resolveDshSource(), resolve(root))

    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-root',
      version: '0.0.0',
    }))
    assert.throws(() => resolveDshSource(), /0\.1\.0-rc\.5 is required/)
  } finally {
    if (previous === undefined) delete process.env.DSH_SOURCE
    else process.env.DSH_SOURCE = previous
    rmSync(root, { recursive: true, force: true })
  }
})
