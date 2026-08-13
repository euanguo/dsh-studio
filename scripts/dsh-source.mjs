import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSourceSpec() {
  const value = JSON.parse(readFileSync(join(root, 'dsh-source.json'), 'utf8'))
  for (const field of ['repository', 'ref', 'revision', 'version']) {
    if (typeof value[field] !== 'string' || value[field] === '') {
      throw new Error(`dsh-source.json ${field} must be a non-empty string`)
    }
  }
  if (!/^[0-9a-f]{40}$/.test(value.revision)) {
    throw new Error('dsh-source.json revision must be a full Git commit')
  }
  return Object.freeze(value)
}

/** Reproducible DSH source used by release builds. */
export const DSH_SOURCE_SPEC = readSourceSpec()

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function validateSource(source, expectedRevision) {
  const manifestPath = join(source, 'package.json')
  if (!existsSync(join(source, 'apps', 'cli', 'package.json')) || !existsSync(manifestPath)) {
    throw new Error(`DSH source checkout not found: ${source}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== DSH_SOURCE_SPEC.version) {
    throw new Error(
      `DSH ${DSH_SOURCE_SPEC.version} is required, received ${String(manifest.version)} at ${source}`,
    )
  }
  if (expectedRevision !== undefined) {
    const actual = capture('git', ['rev-parse', 'HEAD'], source)
    if (actual !== expectedRevision) {
      throw new Error(`cached DSH revision mismatch: expected ${expectedRevision}, received ${actual}`)
    }
    const changes = capture('git', ['status', '--porcelain', '--untracked-files=no'], source)
    if (changes !== '') {
      throw new Error(`cached DSH source contains tracked changes: ${source}`)
    }
  }
}

function acquirePinnedSource(target) {
  const temporary = `${target}.clone-${String(process.pid)}`
  rmSync(temporary, { recursive: true, force: true })
  try {
    run('git', ['init', temporary])
    run('git', ['-C', temporary, 'remote', 'add', 'origin', DSH_SOURCE_SPEC.repository])
    run('git', [
      '-C', temporary,
      'fetch',
      '--depth=1',
      '--filter=blob:none',
      '--no-tags',
      'origin',
      DSH_SOURCE_SPEC.revision,
    ])
    run('git', ['-C', temporary, 'checkout', '--detach', DSH_SOURCE_SPEC.revision])
    const actual = capture('git', ['rev-parse', 'HEAD'], temporary)
    if (actual !== DSH_SOURCE_SPEC.revision) {
      throw new Error(
        `DSH ref moved: expected ${DSH_SOURCE_SPEC.revision}, received ${actual}`,
      )
    }
    try {
      renameSync(temporary, target)
    } catch (error) {
      if (!existsSync(join(target, '.git'))) throw error
      validateSource(target, DSH_SOURCE_SPEC.revision)
      rmSync(temporary, { recursive: true, force: true })
    }
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}

/** Resolve an explicit development checkout or the pinned release source. */
export function resolveDshSource() {
  if (process.env.DSH_SOURCE !== undefined) {
    const source = resolve(process.env.DSH_SOURCE)
    validateSource(source)
    console.log(`Using DSH source override: ${source}`)
    return source
  }

  const parent = join(root, '.cache', 'dsh-source')
  const target = join(parent, DSH_SOURCE_SPEC.revision.slice(0, 12))
  mkdirSync(parent, { recursive: true })
  if (!existsSync(join(target, '.git'))) acquirePinnedSource(target)
  validateSource(target, DSH_SOURCE_SPEC.revision)
  console.log(
    `Using pinned DSH ${DSH_SOURCE_SPEC.version} (${DSH_SOURCE_SPEC.revision.slice(0, 12)})`,
  )
  return target
}
