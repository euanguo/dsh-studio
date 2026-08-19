import type {
  SidebarGitConflictOperation,
  SidebarGitUpstreamStatus,
} from '@dsh-studio/shared/sidebar-api'

/** Every source-control operation exposed by the commit-area controls. */
export type SourceControlActionKind =
  | 'commit'
  | 'publish'
  | 'push'
  | 'force-push'
  | 'pull'
  | 'sync'
  | 'fetch'
  | 'abort-merge'
  | 'abort-rebase'

export type SourceControlActionDisabledReason =
  | 'busy'
  | 'no-changes'
  | 'missing-message'
  | 'conflict'
  | 'no-remote'
  | 'no-upstream'
  | 'detached-head'
  | 'up-to-date'

export interface SourceControlAction {
  kind: SourceControlActionKind
  disabled: boolean
  disabledReason?: SourceControlActionDisabledReason
  danger?: boolean
}

/** Facts required to resolve the commit-area controls; all are host-derived. */
export interface SourceControlActionInputs {
  hasChanges: boolean
  hasUnresolvedConflicts: boolean
  hasMessage: boolean
  busy: boolean
  upstream: SidebarGitUpstreamStatus | undefined
}

export interface SourceControlActionState {
  primary: SourceControlAction
  dropdown: readonly SourceControlAction[]
}

function disabled(
  kind: SourceControlActionKind,
  reason: SourceControlActionDisabledReason,
  danger = false,
): SourceControlAction {
  return { kind, disabled: true, disabledReason: reason, ...(danger ? { danger: true } : {}) }
}

function enabled(kind: SourceControlActionKind, danger = false): SourceControlAction {
  return { kind, disabled: false, ...(danger ? { danger: true } : {}) }
}

function commitAction(inputs: SourceControlActionInputs): SourceControlAction {
  if (inputs.busy) return disabled('commit', 'busy')
  if (inputs.hasUnresolvedConflicts || (inputs.upstream?.conflictOperation !== null && inputs.upstream?.conflictOperation !== undefined)) {
    return disabled('commit', 'conflict')
  }
  if (!inputs.hasChanges) return disabled('commit', 'no-changes')
  if (!inputs.hasMessage) return disabled('commit', 'missing-message')
  return enabled('commit')
}

function upstreamAction(
  kind: SourceControlActionKind,
  inputs: SourceControlActionInputs,
  enabledWhen: boolean,
): SourceControlAction {
  if (inputs.busy) return disabled(kind, 'busy')
  if (inputs.upstream === undefined || !inputs.upstream.hasUpstream) return disabled(kind, 'no-upstream')
  return enabledWhen ? enabled(kind) : disabled(kind, 'up-to-date')
}

function abortAction(operation: SidebarGitConflictOperation, inputs: SourceControlActionInputs): SourceControlAction | null {
  if (operation === null || inputs.upstream?.conflictOperation !== operation) return null
  const kind = operation === 'merge' ? 'abort-merge' : 'abort-rebase'
  return inputs.busy ? disabled(kind, 'busy', true) : enabled(kind, true)
}

/**
 * Resolve the complete commit-area control state from one authoritative Git
 * snapshot. React never makes Git policy decisions itself; it only projects
 * this result and dispatches the selected action.
 */
export function resolveSourceControlActions(inputs: SourceControlActionInputs): SourceControlActionState {
  const commit = commitAction(inputs)
  const upstream = inputs.upstream
  const operation = upstream?.conflictOperation ?? null
  const publish = inputs.busy
    ? disabled('publish', 'busy')
    : upstream === undefined || upstream.hasUpstream
      ? disabled('publish', 'no-upstream')
      : !upstream.hasRemote
        ? disabled('publish', 'no-remote')
        : upstream.branch === null
          ? disabled('publish', 'detached-head')
          : enabled('publish')
  const push = upstreamAction('push', inputs, (upstream?.ahead ?? 0) > 0)
  const forcePush = upstreamAction('force-push', inputs, true)
  const pull = upstreamAction('pull', inputs, (upstream?.behind ?? 0) > 0)
  const sync = upstreamAction('sync', inputs, (upstream?.ahead ?? 0) > 0 || (upstream?.behind ?? 0) > 0)
  const fetch = inputs.busy
    ? disabled('fetch', 'busy')
    : upstream === undefined || !upstream.hasRemote
      ? disabled('fetch', 'no-remote')
      : enabled('fetch')
  const abort = abortAction(operation, inputs)

  let primary = commit
  if (!inputs.hasChanges && operation === null) {
    if (upstream !== undefined && !upstream.hasUpstream && upstream.hasRemote && upstream.branch !== null) primary = publish
    else if ((upstream?.ahead ?? 0) > 0 && (upstream?.behind ?? 0) > 0) primary = sync
    else if ((upstream?.behind ?? 0) > 0) primary = pull
    else if ((upstream?.ahead ?? 0) > 0) primary = push
  }

  return {
    primary,
    dropdown: [
      commit,
      publish,
      push,
      forcePush,
      pull,
      sync,
      fetch,
      ...(abort === null ? [] : [abort]),
    ],
  }
}
