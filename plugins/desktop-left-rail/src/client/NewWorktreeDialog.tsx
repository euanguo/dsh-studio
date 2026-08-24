/**
 * New-worktree creation dialog: branch picker, base-branch seeding, host
 * store-root default path and the physical create + workspace registration
 * flow. Split from WorkspaceBrowser.tsx.
 */
import { useEffect, useState } from 'react'
import {
  Button,
  Menu,
  Modal,
  IconChevronDownOutline14,
  IconFolderClose16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { FieldError } from '@dsh-studio/shared/ui'
import { cn } from './shim/cn.ts'
import { WorkspaceBrowserCss as css } from './styles.js'
import {
  computeWorktreeLocation,
  type WorktreeDefaultsResult,
} from '@dsh-studio/shared/worktree-preferences'
import type { WorkspaceBrowserProps } from './contract/slots.ts'

/** The dialog target computed by the browser when a row asks for a new worktree. */
export interface NewWtTarget {
  repoRoot: string
  label: string
  currentBranch: string | null
  existing: { label: string; branch: string | null }[]
}

type RowTranslate = WorkspaceBrowserProps['t']

export function NewWorktreeDialog({
  target,
  t,
  fetchDefaults,
  fetchBranches,
  createWorktree,
  registerWorkspace,
  onCreated,
  onClose,
}: {
  /** Open target; null closes the dialog. */
  target: NewWtTarget | null
  t: RowTranslate
  fetchDefaults: () => Promise<WorktreeDefaultsResult>
  fetchBranches: (repoRoot: string) => Promise<{ names: string[] }>
  createWorktree: (repoRoot: string, path: string, branch: string, isNewBranch: boolean, base?: string) => Promise<unknown>
  registerWorkspace: (path: string) => Promise<unknown>
  onCreated: () => void
  onClose: () => void
}): JSX.Element {
  /** Host-resolved worktree store root + nesting for the open dialog (null = resolving/unavailable). */
  const [defaults, setDefaults] = useState<WorktreeDefaultsResult | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [pickBranch, setPickBranch] = useState('__new__')
  const [newBranch, setNewBranch] = useState('')
  /** New-branch start point (base branch); only meaningful in new-branch mode. */
  const [base, setBase] = useState('')
  const [baseMenuOpen, setBaseMenuOpen] = useState(false)
  const [path, setPath] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (target === null) return
    setBranches([])
    setPickBranch('__new__')
    setNewBranch('')
    // New-branch start point: the repo's current main branch until the
    // branch list lands (then it is pinned to that branch if still present).
    setBase(target.currentBranch ?? '')
    setPath('')
    setError(null)
    // Refresh the host-resolved store root/nesting: settings-page edits apply
    // to the very next dialog without a reload (the host is the resolution
    // authority; the renderer never recomputes the default root).
    setDefaults(null)
    fetchDefaults().then(defaults => { setDefaults(defaults) }).catch(() => {
      // Leave null: the legacy repo-sibling default still serves the dialog.
    })
    fetchBranches(target.repoRoot).then(({ names }) => {
      setBranches(names)
      setBase(current => (current !== '' && names.includes(current))
        ? current
        : (names.find(name => name === 'main' || name === 'master') ?? names[0] ?? ''))
    }).catch(() => { setBranches([]) })
  }, [target, fetchDefaults, fetchBranches])

  const branchIsNew = pickBranch === '__new__'
  const effectiveBranch = branchIsNew ? newBranch.trim() : pickBranch
  const slug = (value: string): string => value.trim().replace(/[\\/:*?"<>|\s]+/g, '-')

  /**
   * Default location for one new worktree. The preferred source is the
   * host-resolved store root + nesting (`git.worktree-defaults`: user
   * override or `{dshStudioHome}/worktrees`), composed through the shared
   * Orca-style naming rule; until that resolves (or on an older host), the
   * legacy repo-sibling `{name}-worktrees/{branch}` default still serves.
   */
  const defaultPath = (repoRoot: string, branch: string): string => {
    if (defaults !== null) {
      return computeWorktreeLocation({
        root: defaults.root,
        nest: defaults.nest,
        repoRoot,
        name: branch,
      })
    }
    const baseDir = repoRoot.replace(/[/\\]+$/, '')
    const parent = baseDir.slice(0, baseDir.lastIndexOf('/'))
    const name = baseDir.slice(baseDir.lastIndexOf('/') + 1)
    return `${parent}/${name}-worktrees/${slug(branch) === '' ? 'new' : slug(branch)}`
  }

  const close = (): void => {
    if (pending) return
    onClose()
  }
  const confirm = (): void => {
    if (pending || target === null) return
    if (effectiveBranch === '') { setError(t('wt.branch')); return }
    const createPath = (path.trim() === '' ? defaultPath(target.repoRoot, effectiveBranch) : path.trim())
    setPending(true)
    setError(null)
    // Worktree = session home (Orca model): a created worktree is ALWAYS
    // registered as a Host Workspace so the row's actions, the conversation
    // picker, and session scoping work immediately. Registration failure
    // keeps the physical worktree (never rolls the checkout back) and
    // surfaces as a toast — the directory can still be added manually.
    // New branches start at the picked base branch (the common flow: fork
    // from an existing branch rather than the main worktree's HEAD).
    createWorktree(
      target.repoRoot,
      createPath,
      effectiveBranch,
      branchIsNew,
      branchIsNew ? base : undefined,
    ).then(async () => {
      try {
        await registerWorkspace(createPath)
      } catch {
        // Keep the physical worktree; the caller toasts the failure.
      }
      setPending(false)
      setError(null)
      onCreated()
      onClose()
    }).catch((reason: unknown) => {
      setPending(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  if (target === null) return <></>
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('wt.new.title')}
      footer={(
        <>
          <Button variant="outline" disabled={pending} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={pending || effectiveBranch === ''} onClick={confirm}>
            {pending ? t('wt.pending') : t('wt.create')}
          </Button>
        </>
      )}
    >
      <div className={css.wtModalBody}>
        {/* Context: which repo / current branch this worktree forks from. */}
        <div className={css.wtModalContext}>
          {t('wt.basedOn', { name: target.label })}
          {target.currentBranch !== null && (
            <span className={css.wtModalContextBranch}>
              {' · '}{target.currentBranch}
            </span>
          )}
        </div>

        {/* Existing worktrees (read-only inventory). */}
        {target.existing.length > 0 && (
          <div>
            <div className={css.wtSectionLabel}>{t('wt.existing')}</div>
            {target.existing.map(wt => (
              <div key={wt.label} className={css.wtExistingRow}>
                <IconFolderClose16 size={14} />
                <span className={css.wtExistingRowText}>{wt.label}</span>
                {wt.branch !== null && <span className={css.wtExistingBranch}>{wt.branch}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Branch: check out an existing branch, or create a new one
            (optionally starting from a picked base branch). */}
        <div>
          <div className={css.wtSectionLabel}>{t('wt.branch')}</div>
          <Menu
            open={branchMenuOpen}
            onClose={() => { setBranchMenuOpen(false) }}
            items={[
              ...branches.map(b => ({ id: b, label: b })),
              { type: 'separator' as const, id: 'wt-branch-sep' },
              { id: '__new__', label: t('wt.newBranch') },
            ]}
            selectedId={branchIsNew ? '__new__' : pickBranch}
            onSelect={(id) => {
              setBranchMenuOpen(false)
              setPickBranch(id)
              const branch = id === '__new__' ? newBranch : id
              if (path.trim() === '') setPath(defaultPath(target.repoRoot, branch))
            }}
            portal
            anchor={(
              <button
                type="button"
                className={cn(css.renameInput, css.wtPickerButton)}
                onClick={() => { setBranchMenuOpen(v => !v) }}
              >
                <span className={css.wtPickerButtonText}>
                  {branchIsNew ? (newBranch === '' ? t('wt.newBranch') : newBranch) : pickBranch}
                </span>
                <IconChevronDownOutline14 />
              </button>
            )}
          />
          {branchIsNew && (
            <>
              <input
                className={cn(css.renameInput, css.wtNewBranchInput)}
                value={newBranch}
                aria-label={t('wt.newBranch')}
                placeholder={t('wt.newBranch')}
                autoFocus
                disabled={pending}
                onChange={(e) => { setNewBranch(e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
              />
              {/* Base branch: where the new branch starts. The most
                  common flow — fork a worktree off an existing branch
                  (default: the repo's main branch) instead of whatever
                  the main worktree's HEAD happens to be. */}
              <div className={css.wtSectionLabel}>{t('wt.base')}</div>
              <Menu
                open={baseMenuOpen}
                onClose={() => { setBaseMenuOpen(false) }}
                items={branches.map(b => ({ id: b, label: b }))}
                selectedId={base === '' ? undefined : base}
                onSelect={(id) => { setBaseMenuOpen(false); setBase(id) }}
                portal
                anchor={(
                  <button
                    type="button"
                    className={cn(css.renameInput, css.wtPickerButton)}
                    onClick={() => { setBaseMenuOpen(v => !v) }}
                  >
                    <span className={css.wtPickerButtonText}>
                      {base === '' ? t('wt.baseHead') : base}
                    </span>
                    <IconChevronDownOutline14 />
                  </button>
                )}
              />
            </>
          )}
        </div>

        {/* Location (auto-generated, editable). */}
        <div>
          <div className={css.wtSectionLabel}>{t('wt.path')}</div>
          <input
            className={cn(css.renameInput, css.wtPathInput)}
            value={path}
            aria-label={t('wt.path')}
            disabled={pending}
            onChange={(e) => { setPath(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
          />
        </div>
      </div>
      {error !== null && <FieldError className={css.renameError}>{error}</FieldError>}
    </Modal>
  )
}