import assert from 'node:assert/strict'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { replaceMacBundle } from '../scripts/install-mac.mjs'

async function makeBundle(path: string, marker: string): Promise<void> {
  await mkdir(join(path, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(join(
    path,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
  ), { recursive: true })
  await mkdir(join(path, 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(path, 'Contents', 'MacOS', 'Oh-DSH-Desktop'), marker)
  await writeFile(join(
    path,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Electron Framework',
  ), marker)
  await writeFile(join(path, 'Contents', 'Resources', 'app.asar'), marker)
}

test('local mac install never exposes a partially copied app bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-install-'))
  const source = join(root, 'source.app')
  const destination = join(root, 'Applications', 'Oh-DSH-Desktop.app')
  const backups = join(root, 'Trash')
  await makeBundle(source, 'new')
  await makeBundle(destination, 'old')

  const result = await replaceMacBundle({
    source,
    destination,
    backupDirectory: backups,
    copyBundle: async (from: string, pending: string) => {
      assert.notEqual(pending, destination)
      assert.equal(
        await readFile(join(
          destination,
          'Contents',
          'Frameworks',
          'Electron Framework.framework',
          'Electron Framework',
        ), 'utf8'),
        'old',
      )
      await cp(from, pending, { recursive: true })
    },
    validateBundle: (path: string) => makeBundleValidation(path),
  })

  assert.equal(
    await readFile(join(destination, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'new',
  )
  assert.equal(
    await readFile(join(result.backup!, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'old',
  )
})

async function makeBundleValidation(path: string): Promise<void> {
  const values = await Promise.all([
    readFile(join(path, 'Contents', 'MacOS', 'Oh-DSH-Desktop'), 'utf8'),
    readFile(join(
      path,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    ), 'utf8'),
    readFile(join(path, 'Contents', 'Resources', 'app.asar'), 'utf8'),
  ])
  assert.equal(new Set(values).size, 1)
}
