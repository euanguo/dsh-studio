/**
 * /capabilities git.* and source-control-ai.* handlers: status/diff/log,
 * commit operations, branch/rebase controls and the Source Control AI
 * generator fast paths. Split from routes.ts.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Context } from '../context-types.ts'
import * as git from '@dsh-studio/shared/git-core'
import {
  optionalBoolean,
  optionalInteger,
  optionalPathList,
  optionalString,
  requireString,
  CapabilityError,
} from '@dsh-studio/shared/wire'
import {
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  type SourceControlAiGenerator,
} from '../source-control-ai.ts'
import { SOURCE_CONTROL_AI_SETTINGS_NS } from '@dsh-studio/shared/capabilities-api'
import {
  gitBlobBase64,
  modelSelectionOf,
  resolveGitPath,
  sourceControlAiSettingsOf,
  type CapabilitiesSettingsFace,
} from './shared.ts'
import type { ApiMethod } from './types.ts'

/** Dependency face for the git route group. */
export interface GitHandlerDeps {
  cwdOf(payload: unknown): { cwd: string }
  ctx: Context
  getSettings(): CapabilitiesSettingsFace | undefined
  getSourceControlAiGenerator(): SourceControlAiGenerator | undefined
}

/** Build the git.* and source-control-ai.* route groups. */
export function buildGitHandlers(deps: GitHandlerDeps): Record<string, ApiMethod> {
  const { cwdOf, ctx, getSettings, getSourceControlAiGenerator } = deps
  return {
    'git.status': async (payload) => {
      const { cwd } = cwdOf(payload)
      // One porcelain v2 subprocess yields isRepo + branch + entries (and
      // upstream/ahead/behind for free); attach per-entry +N/−M counts so the
      // client's change list can render file stats without extra round-trips.
      const [result, worktree, cached, upstream] = await Promise.all([
        git.statusV2(cwd),
        git.numstat(cwd, false).catch(() => []),
        git.numstat(cwd, true).catch(() => []),
        git.readUpstreamStatus(cwd),
      ])
      const statsByPath = new Map(
        [...worktree, ...cached].map(stat => [stat.path, stat] as const),
      )
      const stats = result.entries.map(entry => {
        const found = statsByPath.get(entry.path)
        return found ?? { path: entry.path, additions: 0, deletions: 0 }
      })
      return {
        isRepo: result.isRepo,
        branch: result.branch,
        entries: result.entries,
        stats,
        upstream,
      }
    },
    'git.diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      const raw = optionalString(payload, 'path')
      const path = raw === undefined ? undefined : await resolveGitPath(cwd, raw)
      const context = optionalInteger(payload, 'context', 0, 200)
      return { diff: await git.diff(cwd, path, optionalBoolean(payload, 'staged') === true, context) }
    },
    'git.image-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      const rel = requireString(payload, 'path')
      const staged = optionalBoolean(payload, 'staged') === true
      const abs = await resolveGitPath(cwd, rel)
      const oldData = await gitBlobBase64(cwd, staged ? 'HEAD' : '', rel)
      const newData = staged
        ? await gitBlobBase64(cwd, '', rel)
        : (await readFile(abs)).toString('base64')
      return { oldData, newData }
    },
    'git.stage': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.stage(cwd, optionalPathList(payload))
      return { ok: true }
    },
    'git.unstage': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.unstage(cwd, optionalPathList(payload))
      return { ok: true }
    },
    'git.commit': async (payload) => {
      const { cwd } = cwdOf(payload)
      const message = requireString(payload, 'message')
      await git.commit(cwd, message)
      return { ok: true }
    },
    'git.generate-commit-message': async (payload) => {
      const { cwd } = cwdOf(payload)
      const generator = getSourceControlAiGenerator()
      const settings = getSettings()
      if (generator === undefined || settings === undefined) {
        throw new CapabilityError('settings-rejected', 'Source Control AI is not available in this deployment', 503)
      }
      const [configured, fallback, upstream, root] = await Promise.all([
        settings.get(SOURCE_CONTROL_AI_SETTINGS_NS),
        settings.get('agent-default-model'),
        git.readUpstreamStatus(cwd),
        git.repoRoot(cwd),
      ])
      const configuredSettings = sourceControlAiSettingsOf(configured.value)
      if (configuredSettings?.enabled === false) {
        throw new CapabilityError('settings-rejected', 'Source Control AI is disabled in Settings', 409)
      }
      const selection = modelSelectionOf(configuredSettings?.defaultModel)
        ?? modelSelectionOf(fallback.value)
      if (selection === undefined) {
        throw new CapabilityError('settings-rejected', 'Choose a default model in Settings before generating a commit message', 409)
      }
      if (upstream.branch === null) {
        throw new CapabilityError('git-error', 'cannot generate a commit message from a detached HEAD', 409)
      }
      return generator.generate({
        cwd,
        repository: basename(root),
        branch: upstream.branch,
        selection,
        template: configuredSettings?.promptTemplate ?? DEFAULT_COMMIT_MESSAGE_PROMPT,
      })
    },
    'git.cancel-generate-commit-message': (payload) => {
      const { cwd } = cwdOf(payload)
      getSourceControlAiGenerator()?.cancel(cwd)
      return { ok: true }
    },
    'source-control-ai.models': async () => {
      const settings = getSettings()
      const fallback = settings === undefined ? {} : await settings.get('agent-default-model')
      const groups = await Promise.all(ctx.llm.listProviders().map(async provider => {
        const catalog = await ctx.llm.listModels(provider.id)
        return Promise.all(catalog.map(async model => {
          const resolvedModel = await ctx.llm.resolveModelInfo(provider.id, model.id)
          return {
            provider: provider.id,
            id: model.id,
            name: model.name,
            reasoningEfforts: [...(resolvedModel.reasoning?.efforts ?? [])].map(effort => ({
              id: effort.id,
              name: effort.name,
            })),
          }
        }))
      }))
      return {
        models: groups.flat(),
        defaultModel: (fallback.value ?? {}) as { provider?: string; model?: string; reasoningEffort?: string },
      }
    },
    'git.branch': async (payload) => {
      const { cwd } = cwdOf(payload)
      return git.branches(cwd)
    },
    'git.upstream': async (payload) => {
      const { cwd } = cwdOf(payload)
      return git.readUpstreamStatus(cwd)
    },
    'git.fetch': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.fetch(cwd)
      return { ok: true }
    },
    'git.pull': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.pullFastForward(cwd)
      return { ok: true }
    },
    'git.push': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.push(cwd)
      return { ok: true }
    },
    'git.force-push': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.forcePushWithLease(cwd)
      return { ok: true }
    },
    'git.sync': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.syncFastForward(cwd)
      return { ok: true }
    },
    'git.abort-merge': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.abortMerge(cwd)
      return { ok: true }
    },
    'git.abort-rebase': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.abortRebase(cwd)
      return { ok: true }
    },
    'git.checkout': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.checkout(cwd, requireString(payload, 'branch'))
      return { ok: true }
    },
    'git.log': async (payload) => {
      const { cwd } = cwdOf(payload)
      const count = optionalInteger(payload, 'count', 1, 1000)
      const skip = optionalInteger(payload, 'skip', 0, 100_000)
      return git.log(cwd, count, skip)
    },
    'git.commit-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      return { diff: await git.commitDiff(cwd, requireString(payload, 'hash')) }
    },
    'git.commit-files': async (payload) => {
      const { cwd } = cwdOf(payload)
      return git.commitFiles(cwd, requireString(payload, 'hash'))
    },
    'git.commit-file-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      return {
        diff: await git.commitFileDiff(
          cwd,
          requireString(payload, 'hash'),
          requireString(payload, 'path'),
        ),
      }
    },
    'git.committed-files': async (payload) => {
      const { cwd } = cwdOf(payload)
      const baseRef = await git.upstreamRef(cwd)
      if (baseRef === null) return { baseRef: null, entries: [] }
      return { baseRef, entries: await git.committedFiles(cwd, baseRef) }
    },
    'git.committed-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      const baseRef = requireString(payload, 'baseRef')
      const path = optionalString(payload, 'path')
      return { diff: await git.committedDiff(cwd, baseRef, path) }
    },
    'git.discard': async (payload) => {
      const { cwd } = cwdOf(payload)
      const paths = optionalPathList(payload)
      if (paths === undefined || paths.length === 0) {
        throw new CapabilityError('bad-request', 'discard requires at least one path')
      }
      await git.discard(cwd, await Promise.all(paths.map(raw => resolveGitPath(cwd, raw))))
      return { ok: true }
    },
    // revert/cherry-pick/show stay dormant contract — nothing calls them yet
    // (the source-control surface wiring was cut earlier). The git-core
    // helpers were never removed, so mounting these re-enables the capability
    // as-is.
    'git.revert': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.revert(cwd, requireString(payload, 'hash'))
      return { ok: true }
    },
    'git.cherry-pick': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.cherryPick(cwd, requireString(payload, 'hash'))
      return { ok: true }
    },
    'git.show': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = await resolveGitPath(cwd, requireString(payload, 'path'))
      const rev = requireString(payload, 'rev')
      return { content: await git.show(cwd, rev, path) }
    },
  }
}
