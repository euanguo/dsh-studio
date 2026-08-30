import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { DSH_SOURCE_SPEC } from './dsh-source.mjs'

const PATCH_DIRECTORY = 'patches/dsh-runtime/'
const RUNTIME_PACKAGE_PREFIX = 'node_modules/@deepseek-ai/dsh-client-ui-layout/'
export const PATCH_FILES = Object.freeze([
  'patches/dsh-runtime/ui-layout-independent-columns.patch',
])
const FORBIDDEN_PATCH_OPERATIONS = /^(?:new file mode|deleted file mode|rename (?:from|to)|copy (?:from|to)|GIT binary patch|Binary files )/mu

function resolveInside(root, relativePath, label) {
  const absolute = resolve(root, ...relativePath.split('/'))
  if (absolute === root || !absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} escapes the project: ${relativePath}`)
  }
  return absolute
}

export function validatePatchPath(path) {
  if (
    path === ''
    || isAbsolute(path)
    || /^[A-Za-z]:/u.test(path)
    || path.includes('\\')
    || !path.startsWith(PATCH_DIRECTORY)
    || !path.endsWith('.patch')
  ) {
    throw new Error(`invalid DSH runtime patch path: ${path}`)
  }
  if (path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`unsafe DSH runtime patch path: ${path}`)
  }
}

export function validatePatchSource(source, patchPath) {
  if (source === '' || !source.endsWith('\n')) {
    throw new Error(`DSH runtime patch ${patchPath} must end with a newline`)
  }
  if (FORBIDDEN_PATCH_OPERATIONS.test(source) || !source.startsWith('diff --git ')) {
    throw new Error(`DSH runtime patch ${patchPath} must only edit existing text files`)
  }
  const headers = [...source.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gmu)]
  if (headers.length === 0) throw new Error(`DSH runtime patch ${patchPath} has no git diff headers`)
  for (const [, oldPath, newPath] of headers) {
    if (
      oldPath !== newPath
      || oldPath !== `${RUNTIME_PACKAGE_PREFIX}lib/client.js`
      || oldPath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`DSH runtime patch ${patchPath} targets an unsupported path`)
    }
    const section = source.slice(source.indexOf(`diff --git a/${oldPath} b/${newPath}`))
    if (!section.includes(`\n--- a/${oldPath}\n`) || !section.includes(`\n+++ b/${newPath}\n`)) {
      throw new Error(`DSH runtime patch ${patchPath} has an incomplete file header`)
    }
  }
}

function gitApply(packageRoot, patchPath, check, reverse = false) {
  const args = [
    'apply',
    ...(check ? ['--check'] : []),
    ...(reverse ? ['--reverse'] : []),
    '--no-index',
    '--whitespace=error-all',
    '-p4',
    patchPath,
  ]
  const result = spawnSync('git', args, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: 'true',
      GIT_CEILING_DIRECTORIES: dirname(resolve(packageRoot)),
    },
  })
  if (result.error !== undefined) throw result.error
  return {
    detail: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    status: result.status,
  }
}

function runGitApply(packageRoot, patchPath, check, reverse = false) {
  const result = gitApply(packageRoot, patchPath, check, reverse)
  if (result.status !== 0) {
    throw new Error(`DSH runtime patch ${reverse ? 'verification' : 'application'} failed${result.detail === '' ? '' : `:\n${result.detail}`}`)
  }
}

/**
 * Read-only forward/reverse applicability probe for one committed runtime
 * patch against one staged layout package root (scripts/bump-dsh.mjs's
 * planner). Runs `git apply --check` in each direction and applies nothing:
 * `forward.status === 0` means the patch would apply cleanly; otherwise
 * `reverse.status === 0` means it is already applied. Both failing is a
 * re-pin conflict.
 */
export function checkRuntimePatch(packageRoot, patchPath) {
  const forward = gitApply(packageRoot, patchPath, true)
  if (forward.status === 0) return { forward, reverse: null }
  return { forward, reverse: gitApply(packageRoot, patchPath, true, true) }
}

/** Apply the committed npm-runtime patches to one freshly staged runtime. */
export function applyDshRuntimePatches(runtimeRoot, projectRoot) {
  if (DSH_SOURCE_SPEC.source !== 'npm') {
    console.log('Skipping npm-only DSH runtime patches for Git source mode')
    return
  }
  const packageManifestPath = join(
    runtimeRoot,
    'node_modules',
    '@deepseek-ai',
    'dsh-client-ui-layout',
    'package.json',
  )
  if (!lstatSync(packageManifestPath, { throwIfNoEntry: false })) {
    throw new Error(`staged DSH layout package is missing: ${packageManifestPath}`)
  }
  const packageRoot = dirname(realpathSync(packageManifestPath))
  const manifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-layout') {
    throw new Error(`unexpected DSH layout package: ${String(manifest.name)}`)
  }
  if (manifest.version !== DSH_SOURCE_SPEC.version) {
    throw new Error(
      `DSH layout patch expects ${DSH_SOURCE_SPEC.version}, received ${String(manifest.version)}`,
    )
  }
  for (const relativePath of PATCH_FILES) {
    validatePatchPath(relativePath)
    const patchPath = resolveInside(projectRoot, relativePath, 'DSH runtime patch')
    let source = readFileSync(patchPath, 'utf8')
    // Normalize CRLF checkouts (Windows runners default core.autocrlf=true)
    // back to LF before validation and before `git apply` consumes the file.
    const normalized = source.replace(/\r\n/g, '\n')
    if (normalized !== source) {
      writeFileSync(patchPath, normalized, 'utf8')
      source = normalized
    }
    validatePatchSource(source, relativePath)
    const forward = gitApply(packageRoot, patchPath, true)
    if (forward.status === 0) {
      runGitApply(packageRoot, patchPath, false)
      runGitApply(packageRoot, patchPath, true, true)
      continue
    }
    const reverse = gitApply(packageRoot, patchPath, true, true)
    if (reverse.status === 0) {
      console.log(`Skipping already-applied DSH runtime patch: ${relativePath}`)
      continue
    }
    throw new Error(
      `DSH runtime patch application failed${forward.detail === '' ? '' : `:\n${forward.detail}`}`,
    )
  }
}
