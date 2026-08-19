import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function writePackage(store: string, name: string, version: string, manifest: object, source: string) {
  const packageDir = join(store, `${name.replace('/', '+')}@${version}`, 'node_modules', ...name.split('/'))
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name,
    version,
    type: 'module',
    main: './index.js',
    ...manifest,
  }))
  writeFileSync(join(packageDir, 'index.js'), source)
}

test('Nix dependency collector preserves transitive peer resolution', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dsh-studio-nix-deps-'))
  const store = join(fixture, '.pnpm')
  const output = join(fixture, 'closure')
  const manifest = join(fixture, 'package.json')

  try {
    writePackage(store, '@fixture/root', '1.0.0', {
      peerDependencies: { '@fixture/peer': '1.0.0' },
    }, "export { value } from '@fixture/peer'\n")
    writePackage(store, '@fixture/peer', '1.0.0', {}, "export const value = 'resolved'\n")
    writeFileSync(manifest, JSON.stringify({
      dependencies: { '@fixture/root': '1.0.0' },
    }))

    const result = spawnSync('python3', [join(root, 'nix', 'collect-deps.py'), store, manifest, output], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readlinkSync(join(output, '@fixture', 'root', 'node_modules')), join('..', '..'))

    // Runtime-generated fixture path: this assertion exercises Node's real ESM resolver.
    const collected = await import(pathToFileURL(join(output, '@fixture', 'root', 'index.js')).href)
    assert.equal(collected.value, 'resolved')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
