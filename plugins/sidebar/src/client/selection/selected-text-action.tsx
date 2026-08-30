/**
 * Floating action bar anchored to a text selection (the "选词 → 操作条"
 * affordance, ported from the reference project's `SelectedTextAction`).
 *
 * Minimalist pill: plain action items (NOT button chrome) separated by thin
 * vertical dividers, a hairline border + capsule radius, no drop shadow, and
 * a subtle hover wash per item. The conversation target sits rightmost with
 * a chevron that opens the roster menu.
 *
 * Actions (each gated on its capability callback):
 *  - Add to chat: insert the selection as an inline reference chip into a
 *    conversation's composer (default = active conversation; chevron opens
 *    the roster to pick another).
 *  - Ask in side chat: hand the selection to the host's side-chat flow.
 *  - Comment: open the comment compose card anchored at the selection.
 *  - Edit: flip the pill into an inline "describe the edit" input.
 *  - Copy reference: write the `path:lines` payload to the clipboard.
 *
 * The pill must not let a click clear the underlying text selection: the
 * container stops mousedown propagation, and each action clears the
 * selection explicitly once it has captured the text.
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { toast } from '@dsh-studio/shared/toast'
import { relativeTimeParts, type RelativeTimeParts } from '@dsh-studio/shared/time'
import { FloatingLayer, ScrollArea, useMenuAnchor } from '@dsh-studio/shared/ui'
import { useOverlayArbiter } from './overlay-arbiter.tsx'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import {
  IconChevronDown,
  IconCopy,
  IconEdit,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconMessagePlus,
  IconSend,
} from '@dsh-studio/shared/tabler-icons'
import type { AppendResult, ConversationTarget } from './conversation-targets.ts'

export type EditActionResult = 'done' | 'retry' | 'unavailable'

export interface SelectedTextActionProps {
  /** The committed selection text (trimmed, NBSP-normalized). */
  selectedText: string
  /** Targetable conversations; null/undefined hides "add to chat". */
  conversations?: ConversationTarget[] | null
  /** Send to this conversation when the main pill slot is clicked. Defaults
   *  to the first (current) entry. */
  defaultConversationId?: string | undefined
  /** Append + send into a target conversation. `targetId` null = default. */
  onAddToConversation?(targetId: string | null, text: string): AppendResult
  /** Ask about the selection in a side chat (host flow). */
  onAskInSideChat?(text: string): void
  /** Open the comment compose card anchored at the comment button. */
  onComment?(selection: { text: string; line?: number; anchorRect?: DOMRect }): void
  /** Copy the selection reference (path:lines payload) to the clipboard. */
  onCopy?(text: string): void | Promise<void>
  /** Edit instruction → target conversation. Resolve 'retry' to restore
   *  the pill's action state (the host could not accept the edit). */
  onEdit?(input: { instruction: string; text: string }): Promise<EditActionResult>
  /** Routed back to the surface when a selection was consumed. */
  onConsumed?(): void
  t: Translate<WorkspaceMessage>
}

type Mode = 'actions' | 'actions-focused' | 'edit' | 'pending'

/** Keep the DOM selection alive while interacting with the pill. */
function preventSelectionLoss(event: ReactMouseEvent<HTMLElement>): void {
  event.preventDefault()
}

/** One minimalist action item: icon + label, hover wash, no button chrome. */
function ActionItem({
  icon,
  label,
  onClick,
  ariaLabel,
  autoFocus = false,
}: {
  icon: React.ReactNode
  label: string
  onClick(event: ReactMouseEvent<HTMLSpanElement>): void
  ariaLabel?: string
  autoFocus?: boolean
}): JSX.Element {
  return (
    <span
      role="button"
      tabIndex={0}
      className={surfaceCss["dsh-studio-selection-action-item"]}
      aria-label={ariaLabel ?? label}
      autoFocus={autoFocus}
      onClick={event => { onClick(event) }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          // Synthesize a rect from the key-press target for the anchor.
          onClick(event as unknown as ReactMouseEvent<HTMLSpanElement>)
        }
      }}
    >
      {icon}
      <span className={surfaceCss["dsh-studio-selection-action-label"]}>{label}</span>
    </span>
  )
}

/** Thin vertical divider between action items. */

/**
 * Localized relative "updated X ago" string for a conversation target, rendered
 * from the shared bucketing (`relativeTimeParts` in @dsh-studio/shared/time)
 * through the workspace `t()` contract. It shares the `time.*`
 * keys with desktop-left-rail so both surfaces show the same localized shapes;
 * a missing/invalid timestamp degrades to ''. This is the same shape as the
 * left-rail `hoverTimeLabel` (distance wrapped in the `ago` template; the
 * "< 1 min" bucket stays bare as `time.now`).
 */
function formatRelativeTime(parts: RelativeTimeParts | null, t: Translate<WorkspaceMessage>): string {
  if (parts === null) return ''
  if (parts.value === 0) return t('time.now')
  const unit = parts.unit === 'min' ? 'minutes'
    : parts.unit === 'hour' ? 'hours'
    : parts.unit === 'day' ? 'days'
    : parts.unit === 'month' ? 'months'
    : 'years'
  const distance = t(`time.${unit}`, { n: parts.value })
  return t('time.ago', { t: distance })
}

function formatTargetLabel(target: ConversationTarget, t: Translate<WorkspaceMessage>): string {
  const time = target.updatedAt === undefined ? '' : formatRelativeTime(relativeTimeParts(target.updatedAt), t)
  return time === '' ? target.label : `${target.label} · ${time}`
}

function Divider(): JSX.Element {
  return <span className={surfaceCss["dsh-studio-selection-action-divider"]} aria-hidden="true" />
}

export function SelectedTextAction({
  selectedText,
  conversations,
  defaultConversationId,
  onAddToConversation,
  onAskInSideChat,
  onComment,
  onCopy,
  onEdit,
  onConsumed,
  t,
}: SelectedTextActionProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('actions')
  const [instruction, setInstruction] = useState('')
  // The target conversation selected via the dropdown. Picking an entry only
  // updates THIS state (the pill stays open) — the main "add to chat" click
  // then sends to it. Defaults to the current conversation.
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const { open: menuOpen, toggle: toggleMenu, close: closeMenu, anchorRef, getAnchorRect } = useMenuAnchor()
  // The surface-level overlay arbiter (C16): shares the exclusive lock with the
  // comment rails on THIS surface via context, so the picker and the comment
  // card never open together. Read before any conditional so the picker below
  // can use it.
  const arbiter = useOverlayArbiter()
  // The picker and the comment card are mutually exclusive: opening the
  // picker blocks/replaces the comment card.
  const handleToggleMenu = (): void => {
    if (menuOpen) {
      closeMenu()
      arbiter.releaseExclusive('conv')
      return
    }
    if (arbiter.requestExclusive('conv')) toggleMenu()
  }

  const clearSelection = (): void => {
    window.getSelection()?.removeAllRanges()
    onConsumed?.()
  }

  const defaultTargetId = defaultConversationId
    ?? conversations?.find(target => target.current)?.id
    ?? conversations?.[0]?.id
  const effectiveTargetId = selectedTargetId ?? defaultTargetId

  const reportAppend = (result: AppendResult): void => {
    if (result !== 'inserted') {
      toast(t('selection.send-unavailable'))
    }
  }

  const sendTo = (targetId: string | null): void => {
    if (onAddToConversation === undefined) return
    reportAppend(onAddToConversation(targetId, selectedText))
    clearSelection()
  }

  const askInSideChat = (): void => {
    onAskInSideChat?.(selectedText)
    clearSelection()
  }

  const openComment = (event?: ReactMouseEvent<HTMLSpanElement>): void => {
    // Keep the selection & the bar alive: the comment card opens OVER the
    // selection, and cancelling it should leave the pill + selection intact.
    // The card anchors to THIS button's real rect (same as the picker's
    // chevron) so the floating engine's flip/shift edge handling applies.
    const rect = event?.currentTarget?.getBoundingClientRect() ?? undefined
    onComment?.({ text: selectedText, ...(rect === undefined ? {} : { anchorRect: rect }) })
  }

  const copySelection = (): void => {
    void onCopy?.(selectedText)
    clearSelection()
  }

  /* ── edit mode: inline "describe the edit" input ─────────────────── */

  const handleEditKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>): void => {
    event.stopPropagation()
    if (event.key !== 'Escape') return
    event.preventDefault()
    setMode('actions-focused')
  }

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const next = instruction.trim()
    if (next === '' || onEdit === undefined) return
    setMode('pending')
    void onEdit({ instruction: next, text: selectedText }).then(result => {
      if (result === 'retry' || result === 'unavailable') {
        if (result === 'unavailable') toast(t('selection.edit-unavailable'))
        setMode('actions-focused')
        return
      }
      clearSelection()
    })
  }

  if (mode === 'pending') return <></>

  if (mode === 'edit' && onEdit !== undefined) {
    return (
      <form
        className={`${surfaceCss["dsh-studio-selection-action"]} ${surfaceCss["dsh-studio-selection-action-edit"]}`}
        onKeyDown={handleEditKeyDown}
        onSubmit={handleEditSubmit}
        onMouseDown={preventSelectionLoss}
      >
        <input
          aria-label={t('selection.edit-input')}
          autoComplete="off"
          autoFocus
          className={surfaceCss["dsh-studio-selection-action-edit-input"]}
          placeholder={t('selection.edit-placeholder')}
          required
          value={instruction}
          onChange={event => { setInstruction(event.currentTarget.value) }}
        />
        <span
          role="button"
          tabIndex={0}
          className={`${surfaceCss["dsh-studio-selection-action-item"]} ${surfaceCss["dsh-studio-selection-action-submit"]}`}
          aria-label={t('selection.edit-submit')}
          onClick={() => { handleEditSubmit({ preventDefault: () => {} } as FormEvent<HTMLFormElement>) }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleEditSubmit({ preventDefault: () => {} } as FormEvent<HTMLFormElement>)
            }
          }}
        >
          <IconSend aria-hidden="true" />
        </span>
      </form>
    )
  }

  const hasConversation = conversations !== null && conversations !== undefined && onAddToConversation !== undefined

  return (
    <div
      className={surfaceCss["dsh-studio-selection-action"]}
      role="toolbar"
      aria-label={t('selection.title')}
      onMouseDown={preventSelectionLoss}
    >
      {onComment !== undefined ? (
        <ActionItem
          icon={<IconMessageCircle aria-hidden="true" />}
          label={t('selection.comment')}
          ariaLabel={t('selection.comment')}
          onClick={event => { openComment(event) }}
        />
      ) : null}
      {onEdit !== undefined ? (
        <>
          {onComment !== undefined ? <Divider /> : null}
          <ActionItem
            icon={<IconEdit aria-hidden="true" />}
            label={t('selection.edit')}
            ariaLabel={t('selection.edit')}
            onClick={() => { setMode('edit') }}
          />
        </>
      ) : null}
      {onCopy !== undefined ? (
        <>
          <Divider />
          <ActionItem
            icon={<IconCopy aria-hidden="true" />}
            label={t('selection.copy-ref')}
            ariaLabel={t('selection.copy-ref')}
            onClick={copySelection}
          />
        </>
      ) : null}
      {onAskInSideChat !== undefined ? (
        <>
          <Divider />
          <ActionItem
            icon={<IconMessageCircleQuestion aria-hidden="true" />}
            label={t('selection.ask-in-side-chat')}
            ariaLabel={t('selection.ask-in-side-chat')}
            onClick={askInSideChat}
          />
        </>
      ) : null}
      {hasConversation ? (
        <>
          <Divider />
          <span className={surfaceCss["dsh-studio-selection-action-target"]}>
            <ActionItem
              icon={<IconMessagePlus aria-hidden="true" />}
              label={t('selection.add-to-chat')}
              ariaLabel={t('selection.add-to-chat')}
              autoFocus={mode === 'actions-focused'}
              onClick={() => { sendTo(effectiveTargetId ?? null) }}
            />
            <span
              role="button"
              tabIndex={0}
              ref={anchorRef as React.RefObject<HTMLSpanElement>}
              className={`${surfaceCss["dsh-studio-selection-action-item"]} ${surfaceCss["dsh-studio-selection-action-chevron"]}`}
              aria-label={t('selection.pick-conversation')}
              aria-expanded={menuOpen}
              onClick={handleToggleMenu}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  handleToggleMenu()
                }
              }}
            >
              <IconChevronDown aria-hidden="true" />
            </span>
          </span>
          <FloatingLayer
            open={menuOpen}
            onOpenChange={next => { if (!next) { closeMenu(); arbiter.releaseExclusive('conv') } }}
            anchor={{ x: anchorRef.current?.getBoundingClientRect()?.left ?? 0, y: anchorRef.current?.getBoundingClientRect()?.top ?? 0 }}
            side="top"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className={surfaceCss["dsh-studio-selection-conv-menu"]}
          >
            <div className={surfaceCss["dsh-studio-selection-conv-shell"]} role="menu">
              <ScrollArea
                className={surfaceCss["dsh-studio-selection-conv-scroll"]}
                viewportClassName="dsh-studio-selection-conv-viewport"
              >
              {(conversations ?? []).map(target => {
                const time = target.updatedAt === undefined ? '' : formatRelativeTime(relativeTimeParts(target.updatedAt), t)
                const active = target.id === selectedTargetId || (selectedTargetId === null && target.current)
                return (
                  <button
                    key={target.id}
                    type="button"
                    role="menuitem"
                    className={surfaceCss["dsh-studio-selection-conv-item"]}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      setSelectedTargetId(target.id)
                      closeMenu()
                    }}
                  >
                    <span className={surfaceCss["dsh-studio-selection-conv-name"]}>
                      {target.label}
                      {target.current ? <em className={surfaceCss["dsh-studio-selection-conv-current"]}> · {t('selection.target-current')}</em> : null}
                      {active && !target.current ? <em className={surfaceCss["dsh-studio-selection-conv-current"]}> · ✓</em> : null}
                    </span>
                    {time === '' ? null : <time className={surfaceCss["dsh-studio-selection-conv-time"]}>{time}</time>}
                  </button>
                )
              })}
              </ScrollArea>
            </div>
          </FloatingLayer>
        </>
      ) : null}
    </div>
  )
}