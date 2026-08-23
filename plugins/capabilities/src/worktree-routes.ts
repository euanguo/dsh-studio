/** WorkTree-specific capability routes. */
import * as git from '@dsh-studio/shared/git-core'
import { LEFT_RAIL_SETTINGS_NS } from '@dsh-studio/shared/left-rail-preferences'
import { requireAbsolute } from '@dsh-studio/shared/fs-tree'
import {
  resolveDefaultWorktreeRoot,
  sanitizeWorktreeDir,
  type WorktreeDefaultsResult,
} from '@dsh-studio/shared/worktree-preferences'
import {
  optionalBoolean,
  optionalString,
  requireString,
  CapabilityError,
} from '@dsh-studio/shared/wire'

export type WorktreeRoute = (payload: unknown) => Promise<unknown> | unknown

export interface WorktreeSettingsFace {
  get(ns: string): Promise<{ value?: unknown; revision?: number }> | { value?: unknown; revision?: number }
}

export interface WorktreeRouteDependencies {
  cwdScopeOf(payload: unknown): string
  getSettings(): WorktreeSettingsFace | undefined
}

export function buildWorktreeRoutes(
  dependencies: WorktreeRouteDependencies,
): Record<string, WorktreeRoute> {
  return {
    'git.worktree-list': (payload) => {
      const cwd = dependencies.cwdScopeOf(payload)
      return git.worktreeList(cwd)
    },
    'git.worktree-defaults': async () => {
      const settings = dependencies.getSettings()
      let dir: string | undefined
      let nest = true
      if (settings !== undefined) {
        const view = await settings.get(LEFT_RAIL_SETTINGS_NS)
        const record = (typeof view.value === 'object' && view.value !== null
          ? view.value
          : {}) as Record<string, unknown>
        dir = sanitizeWorktreeDir(record.worktreeDir)
        if (typeof record.nestWorktrees === 'boolean') nest = record.nestWorktrees
      }
      return {
        root: dir ?? resolveDefaultWorktreeRoot(process.env, process.env.HOME ?? process.cwd()),
        nest,
        custom: dir !== undefined,
      } satisfies WorktreeDefaultsResult
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
