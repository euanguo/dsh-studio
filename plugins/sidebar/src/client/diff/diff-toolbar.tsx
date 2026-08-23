/**
 * Diff toolbar: Unified/Split layout + word wrap + change navigation.
 * Shared by single-file and multi-file diff surfaces.
 */
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import {
  IconChevronDown,
  IconChevronRight,
  IconLayoutList,
  IconList,
} from '@dsh-studio/shared/tabler-icons'
import { useDiffViewPreferences } from './diff-view-preferences.ts'
import { binding, formatKeymapHint } from '../kit/keymap.ts'
import { SurfaceToolbar, ToolbarAction } from '@dsh-studio/shared/ui'

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
    <SurfaceToolbar
      data-testid="diff-toolbar"
      leading={leading === undefined || leading === null
        ? undefined
        : <span className="dsh-studio-diff-toolbar-title">{leading}</span>}
      actions={(
        <>
          {onPrevChange !== undefined && (
            <ToolbarAction
              icon={<IconChevronDown size={14} />}
              label={`Previous change (${PREV_CHANGE_HINT})`}
              onClick={onPrevChange}
            />
          )}
          {onNextChange !== undefined && (
            <ToolbarAction
              icon={<IconChevronRight size={14} />}
              label={`Next change (${NEXT_CHANGE_HINT})`}
              onClick={onNextChange}
            />
          )}
          <ToolbarAction
            icon={<IconLayoutList size={14} />}
            label={layout === 'split' ? t('diff.layout.split') : t('diff.layout.unified')}
            pressed={layout === 'split'}
            onClick={toggleLayout}
          />
          <ToolbarAction
            icon={<IconList size={14} />}
            label={t('diff.wrap')}
            pressed={wordWrap}
            onClick={toggleWordWrap}
          />
        </>
      )}
    />
  )
}
