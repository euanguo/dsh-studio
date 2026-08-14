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
import { ScopedRuntimeRegistry } from '../../../../shared/runtime.ts'
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
import type { BetterSidebarScope } from '../better-sidebar-api.ts'
import { betterSidebarApi } from '../better-sidebar-api.ts'

export interface SidebarScope {
  sessionId: string
  cwd: string
}

export function sidebarScopeKey(scope: SidebarScope): string {
  return `${scope.sessionId}:${scope.cwd}`
}

/** cwd-relative path → absolute path for the fs.tree/fs.read wire calls. */
export function resolveSidebarPath(cwd: string, relativePath: string): string {
  if (relativePath === '') return cwd
  const root = cwd.replace(/[/\\]+$/, '')
  const relative = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/')
  return `${root}/${relative}`
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
      betterSidebarApi.fsTree(scope, resolveSidebarPath(scope.cwd, relativePath), signal)
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
    read: (path, signal) => betterSidebarApi.fsRead(scope, path, signal).then(result => ({
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

/** Dispose every retained runtime (dependency teardown / test reset). */
export function disposeSidebarRuntimes(): void {
  explorerRuntimeRegistry.clear()
  sourceControlRuntimeRegistry.clear()
  fileRuntimeRegistry.clear()
}

export type { BetterSidebarScope }
