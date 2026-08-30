import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { publishGitHubRelease, releaseAssets } from '../scripts/publish-github-release.mjs'
import { validateReleaseTag } from '../scripts/validate-release-tag.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('tagged releases build and upload web and desktop distributions', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'release.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n')

  // Structured checks only: pin the signing/release-safety contract of the
  // workflow, not its shell-command or warning-copy wording.
  const config = parse(workflow)
  const packageJob = config.jobs.package
  assert.equal('CSC_LINK' in packageJob.env, false)
  assert.equal('CSC_KEY_PASSWORD' in packageJob.env, false)

  const fallbackStep = packageJob.steps.find(
    (step: { name?: string }) =>
      step.name === 'Package desktop distribution without release credentials',
  )
  assert.equal(fallbackStep.if, "env.DSH_STUDIO_SIGNING != 'enabled'")
  assert.equal(fallbackStep.env.CSC_IDENTITY_AUTO_DISCOVERY, 'false')

  const signedMacStep = packageJob.steps.find(
    (step: { name?: string }) =>
      step.name === 'Package signed macOS desktop distribution',
  )
  assert.match(signedMacStep.env.CSC_LINK, /secrets\.MACOS_CSC_LINK/)

  const signedWindowsStep = packageJob.steps.find(
    (step: { name?: string }) =>
      step.name === 'Package signed Windows desktop distribution',
  )
  assert.match(signedWindowsStep.env.CSC_LINK, /secrets\.WINDOWS_CSC_LINK/)

  const publishStep = config.jobs.publish.steps.find(
    (step: { name?: string }) => step.name === 'Publish release',
  )
  const releaseTagExpression = ['$', '{{ github.ref_name }}'].join('')
  assert.equal(
    publishStep.run,
    `node scripts/publish-github-release.mjs --dir artifacts --tag "${releaseTagExpression}"`,
  )
  assert.match(publishStep.env.GH_TOKEN, /github\.token/)
})

test('release publishing creates new releases and replaces existing assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-studio-release-assets-'))
  try {
    writeFileSync(join(directory, 'b.zip'), 'b')
    writeFileSync(join(directory, 'a.zip'), 'a')
    const assets = releaseAssets(directory)
    assert.deepEqual(assets.map(asset => asset.slice(directory.length + 1)), ['a.zip', 'b.zip'])

    const created: string[][] = []
    assert.equal(publishGitHubRelease({
      assets,
      releaseExists: () => false,
      run: (_command: string, args: string[]) => created.push(args),
      tag: 'v0.1.4',
    }), 'created')
    assert.deepEqual(created, [[
      'release',
      'create',
      'v0.1.4',
      ...assets,
      '--generate-notes',
    ]])

    const updated: string[][] = []
    assert.equal(publishGitHubRelease({
      assets,
      releaseExists: () => true,
      run: (_command: string, args: string[]) => updated.push(args),
      tag: 'v0.1.4',
    }), 'updated')
    assert.deepEqual(updated, [[
      'release',
      'upload',
      'v0.1.4',
      ...assets,
      '--clobber',
    ]])
    assert.throws(
      () => publishGitHubRelease({ assets: [], releaseExists: () => false, run: () => {}, tag: 'v0.1.4' }),
      /assets must not be empty/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('dev macOS package builds only when manually dispatched', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'dev-dmg.yml'),
    'utf8',
  )
  const config = parse(workflow)

  assert.deepEqual(config.on, { workflow_dispatch: null })
  assert.equal(config.jobs.package['runs-on'], 'macos-15')
  assert.equal(config.jobs.package.env.DSH_STUDIO_NODE_ARCH, 'arm64')
  const packageStep = config.jobs.package.steps.find(
    (step: { name?: string }) => step.name === 'Package macOS DMG',
  )
  assert.equal(packageStep.run, 'pnpm run dist:mac -- --channel dev')
  const uploadStep = config.jobs.package.steps.find(
    (step: { name?: string }) => step.name === 'Upload DMG artifact',
  )
  assert.equal(uploadStep.with.name, 'dsh-studio-dev-dmg-arm64')
  assert.equal(uploadStep.with.path, 'release/DSH-Studio-Dev-*.dmg')
})

test('release tags must match a stable package version', () => {
  assert.equal(validateReleaseTag('v1.2.3', '1.2.3'), '1.2.3')
  assert.throws(() => validateReleaseTag('v1.2.3-beta.1', '1.2.3-beta.1'), /stable semver/)
  assert.throws(() => validateReleaseTag('v1.2.4', '1.2.3'), /does not match package version/)
})
