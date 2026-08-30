import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function releaseAssets(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => resolve(directory, entry.name))
    .sort()
}

export function publishGitHubRelease({
  assets,
  releaseExists,
  run,
  tag,
}) {
  if (assets.length === 0) throw new Error('release assets must not be empty')
  if (releaseExists(tag)) {
    run('gh', ['release', 'upload', tag, ...assets, '--clobber'])
    return 'updated'
  }
  run('gh', ['release', 'create', tag, ...assets, '--generate-notes'])
  return 'created'
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${String(result.status)}`)
}

function releaseExists(tag) {
  const result = spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' })
  if (result.error) throw result.error
  return result.status === 0
}

function argument(name) {
  const index = process.argv.slice(2).indexOf(name)
  return index === -1 ? undefined : process.argv.slice(2)[index + 1]
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = argument('--dir')
  const tag = argument('--tag')
  if (directory === undefined || tag === undefined) {
    throw new Error('usage: publish-github-release.mjs --dir artifacts --tag vX.Y.Z')
  }
  if (!existsSync(directory)) throw new Error(`release artifact directory is missing: ${directory}`)
  const outcome = publishGitHubRelease({
    assets: releaseAssets(directory),
    releaseExists,
    run,
    tag,
  })
  console.log(`GitHub release ${outcome}: ${tag}`)
}
