import { useRef, useState } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import {
  Button,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconChevronDown,
  IconGitBranch,
  IconGitCommit,
  IconPlayerStop,
  IconSparkles,
} from '@dsh-studio/shared/tabler-icons'
import type { WorkspaceMessage } from '../i18n.ts'
import type {
  SourceControlAction,
  SourceControlActionKind,
  SourceControlActionState,
} from './source-control-actions.ts'
import { Textarea } from '@dsh-studio/shared/ui'
import type { SourceControlOperationState } from './source-control-action-controller.ts'

export interface CommitAreaProps {
  branch: string | null
  branches: readonly string[]
  message: string
  actions: SourceControlActionState
  operation: SourceControlOperationState
  canGenerate: boolean
  generating: boolean
  generationError: string | null
  t: Translate<WorkspaceMessage>
  onMessageChange(message: string): void
  onAction(kind: SourceControlActionKind): void
  onCheckout(branch: string): void
  onGenerate(): void
  onCancelGenerate(): void
}

function actionLabel(action: SourceControlActionKind, t: Translate<WorkspaceMessage>): string {
  switch (action) {
    case 'commit': return t('workspace.commit-all')
    case 'publish': return t('workspace.commit-publish')
    case 'push': return t('workspace.push')
    case 'force-push': return t('workspace.commit-force-push')
    case 'pull': return t('workspace.commit-pull')
    case 'sync': return t('workspace.commit-sync')
    case 'fetch': return t('workspace.commit-fetch')
    case 'abort-merge': return t('workspace.commit-abort-merge')
    case 'abort-rebase': return t('workspace.commit-abort-rebase')
  }
}

function actionDisabledReason(
  action: SourceControlAction,
  t: Translate<WorkspaceMessage>,
): string | undefined {
  if (action.disabledReason === undefined) return undefined
  switch (action.disabledReason) {
    case 'busy': return t('workspace.commit-action-busy')
    case 'no-changes': return t('workspace.commit-action-no-changes')
    case 'missing-message': return t('workspace.commit-action-message-required')
    case 'conflict': return t('workspace.commit-action-conflict')
    case 'no-remote': return t('workspace.commit-action-no-remote')
    case 'no-upstream': return t('workspace.commit-action-no-upstream')
    case 'detached-head': return t('workspace.commit-action-detached')
    case 'up-to-date': return t('workspace.commit-action-up-to-date')
  }
}

function menuEntry(action: SourceControlAction, t: Translate<WorkspaceMessage>, busy: boolean): MenuEntry {
  return {
    id: action.kind,
    label: actionLabel(action.kind, t),
    disabled: busy || action.disabled,
    ...(action.danger === true ? { danger: true } : {}),
  }
}

/**
 * Commit-area presentation. All Git policy arrives through `actions`; this
 * module only renders controls and reports user gestures to its owner.
 */
export function CommitArea(props: CommitAreaProps): JSX.Element {
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const branchButtonRef = useRef<HTMLButtonElement | null>(null)
  const actionButtonRef = useRef<HTMLSpanElement | null>(null)
  const primaryReason = actionDisabledReason(props.actions.primary, props.t)
  const busy = props.operation.phase === 'running'
  const actionItems = props.actions.dropdown.map(action => menuEntry(action, props.t, busy))

  return (
    <section className="dsh-studio-commit-area">
      <div className="dsh-studio-commit-branch-row">
        <button
          ref={branchButtonRef}
          type="button"
          className="dsh-studio-branch-picker"
          aria-label={props.t('workspace.current-branch')}
          aria-expanded={branchMenuOpen}
          disabled={busy}
          onClick={() => { setBranchMenuOpen(value => !value) }}
        >
          <span className="dsh-studio-workspace-fact-icon"><IconGitBranch size={16} /></span>
          <span className="dsh-studio-branch-picker-name">{props.branch ?? ''}</span>
          <IconChevronDown size={14} className="dsh-studio-workspace-chevron" />
        </button>
        <span className="dsh-studio-commit-area-spacer" />
        <Button
          variant="ghost"
          size="sm"
          disabled={!props.canGenerate || busy || props.generating}
          title={props.t('workspace.commit-generate')}
          aria-label={props.t('workspace.commit-generate')}
          onClick={props.onGenerate}
        >
          <IconSparkles size={15} />
        </Button>
      </div>
      <div className="dsh-studio-commit-message-wrap">
        <Textarea
          value={props.message}
          placeholder={props.t('workspace.commit-message')}
          aria-label={props.t('workspace.commit-message')}
          aria-busy={props.generating || busy || undefined}
          disabled={busy}
          onChange={event => { props.onMessageChange(event.currentTarget.value) }}
        />
        {props.generating && (
          <Button
            variant="ghost"
            size="sm"
            className="dsh-studio-commit-cancel-generation"
            title={props.t('workspace.commit-generation-cancel')}
            aria-label={props.t('workspace.commit-generation-cancel')}
            onClick={props.onCancelGenerate}
          ><IconPlayerStop size={14} /></Button>
        )}
      </div>
      {props.generationError !== null && <small role="alert" className="dsh-studio-commit-error">{props.generationError}</small>}
      {props.operation.phase === 'error' && <small role="alert" className="dsh-studio-commit-error">{props.operation.message}</small>}
      <div className="dsh-studio-commit-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={props.actions.primary.disabled || busy}
          aria-label={actionLabel(props.actions.primary.kind, props.t)}
          title={primaryReason}
          onClick={() => { props.onAction(props.actions.primary.kind) }}
        >
          <IconGitCommit size={14} />
          {actionLabel(props.actions.primary.kind, props.t)}
        </Button>
        <span ref={actionButtonRef} className="dsh-studio-commit-action-menu-anchor">
          <Button
            variant="outline"
            size="sm"
            aria-label={props.t('workspace.commit-actions')}
            aria-expanded={actionMenuOpen && !busy}
            disabled={busy}
            onClick={() => { setActionMenuOpen(value => !value) }}
          ><IconChevronDown size={14} /></Button>
          <Menu
            open={actionMenuOpen && !busy}
            anchor={null}
            portal
            getAnchorRect={() => actionButtonRef.current?.getBoundingClientRect() ?? null}
            items={actionItems}
            onSelect={id => {
              setActionMenuOpen(false)
              props.onAction(id as SourceControlActionKind)
            }}
            onClose={() => { setActionMenuOpen(false) }}
          />
        </span>
      </div>
      <Menu
        open={branchMenuOpen}
        anchor={null}
        portal
        getAnchorRect={() => branchButtonRef.current?.getBoundingClientRect() ?? null}
        items={props.branches.map(branch => ({ id: branch, label: branch }))}
        selectedId={props.branch ?? undefined}
        onSelect={branch => {
          setBranchMenuOpen(false)
          if (branch !== props.branch) props.onCheckout(branch)
        }}
        onClose={() => { setBranchMenuOpen(false) }}
      />
    </section>
  )
}
