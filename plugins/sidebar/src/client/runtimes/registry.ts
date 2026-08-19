/**
 * Module-level retained runtime registries for the desktop sidebar.
 * Ported from the reference project's `scope/scope-runtimes.ts`.
 *
 * Keyed by `sessionId:cwd` (the plugin's workspace scope). Components fetch
 * runtimes here instead of constructing them: a hit returns the SAME
 * instance with its cached data, so switching between the file browser and
 * the Git panel (or back) renders instantly with zero network. Entries are
 * only disposed on LRU overflow or explicit delete — unmounting a view
 * never clears the cache.
 */
import { ScopedRuntimeRegistry } from '@oh-dsh/shared/runtime'
import {
  WorkspaceExplorerRuntime,
  type WorkspaceExplorerTransport,
} from './explorer-runtime.ts'
import {
  SourceControlRuntime,
  sidebarSourceControlTransport,
} from './source-control-runtime.ts'
import {
  WorkspaceFileRuntime,
  type WorkspaceFileTransport,
} from './file-runtime.ts'
import {
  WorkspaceDiffRuntime,
  type WorkspaceDiffTransport,
} from './diff-runtime.ts'
import { sidebarApi } from '../sidebar-api.ts'
import { resolveSidebarPath } from '@oh-dsh/shared/path'
import { parseGitReviewDiff, type GitReviewFile } from '../diff/git-review-diff.ts'
import { terminalInstanceRegistry } from './terminal-runtime.ts'

/**
 * The runtime scope: the project cwd. Unlike the wire `SidebarScope` in the
 * component contract (a plain `{cwd}`), the retained runtimes key their
 * caches by the concrete cwd — project dimension, so two conversations of the
 * same project share one runtime and switching conversations never refetches.
 */
export interface SidebarScope {
  cwd: string
}

export function sidebarScopeKey(scope: SidebarScope): string {
  return scope.cwd
}

/* ---------- explorer (directory listings) ---------- */

interface ExplorerRuntimeBundle {
  runtime: WorkspaceExplorerRuntime
  cwd: string
}

export const explorerRuntimeRegistry = new ScopedRuntimeRegistry<ExplorerRuntimeBundle>({
  maxEntries: 16,
  dispose: bundle => {
    bundle.runtime.dispose()
  },
})

export function getExplorerRuntime(scope: SidebarScope): WorkspaceExplorerRuntime {
  const scopeKey = sidebarScopeKey(scope)
  const existing = explorerRuntimeRegistry.get(scopeKey)
  if (existing !== undefined && existing.cwd === scope.cwd) {
    explorerRuntimeRegistry.touch(scopeKey)
    return existing.runtime
  }
  if (existing !== undefined) {
    explorerRuntimeRegistry.delete(scopeKey)
  }
  const transport: WorkspaceExplorerTransport = {
    listDirectory: (relativePath, signal) =>
      sidebarApi.fsTree(scope, resolveSidebarPath(scope.cwd, relativePath), signal)
        .then(listing => listing.entries.map(entry => ({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDir,
        }))),
  }
  const runtime = new WorkspaceExplorerRuntime(transport)
  runtime.setWorkspaceRoot(scope.cwd)
  explorerRuntimeRegistry.set(scopeKey, { runtime, cwd: scope.cwd })
  return runtime
}

/* ---------- source control (git panel) ---------- */

interface SourceControlRuntimeBundle {
  runtime: SourceControlRuntime
  cwd: string
}

export const sourceControlRuntimeRegistry = new ScopedRuntimeRegistry<SourceControlRuntimeBundle>({
  maxEntries: 32,
  dispose: bundle => {
    bundle.runtime.dispose()
  },
})

export function getSourceControlRuntime(scope: SidebarScope): SourceControlRuntime {
  const scopeKey = sidebarScopeKey(scope)
  const existing = sourceControlRuntimeRegistry.get(scopeKey)
  if (existing !== undefined && existing.cwd === scope.cwd) {
    sourceControlRuntimeRegistry.touch(scopeKey)
    existing.runtime.setScope(scope)
    return existing.runtime
  }
  if (existing !== undefined) {
    sourceControlRuntimeRegistry.delete(scopeKey)
  }
  const runtime = new SourceControlRuntime({ transport: sidebarSourceControlTransport() })
  runtime.setScope(scope)
  sourceControlRuntimeRegistry.set(scopeKey, { runtime, cwd: scope.cwd })
  return runtime
}

/* ---------- workspace files (previews / file tabs) ---------- */

interface FileRuntimeBundle {
  runtime: WorkspaceFileRuntime
  cwd: string
}

export const fileRuntimeRegistry = new ScopedRuntimeRegistry<FileRuntimeBundle>({
  maxEntries: 16,
  dispose: bundle => {
    bundle.runtime.dispose()
  },
})

export function getFileRuntime(scope: SidebarScope): WorkspaceFileRuntime {
  const scopeKey = sidebarScopeKey(scope)
  const existing = fileRuntimeRegistry.get(scopeKey)
  if (existing !== undefined && existing.cwd === scope.cwd) {
    fileRuntimeRegistry.touch(scopeKey)
    return existing.runtime
  }
  if (existing !== undefined) {
    fileRuntimeRegistry.delete(scopeKey)
  }
  const transport: WorkspaceFileTransport = {
    read: (path, signal) => sidebarApi.fsRead(scope, path, signal).then(result => ({
      kind: result.kind,
      content: result.kind === 'text' ? result.content : null,
      binary: result.kind === 'binary',
      size: result.kind === 'binary' ? result.size : result.content.length,
      truncated: result.truncated,
      ...(result.kind === 'binary' && result.data !== undefined ? { data: result.data } : {}),
    })),
  }
  const runtime = new WorkspaceFileRuntime(transport)
  runtime.setRoot(scope.cwd)
  fileRuntimeRegistry.set(scopeKey, { runtime, cwd: scope.cwd })
  return runtime
}

/* ---------- diff / commit review (center surfaces) ---------- */

interface DiffRuntimeBundle {
  runtime: WorkspaceDiffRuntime
}

export const diffRuntimeRegistry = new ScopedRuntimeRegistry<DiffRuntimeBundle>({
  maxEntries: 16,
  dispose: bundle => {
    bundle.runtime.dispose()
  },
})

export function getDiffRuntime(scope: SidebarScope): WorkspaceDiffRuntime {
  const scopeKey = sidebarScopeKey(scope)
  const existing = diffRuntimeRegistry.get(scopeKey)
  if (existing !== undefined) {
    diffRuntimeRegistry.touch(scopeKey)
    existing.runtime.setScope(scopeKey)
    return existing.runtime
  }
  const transport: WorkspaceDiffTransport = {
    loadWorktreeList: (staged, signal) =>
      sidebarApi.gitDiff(scope, undefined, staged, signal).then(async result => {
        const parsed = parseGitReviewDiff(result.diff)
        if (staged) return parsed
        // Untracked files produce no git diff output — synthesize added-file
        // diffs from their contents so "view all" shows them too. Reads ride
        // the file runtime cache (M6: one file-read path).
        let untrackedFiles: GitReviewFile[] = []
        try {
          const status = await sidebarApi.gitStatus(scope, signal)
          const fileRuntime = getFileRuntime(scope)
          const synthesized: Array<GitReviewFile | null> = await Promise.all(status.entries
            .filter(entry => entry.xy === '??')
            .map(async entry => {
              const absolute = resolveSidebarPath(scope.cwd, entry.path)
              const loaded = await fileRuntime.ensureLoaded(absolute)
              const snapshot = loaded.phase === 'ready' ? loaded.snapshot : null
              if (snapshot === null || snapshot.kind !== 'text' || snapshot.content === null) return null
              const lines = snapshot.content.split('\n')
              return {
                path: entry.path,
                oldPath: null,
                status: 'added' as const,
                additions: lines.length,
                deletions: 0,
                lines: lines.map((content, index) => ({
                  key: `untracked:${entry.path}:${index}`,
                  type: 'addition' as const,
                  content,
                  oldLine: null,
                  newLine: index + 1,
                })),
              }
            }))
          untrackedFiles = synthesized.filter((file): file is GitReviewFile => file !== null)
        } catch (cause) {
          console.warn('[sidebar] failed to synthesize untracked-file diffs', cause)
          untrackedFiles = []
        }
        return [...parsed, ...untrackedFiles]
      }),
    loadWorktreeDoc: (staged, filePath, context, signal) =>
      sidebarApi.gitDiff(scope, filePath, staged, signal, context).then(result => result.diff),
    loadCommitList: (hash, signal) =>
      sidebarApi.gitCommitDiff(scope, hash, signal).then(result => parseGitReviewDiff(result.diff)),
    loadCommitDoc: (hash, filePath, signal) =>
      sidebarApi.gitCommitFileDiff(scope, hash, filePath, signal).then(result => result.diff),
    loadCommittedList: (baseRef, signal) =>
      sidebarApi.gitCommittedDiff(scope, baseRef, undefined, signal)
        .then(result => parseGitReviewDiff(result.diff)),
    loadCommittedDoc: (baseRef, filePath, signal) =>
      sidebarApi.gitCommittedDiff(scope, baseRef, filePath, signal).then(result => result.diff),
  }
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope(scopeKey)
  diffRuntimeRegistry.set(scopeKey, { runtime })
  return runtime
}

/** Dispose every retained runtime (dependency teardown / test reset). */
export function disposeSidebarRuntimes(): void {
  explorerRuntimeRegistry.clear()
  sourceControlRuntimeRegistry.clear()
  fileRuntimeRegistry.clear()
  diffRuntimeRegistry.clear()
  terminalInstanceRegistry.clear()
}
