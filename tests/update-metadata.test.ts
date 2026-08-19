import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateRawSync, gzipSync } from 'node:zlib'
import { mergeMetadata, verifyMetadata } from '../scripts/update-metadata.mjs'

const blockmap = Buffer.from(JSON.stringify({
  version: '2',
  files: [{ name: 'file', offset: 0, checksums: ['checksum'], sizes: [1] }],
}))

function sha512(data: Buffer) {
  return createHash('sha512').update(data).digest('base64')
}

async function asset(dir: string, name: string, content: string) {
  const path = join(dir, name)
  const data = Buffer.from(content)
  await writeFile(path, data)
  return {
    url: `https://github.com/euanguo/dsh-studio/releases/download/v1.2.0/${name}`,
    sha512: sha512(data),
    size: data.length,
  }
}

async function externalBlockmap(dir: string, name: string) {
  await writeFile(join(dir, `${name}.blockmap`), gzipSync(blockmap))
}

async function appImageAsset(dir: string, name: string, content: string) {
  const compressed = deflateRawSync(blockmap)
  const trailer = Buffer.allocUnsafe(4)
  trailer.writeUInt32BE(compressed.length)
  const data = Buffer.concat([Buffer.from(content), compressed, trailer])
  await writeFile(join(dir, name), data)
  return {
    url: `https://github.com/euanguo/dsh-studio/releases/download/v1.2.0/${name}`,
    sha512: sha512(data),
    size: data.length,
    blockMapSize: compressed.length,
  }
}

test('metadata verification selects one architecture and validates SHA-512', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-studio-metadata-'))
  const arm = await asset(dir, 'DSH Studio-1.2.0-arm64.zip', 'arm')
  const x64 = await asset(dir, 'DSH Studio-1.2.0-x64.zip', 'x64')
  await externalBlockmap(dir, 'DSH Studio-1.2.0-arm64.zip')
  await externalBlockmap(dir, 'DSH Studio-1.2.0-x64.zip')
  await writeFile(join(dir, 'latest-mac.yml'), [
    'version: 1.2.0',
    'files:',
    `  - ${JSON.stringify(arm)}`,
    `  - ${JSON.stringify(x64)}`,
  ].join('\n'))
  const result = verifyMetadata({ dir, version: '1.2.0', platform: 'mac-arm64' })
  assert.equal(result.selected, arm.url.split('/').pop())
  await writeFile(join(dir, 'DSH Studio-1.2.0-arm64.zip'), 'tampered')
  assert.throws(() => verifyMetadata({ dir, version: '1.2.0', platform: 'mac-arm64' }), /sha512 mismatch/)
})

test('metadata verification accepts an embedded AppImage blockmap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-studio-metadata-'))
  const name = 'DSH Studio-1.2.0-x86_64.AppImage'
  const app = await appImageAsset(dir, name, 'app')
  const metadata = () => [
    'version: 1.2.0',
    'files:',
    `  - ${JSON.stringify(app)}`,
  ].join('\n')
  await writeFile(join(dir, 'latest-linux.yml'), metadata())
  const result = verifyMetadata({ dir, version: '1.2.0', platform: 'linux-x64' })
  assert.equal(result.selected, name)

  const data = await readFile(join(dir, name))
  data.writeUInt32BE(app.blockMapSize + 1, data.length - 4)
  app.sha512 = sha512(data)
  await writeFile(join(dir, name), data)
  await writeFile(join(dir, 'latest-linux.yml'), metadata())
  assert.throws(() => verifyMetadata({ dir, version: '1.2.0', platform: 'linux-x64' }), /embedded blockmap size mismatch/)
})

test('metadata verification requires external desktop blockmaps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-studio-metadata-'))
  const app = await asset(dir, 'DSH Studio-1.2.0-arm64.zip', 'app')
  await writeFile(join(dir, 'latest-mac.yml'), [
    'version: 1.2.0',
    'files:',
    `  - ${JSON.stringify(app)}`,
  ].join('\n'))
  assert.throws(() => verifyMetadata({ dir, version: '1.2.0', platform: 'mac-arm64' }), /missing external blockmap/)
})

test('metadata merge combines macOS architectures and rejects version conflicts', () => {
  const arm = { version: '1.2.0', files: [{ url: 'https://example/arm.zip', sha512: 'arm', size: 1 }] }
  const x64 = { version: '1.2.0', files: [{ url: 'https://example/x64.zip', sha512: 'x64', size: 1 }] }
  const merged = mergeMetadata([arm, x64])
  assert.deepEqual(merged.files.map(file => file.url), ['https://example/arm.zip', 'https://example/x64.zip'])
  assert.throws(() => mergeMetadata([arm, { ...x64, version: '1.3.0' }]), /different versions/)
})

test('metadata verification rejects web distribution assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-studio-metadata-'))
  await mkdir(join(dir, 'nested'))
  const app = await appImageAsset(dir, 'DSH Studio-1.2.0-x86_64.AppImage', 'app')
  const web = await asset(dir, 'dsh-studio-web-1.2.0-linux-x64.zip', 'web')
  await writeFile(join(dir, 'latest-linux.yml'), [
    'version: 1.2.0',
    'files:',
    `  - ${JSON.stringify(app)}`,
    `  - ${JSON.stringify(web)}`,
  ].join('\n'))
  assert.throws(() => verifyMetadata({ dir, version: '1.2.0', platform: 'linux-x64' }), /web distribution/)
})
