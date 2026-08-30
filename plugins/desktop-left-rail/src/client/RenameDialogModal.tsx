/**
 * Controlled single-field rename dialog shared by every rename surface in the
 * workspace browser: workspace title, session title, project alias, worktree
 * alias, and the new/rename group name. Each caller owns its draft, confirm
 * and cancel handlers; this component owns only the modal chrome, the input
 * keyboard contract (IME-composition-aware Enter commit) and the footer.
 * (Named by the deep-refactor annotation contract: `RenameDialogModal`.)
 */
import { useRef, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { Input } from '@dsh-studio/shared/ui'
import { WorkspaceBrowserCss as css } from './styles.ts'
import type { WorkspaceBrowserProps } from './contract/slots.ts'

export interface RenameDialogModalProps {
  open: boolean
  /** Dialog title (e.g. the localized rename caption). */
  title: string
  /** Accessible name of the single text field. */
  fieldLabel: string
  value: string
  /** Keep the dialog's draft in step with the caller's field. */
  onChange: (value: string) => void
  /** Commit the current draft; the caller owns the async rename/cancel flow. */
  onConfirm: () => void
  onCancel: () => void
  /** Disable the confirm action (blank field, duplicate, no-op, …). */
  confirmDisabled?: boolean
  /** A rename is in flight: lock the input and both buttons. */
  busy?: boolean
  /** Secondary inline error(s) under the field (translated text already applied). */
  error?: ReactNode
  /** Browser root's locale seat (close label). */
  t: WorkspaceBrowserProps['t']
}

export function RenameDialogModal({
  open,
  title,
  fieldLabel,
  value,
  onChange,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  busy = false,
  error = null,
  t,
}: RenameDialogModalProps) {
  const composing = useRef(false)
  return (
    <Modal
      open={open}
      onClose={onCancel}
      closeLabel={t('close')}
      title={title}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy || confirmDisabled} onClick={onConfirm}>{t('rename')}</Button>
        </>
      )}
    >
      <Input
        className={css.renameInput}
        value={value}
        aria-label={fieldLabel}
        autoFocus
        disabled={busy}
        onFocus={(e) => { e.target.select() }}
        onChange={(e) => { onChange(e.target.value) }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || composing.current || busy || confirmDisabled) return
          e.preventDefault()
          onConfirm()
        }}
      />
      {error !== null && error !== undefined && <div className={css.renameError}>{error}</div>}
    </Modal>
  )
}