/** WorkTree-specific capability routes. */
import * as git from '@dsh-studio/shared/git-core'
import { requireAbsolute } from '@dsh-studio/shared/fs-tree'
import type {
  WorktreeDefaultsResult,
} from '@dsh-studio/shared/worktree-preferences'
import {
  optionalBoolean,
  optionalString,
  requireString,
  CapabilityError,
} from '@dsh-studio/shared/wire'
import type { ApiMethod } from '../routes/types.ts'

export interface WorktreeRouteDependencies {
  cwdScopeOf(payload: unknown): string
  /** Single source for the effective worktree store defaults — the
   *  delegation registry resolves the user override or the channel-aware
   *  data-root default with one consistent fallback. */
  getDefaults(): WorktreeDefaultsResult
}

export function buildWorktreeRoutes(
  dependencies: WorktreeRouteDependencies,
): Record<string, ApiMethod> {
  return {
    'git.worktree-list': (payload) => {
      const cwd = dependencies.cwdScopeOf(payload)
      return git.worktreeList(cwd)
    },
    'git.worktree-defaults': async () => {
      return dependencies.getDefaults()
    },
    'git.worktree-add': (payload) => {
      const cwd = dependencies.cwdScopeOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      const branch = requireString(payload, 'branch')
      const createBranch = optionalBoolean(payload, 'createBranch') === true
      const base = optionalString(payload, 'base')
      return git.worktreeAdd(cwd, path, branch, createBranch, createBranch ? base : undefined)
    },
    'git.worktree-remove-preview': async (payload) => {
      const cwd = dependencies.cwdScopeOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      try {
        const preview = await git.worktreeRemovalPreview(cwd, path)
        return {
          repoRoot: preview.repoRoot,
          path: preview.worktree.path,
          branch: preview.worktree.branch,
          main: preview.worktree.main,
          locked: preview.worktree.locked === true,
          prunable: preview.worktree.prunable ?? null,
          dirty: preview.dirty,
          statusEntries: preview.statusEntries,
        }
      } catch (error) {
        if (error instanceof git.GitCommandError) {
          throw new CapabilityError('git-error', error.message, 409)
        }
        throw error
      }
    },
    'git.worktree-remove': async (payload) => {
      const cwd = dependencies.cwdScopeOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      try {
        return {
          layout: await git.worktreeRemove(cwd, path, optionalBoolean(payload, 'force') === true),
        }
      } catch (error) {
        if (error instanceof git.GitCommandError) {
          throw new CapabilityError('git-error', error.message, 409)
        }
        throw error
      }
    },
  }
}
