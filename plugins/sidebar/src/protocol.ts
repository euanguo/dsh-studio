/**
 * UI-facing view types for the sidebar panels. The workspace Git facts and
 * mutation shapes are wire contracts owned by @dsh-studio/shared
 * (`CapabilitiesWorkspace*`) and served through /capabilities/api; they are aliased
 * here under their historical names so the panel code keeps one import
 * site.
 */
import type {
  CapabilitiesWorkspaceFacts,
  CapabilitiesWorkspaceMutation,
  CapabilitiesWorkspaceMutationResponse,
} from '@dsh-studio/shared/capabilities-api'

export type {
  CapabilitiesWorkspaceFacts as WorkspaceFacts,
  CapabilitiesWorkspaceMutation as WorkspaceHostMutation,
  CapabilitiesWorkspaceMutationResponse as WorkspaceHostMutationResponse,
} from '@dsh-studio/shared/capabilities-api'
export type WorkspaceFileKind = 'directory' | 'file' | 'symlink'

export interface WorkspaceFileEntry {
  kind: WorkspaceFileKind
  name: string
  path: string
  size: number | null
}

export type WorkspaceFilesResponse = {
  kind: 'directory'
  cwd: string
  path: string
  parent: string | null
  entries: WorkspaceFileEntry[]
  truncated: boolean
} | {
  kind: 'file'
  cwd: string
  path: string
  parent: string
  content: string | null
  binary: boolean
  size: number
  truncated: boolean
}

export type WorkspaceChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

export interface WorkspaceChange {
  path: string
  oldPath: string | null
  status: WorkspaceChangeStatus
  staged: boolean
  /** Per-file `git diff --numstat` counts (0 when unavailable/binary). */
  additions: number
  deletions: number
}

export interface WorkspaceSnapshot extends CapabilitiesWorkspaceFacts {
  branch: string | null
  branches: string[]
  changes: WorkspaceChange[]
}

export type WorkspaceMutation = {
  action: 'checkout'
  branch: string
} | {
  action: 'create-branch'
  branch: string
} | {
  action: 'commit'
  message: string
} | {
  action: 'push'
}
