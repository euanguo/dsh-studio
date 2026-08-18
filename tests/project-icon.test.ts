import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { detectProjectIcon } from '../plugins/sidebar-host/src/project-icon.ts'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function withTempProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-project-icon-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('project icon detection prefers a bounded local PNG over homepage favicon', async () => {
  await withTempProject(async root => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ homepage: 'https://example.com' }))
    await writeFile(join(root, 'favicon.png'), PNG)
    const result = await detectProjectIcon(root)
    assert.equal(result.repoRoot, root)
    assert.equal(result.icon?.source, 'file')
    assert.equal(result.icon?.label, 'favicon.png')
  })
})

test('project icon detection falls back to homepage favicon when no local PNG exists', async () => {
  await withTempProject(async root => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ homepage: 'https://example.com/docs' }))
    const result = await detectProjectIcon(root)
    assert.equal(result.icon?.source, 'favicon')
    assert.equal(result.icon?.src, 'https://www.google.com/s2/favicons?domain=example.com&sz=64')
  })
})
