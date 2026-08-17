/**
 * Workspace-level Git operations for the /sidebar/api workspace.* methods
 * (fork addition; the upstream host has no equivalent).
 *
 * These operate on a bare absolute cwd — the directory IS the scope, with
 * no session binding — and cover the facts snapshot (repository identity,
 * ahead/behind, remote presence) plus the two mutations the source-control
 * panel routes here (branch creation and push). Every other git operation
 * stays in the session-scoped git.* methods over `shared/git-core.ts`.
 */
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { runGit } from '@oh-dsh/shared/git-core'
import type {
  SidebarWorkspaceFacts,
  SidebarWorkspaceMutation,
  SidebarWorkspaceMutationResponse,
} from '@oh-dsh/shared/sidebar-api'

export type {
  SidebarWorkspaceFacts,
  SidebarWorkspaceMutation,
  SidebarWorkspaceMutationResponse,
} from '@oh-dsh/shared/sidebar-api'

export { isSidebarWorkspaceMutation } from '@oh-dsh/shared/sidebar-api'

function normalizeWorkspacePath(raw: string | undefined): string {
  const cwd = raw?.trim()
  if (cwd === undefined || cwd === '' || cwd.length > 4096
    || !isAbsolute(cwd)) {
    throw new Error('invalid workspace path')
  }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error('workspace directory does not exist')
  }
  return cwd
}

async function git(
  args: readonly string[],
  cwd: string,
  timeout = 20_000,
): Promise<string> {
  // Shared runGit: -C <cwd>, --no-pager, color.ui=false, core.quotePath=false,
  // GIT_OPTIONAL_LOCKS=0, timeout + output-limit guards.
  return runGit(cwd, args, { timeoutMs: timeout, maxOutputBytes: 8 * 1024 * 1024 })
}

function parseAheadBehind(output: string): { ahead: number; behind: number } {
  const [behindRaw, aheadRaw] = output.trim().split(/\s+/)
  const behind = Number(behindRaw)
  const ahead = Number(aheadRaw)
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  }
}

async function repositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--show-toplevel'], cwd)).trim() || null
  } catch {
    return null
  }
}

export async function readWorkspaceFacts(
  rawCwd: string | undefined,
): Promise<SidebarWorkspaceFacts> {
  const cwd = normalizeWorkspacePath(rawCwd)
  const root = await repositoryRoot(cwd)
  if (root === null) {
    return {
      kind: 'directory',
      cwd,
      root: cwd,
      name: basename(cwd) || cwd,
      ahead: 0,
      behind: 0,
      hasRemote: false,
    }
  }

  const remotes = await git(['remote'], root)
  let counts = { ahead: 0, behind: 0 }
  try {
    counts = parseAheadBehind(await git([
      'rev-list',
      '--left-right',
      '--count',
      '@{upstream}...HEAD',
    ], root))
  } catch {
    // A local-only branch has no upstream yet.
  }
  return {
    kind: 'repository',
    cwd,
    root,
    name: basename(root) || root,
    ...counts,
    hasRemote: remotes.trim() !== '',
  }
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > maxLength
    || normalized.includes('\0')) {
    throw new Error(`invalid ${label}`)
  }
  return normalized
}

export async function mutateWorkspace(
  rawCwd: string | undefined,
  mutation: SidebarWorkspaceMutation,
): Promise<SidebarWorkspaceMutationResponse> {
  const before = await readWorkspaceFacts(rawCwd)
  if (before.kind !== 'repository') {
    throw new Error('workspace is not a Git repository')
  }

  let message: string
  if (mutation.action === 'create-branch') {
    const branch = requiredText(mutation.branch, 'branch', 240)
    await git(['check-ref-format', '--branch', branch], before.root)
    await git(['switch', '-c', branch], before.root)
    message = `Created ${branch}`
  } else {
    if (!before.hasRemote) throw new Error('repository has no Git remote')
    let hasUpstream = true
    try {
      await git([
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
      ], before.root)
    } catch {
      hasUpstream = false
    }
    if (hasUpstream) {
      await git(['push'], before.root, 120_000)
    } else {
      const branch = (await git([
        'branch',
        '--show-current',
      ], before.root)).trim()
      if (branch === '') throw new Error('cannot push a detached HEAD')
      await git([
        'push',
        '--set-upstream',
        'origin',
        branch,
      ], before.root, 120_000)
    }
    message = 'Pushed the current branch'
  }

  return { message, facts: await readWorkspaceFacts(before.root) }
}
