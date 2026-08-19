import z from 'schemastery'
import { diff } from '@oh-dsh/shared/git-core'

/** Dedicated user-settings namespace; provider catalogs remain owned by llm-pi-ai. */
export const SOURCE_CONTROL_AI_SETTINGS_NS = 'source-control-ai'

export type SourceControlReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'

export interface SourceControlModelSelection {
  provider: string
  model: string
  reasoningEffort?: SourceControlReasoningEffort
}

export interface SourceControlAiSettings {
  enabled: boolean
  defaultModel?: SourceControlModelSelection
  promptTemplate: string
}

/** Default template deliberately includes only a bounded, allowlisted context. */
export const DEFAULT_COMMIT_MESSAGE_PROMPT = [
  'Write one concise Git commit message for the staged changes.',
  'Use imperative mood. Return only the message, without quotes, markdown, or explanation.',
  '',
  'Repository: {repository}',
  'Branch: {branch}',
  '',
  'Staged patch:',
  '{stagedPatch}',
].join('\n')

/** Settings schema used by the host namespace registration. */
export const SourceControlAiSettingsSchema: z<SourceControlAiSettings> = z.object({
  enabled: z.boolean().default(true),
  defaultModel: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.union([
      z.const('off'),
      z.const('low'),
      z.const('medium'),
      z.const('high'),
      z.const('max'),
    ]),
  }),
  promptTemplate: z.string().max(16_000).default(DEFAULT_COMMIT_MESSAGE_PROMPT),
})

export interface SourceControlAiTemplateValues {
  repository: string
  branch: string
  stagedPatch: string
}

const TEMPLATE_VARIABLES: Readonly<Record<keyof SourceControlAiTemplateValues, true>> = {
  repository: true,
  branch: true,
  stagedPatch: true,
}

/**
 * Render explicitly-supported variables only. Unknown placeholders remain
 * literal, so a typo can never silently remove user-authored prompt content.
 */
export function renderSourceControlAiTemplate(
  template: string,
  values: SourceControlAiTemplateValues,
): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, variable: string) => (
    variable in TEMPLATE_VARIABLES ? values[variable as keyof SourceControlAiTemplateValues] : whole
  ))
}

/** Clamp the staged patch before it can become model input. */
export function boundedStagedPatch(value: string, maxChars = 60_000): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[Patch truncated to ${String(maxChars)} characters.]`
}

export interface SourceControlLlmChunk {
  type: string
  text?: string
  reason?: {
    kind?: string
    failure?: { message?: string }
  }
}

/** Narrow structural seam for the DSH LLM runtime; implementation remains host-owned. */
export interface SourceControlLlm {
  stream(options: {
    provider: string
    model: string
    reasoningEffort?: string
    system?: string
    messages: readonly unknown[]
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<SourceControlLlmChunk>
}

export interface SourceControlGenerationRequest {
  cwd: string
  repository: string
  branch: string
  selection: SourceControlModelSelection
  template: string
}

export interface SourceControlGenerationResult {
  message: string
}

export type SourceControlPatchLoader = (cwd: string) => Promise<string>

async function loadCommitAllPatch(cwd: string): Promise<string> {
  const [staged, unstaged] = await Promise.all([
    diff(cwd, undefined, true, 3),
    diff(cwd, undefined, false, 3),
  ])
  return [staged, unstaged].filter(part => part.trim() !== '').join('\n')
}

/**
 * One workspace-local generation owner. It bounds staged context, normalizes
 * streaming output, and offers one cancellation point per cwd.
 */
export class SourceControlAiGenerator {
  private readonly active = new Map<string, AbortController>()
  private readonly llm: SourceControlLlm
  private readonly loadPatch: SourceControlPatchLoader

  constructor(llm: SourceControlLlm, loadPatch: SourceControlPatchLoader = loadCommitAllPatch) {
    this.llm = llm
    this.loadPatch = loadPatch
  }

  /** Generate a normalized commit message from staged Git context. */
  async generate(request: SourceControlGenerationRequest): Promise<SourceControlGenerationResult> {
    this.cancel(request.cwd)
    const controller = new AbortController()
    this.active.set(request.cwd, controller)
    try {
      // Commit All stages both index and worktree changes, so generation must
      // describe the same complete change set rather than silently omitting
      // currently unstaged files.
      const stagedPatch = boundedStagedPatch(await this.loadPatch(request.cwd))
      if (stagedPatch.trim() === '') throw new Error('there are no changes to describe')
      const prompt = renderSourceControlAiTemplate(request.template, {
        repository: request.repository,
        branch: request.branch,
        stagedPatch,
      })
      let text = ''
      let finish: SourceControlLlmChunk['reason'] | undefined
      for await (const chunk of this.llm.stream({
        provider: request.selection.provider,
        model: request.selection.model,
        ...(request.selection.reasoningEffort === undefined ? {} : { reasoningEffort: request.selection.reasoningEffort }),
        system: 'You write safe, concise Git commit messages from staged diffs.',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens: 160,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') text += chunk.text ?? ''
        if (chunk.type === 'finish') finish = chunk.reason
      }
      if (finish !== undefined && finish.kind !== 'stop') {
        if (finish.kind === 'aborted') throw new Error('commit-message generation was cancelled')
        throw new Error(finish.failure?.message ?? 'commit-message generation failed')
      }
      const message = text.trim().replace(/^['"`]+|['"`]+$/g, '').split(/\r?\n/)[0]?.trim() ?? ''
      if (message === '') throw new Error('the model returned an empty commit message')
      return { message: message.slice(0, 500) }
    } finally {
      if (this.active.get(request.cwd) === controller) this.active.delete(request.cwd)
    }
  }

  /** Cancel the only active generation lane for a workspace. */
  cancel(cwd: string): void {
    const controller = this.active.get(cwd)
    if (controller !== undefined) controller.abort()
  }
}
