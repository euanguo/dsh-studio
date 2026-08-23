/** Model-facing WorkTree topology, lifecycle and delegation tools. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from './context-types.ts'
import { WorktreeDelegationRegistry } from './worktree-orchestration.ts'

function textRender(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function parentSessionIdOf(exec: ToolRunContext): string {
  const id = exec.agent?.session.id
  if (id === undefined) throw new Error('WorkTree tools require a live initiating agent')
  return String(id)
}

function register(
  ctx: Context,
  tool: ReturnType<typeof defineTool>,
  disposers: Array<() => void>,
): void {
  disposers.push(ctx.tools.register(tool))
}

export function registerWorktreeTools(
  ctx: Context,
  registry: WorktreeDelegationRegistry,
): () => void {
  const disposers: Array<() => void> = []

  register(ctx, defineTool({
    name: 'worktree_list',
    description: 'List visible Git projects, linked WorkTrees, branches, and sessions. The result is limited to WorkSpaces visible to the initiating session.',
    parameters: {
      repo_cwd: { type: 'string', description: 'Optional visible repository or WorkTree path to filter.' },
    },
    output: {
      schema: { type: 'array' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    async execute(args: { repo_cwd?: string }, exec) {
      exec.signal.throwIfAborted()
      return registry.listTopology(parentSessionIdOf(exec), args.repo_cwd)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_branches',
    description: 'List branches for a visible repository or the initiating session WorkTree.',
    parameters: {
      repo_cwd: { type: 'string', description: 'Optional visible repository or WorkTree path.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    async execute(args: { repo_cwd?: string }, exec) {
      exec.signal.throwIfAborted()
      return registry.branches(parentSessionIdOf(exec), args.repo_cwd)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_create',
    description: 'Create a linked Git WorkTree from a visible repository, register it as a DSH Workspace, and return its branch and session-ready path.',
    parameters: {
      repo_cwd: { type: 'string', description: 'Visible repository or WorkTree path; defaults to the initiating session cwd.' },
      path: { type: 'string', description: 'Optional destination below the DSH Studio WorkTree store.' },
      branch: { type: 'string', required: true, description: 'Existing branch to attach, or the new branch name when create_branch=true.' },
      create_branch: { type: 'boolean', description: 'Create branch instead of attaching an existing branch.' },
      base: { type: 'string', description: 'Optional commit-ish start point for a new branch.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    async execute(args: { repo_cwd?: string; path?: string; branch: string; create_branch?: boolean; base?: string }, exec) {
      exec.signal.throwIfAborted()
      return registry.createWorktree(parentSessionIdOf(exec), {
        branch: args.branch,
        ...(args.repo_cwd === undefined ? {} : { repoCwd: args.repo_cwd }),
        ...(args.path === undefined ? {} : { path: args.path }),
        ...(args.create_branch === undefined ? {} : { createBranch: args.create_branch }),
        ...(args.base === undefined ? {} : { base: args.base }),
      })
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_remove',
    description: 'Remove one visible linked WorkTree after fresh Git and active-session checks. The main WorkTree and dirty/locked trees are refused unless force is explicitly requested.',
    parameters: {
      repo_cwd: { type: 'string', required: true, description: 'Visible repository or WorkTree path used for Git resolution.' },
      path: { type: 'string', required: true, description: 'Visible linked WorkTree path to remove.' },
      force: { type: 'boolean', description: 'Force removal of a dirty or locked WorkTree.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    async execute(args: { repo_cwd: string; path: string; force?: boolean }, exec) {
      exec.signal.throwIfAborted()
      return registry.removeWorktree(parentSessionIdOf(exec), args.repo_cwd, args.path, args.force === true)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_status',
    description: 'Read Git branch and status facts for one visible WorkTree.',
    parameters: {
      path: { type: 'string', required: true, description: 'Visible WorkTree path.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    async execute(args: { path: string }, exec) {
      exec.signal.throwIfAborted()
      return registry.status(parentSessionIdOf(exec), args.path)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_delegate',
    description: 'Start an independent Agent conversation in a visible WorkTree. It returns immediately; the initiating conversation receives a lifecycle callback when the WorkTree Agent settles.',
    parameters: {
      worktree_path: { type: 'string', required: true, description: 'Visible WorkTree path.' },
      prompt: { type: 'string', required: true, description: 'Task for the WorkTree Agent.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    async execute(args: { worktree_path: string; prompt: string }, exec) {
      exec.signal.throwIfAborted()
      if (args.prompt.trim() === '') throw new Error('prompt must not be empty')
      return registry.start(parentSessionIdOf(exec), args.worktree_path, args.prompt)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_delegate_status',
    description: 'Read WorkTree delegation state for the initiating conversation, or list all of its delegations when delegation_id is omitted.',
    parameters: {
      delegation_id: { type: 'string', description: 'Optional delegation id returned by worktree_delegate.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    execute(args: { delegation_id?: string }, exec) {
      const parentId = parentSessionIdOf(exec)
      return args.delegation_id === undefined
        ? registry.list(parentId)
        : registry.get(parentId, args.delegation_id)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_delegate_wait',
    description: 'Wait without polling for one WorkTree delegation to settle, up to the supplied bounded timeout.',
    parameters: {
      delegation_id: { type: 'string', required: true, description: 'Delegation id returned by worktree_delegate.' },
      timeout_ms: { type: 'integer', description: 'Maximum wait in milliseconds, capped at five minutes.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    execute(args: { delegation_id: string; timeout_ms?: number }, exec) {
      exec.signal.throwIfAborted()
      return registry.wait(parentSessionIdOf(exec), args.delegation_id, args.timeout_ms ?? 120_000)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_delegate_stop',
    description: 'Stop one running WorkTree delegation owned by the initiating conversation.',
    parameters: {
      delegation_id: { type: 'string', required: true, description: 'Delegation id returned by worktree_delegate.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    execute(args: { delegation_id: string }, exec) {
      exec.signal.throwIfAborted()
      return registry.stop(parentSessionIdOf(exec), args.delegation_id)
    },
  }), disposers)

  register(ctx, defineTool({
    name: 'worktree_delegate_result',
    description: 'Read the final result and stop reason for a WorkTree delegation owned by the initiating conversation.',
    parameters: {
      delegation_id: { type: 'string', required: true, description: 'Delegation id returned by worktree_delegate.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(JSON.stringify(value)),
    },
    execute(args: { delegation_id: string }, exec) {
      exec.signal.throwIfAborted()
      return registry.get(parentSessionIdOf(exec), args.delegation_id)
    },
  }), disposers)

  const stopApproval = ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'worktree_remove') return next()
    return {
      kind: 'ask',
      reason: 'Remove the selected Git WorkTree and its DSH Workspace registration?'
    }
  })
  disposers.push(stopApproval)
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
