/**
 * Diff toolbar: Unified/Split layout + word wrap + change navigation.
 * Shared by single-file and multi-file diff surfaces.
 */
import type { Translate } from '@oh-dsh/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconLayoutList,
  IconList,
} from '@oh-dsh/shared/icons'
import { useDiffViewPreferences } from './diff-view-preferences.ts'
import { binding, formatKeymapHint } from '../kit/keymap.ts'

/** F7 / Shift+F7 change-navigation hints (match the keymap registrations). */
const PREV_CHANGE_HINT = formatKeymapHint(binding({ key: 'F7' }))
const NEXT_CHANGE_HINT = formatKeymapHint(binding({ shift: true, key: 'F7' }))

export function DiffToolbar({
  leading,
  t,
  onPrevChange,
  onNextChange,
}: {
  leading?: JSX.Element | null
  t: Translate<WorkspaceMessage>
  onPrevChange?(): void
  onNextChange?(): void
}): JSX.Element {
  const layout = useDiffViewPreferences(state => state.layout)
  const wordWrap = useDiffViewPreferences(state => state.wordWrap)
  const toggleLayout = useDiffViewPreferences(state => state.toggleLayout)
  const toggleWordWrap = useDiffViewPreferences(state => state.toggleWordWrap)

  return (
    <div className="oh-dsh-diff-toolbar" data-testid="diff-toolbar">
      <div className="oh-dsh-diff-toolbar-leading">{leading}</div>
      <div className="oh-dsh-diff-toolbar-actions">
        {onPrevChange !== undefined ? (
          <button type="button" onClick={onPrevChange} title={`Previous change (${PREV_CHANGE_HINT})`}>
            <IconChevronDownOutline14 size={14} />
          </button>
        ) : null}
        {onNextChange !== undefined ? (
          <button type="button" onClick={onNextChange} title={`Next change (${NEXT_CHANGE_HINT})`}>
            <IconChevronRightOutline14 size={14} />
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={layout === 'split'}
          title={layout === 'split' ? t('diff.layout.split') : t('diff.layout.unified')}
          onClick={toggleLayout}
        >
          <IconLayoutList size={14} />
        </button>
        <button
          type="button"
          aria-pressed={wordWrap}
          title={t('diff.wrap')}
          onClick={toggleWordWrap}
        >
          <IconList size={14} />
        </button>
      </div>
    </div>
  )
}
