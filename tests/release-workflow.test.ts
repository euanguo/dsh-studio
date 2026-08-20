import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validateReleaseTag } from '../scripts/validate-release-tag.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('tagged releases build and upload web and desktop distributions', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'release.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n')

  assert.match(workflow, /run: node scripts\/build-web\.mjs/)
  assert.match(workflow, /release\/dsh-studio-web-\*\.tar\.gz/)
  assert.match(workflow, /release\/dsh-studio-web-\*\.zip/)
  assert.doesNotMatch(workflow, /build-tui/)
  assert.doesNotMatch(workflow, /dsh-studio-tui/)
  assert.match(workflow, /fetch-depth: 0/)
  assert.match(workflow, /fetch-tags: true/)
  assert.match(workflow, /validate-release-tag\.mjs --tag/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /if: github\.event_name == 'push'/)
  assert.match(workflow, /macOS signing credentials are incomplete; producing an ad-hoc-signed package/)
  assert.match(workflow, /Windows signing credentials are incomplete; producing an unsigned installer/)

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
})

test('release tags must match a stable package version', () => {
  assert.equal(validateReleaseTag('v1.2.3', '1.2.3'), '1.2.3')
  assert.throws(() => validateReleaseTag('v1.2.3-beta.1', '1.2.3-beta.1'), /stable semver/)
  assert.throws(() => validateReleaseTag('v1.2.4', '1.2.3'), /does not match package version/)
})
