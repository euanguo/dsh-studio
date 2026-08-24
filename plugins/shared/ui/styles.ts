import { ensureStyle } from '../style-injector.ts'
import themeCss from '../theme.css'
import listRowCss from '../list-row.css'
import filenameLabelCss from '../filename-label.css'
import surfaceTabCss from '../surface-tab.css'
import cardCss from './card.css'
import fieldCss from './field.css'
import emptyCss from './empty.css'
import settingsSectionCss from './settings-section.css'
import switchCss from './switch.css'
import textareaCss from './textarea.css'
import settingsRowCss from './settings-row.css'
import feedbackStateCss from './feedback-state.css'
import scrollAreaCss from './scroll-area.css'

/**
 * One stylesheet payload for shared UI composites. Keeping the aggregation in
 * the package means plugin authors do not need to remember which geometry file
 * belongs to ListRow, SurfaceTab, or ScrollArea.
 *
 * The former monolithic `ui.css` is split into contiguous, order-preserving
 * slices (see split-ui-css.mjs); the import ORDER below matches the original
 * rule order, so the joined payload is cascade-identical.
 */
export const sharedUiStyles = [
  cardCss,
  fieldCss,
  emptyCss,
  settingsSectionCss,
  switchCss,
  textareaCss,
  settingsRowCss,
  feedbackStateCss,
  scrollAreaCss,
  listRowCss,
  filenameLabelCss,
  surfaceTabCss,
].join('\n')

export function ensureSharedUiStyles(id: string): () => void {
  return ensureStyle(id, `${themeCss}\n${sharedUiStyles}`)
}

export default sharedUiStyles