import { ensureStyle } from '../style-injector.ts'
import themeCss from '../theme.css'
import listRowCss from '../list-row.css'
import filenameLabelCss from '../filename-label.css'
import surfaceTabCss from '../surface-tab.css'
import fieldCss from './field.css'
import emptyCss from './empty.css'
import settingsSectionCss from './settings-section.css'
import switchCss from './switch.css'
import textareaCss from './textarea.css'
import settingsRowCss from './settings-row.css'
import feedbackStateCss from './feedback-state.css'
import scrollAreaCss from './scroll-area.css'
import inputCss from './input.css'
import selectCss from './select.css'
import checkboxCss from './checkbox.css'

/**
 * One stylesheet payload for shared UI composites. Keeping the aggregation in
 * the package means plugin authors do not need to remember which geometry file
 * belongs to ListRow, SurfaceTab, or ScrollArea.
 *
 * The former monolithic `ui.css` is split into contiguous, order-preserving
 * slices (see split-ui-css.mjs); the import ORDER below matches the original
 * rule order, so the joined payload is cascade-identical. The shadcn form
 * control slices (input / select / checkbox) are appended after the original
 * slices — new class namespaces, no overlap with the original order.
 */
export const sharedUiStyles = [
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
  inputCss,
  selectCss,
  checkboxCss,
].join('\n')

export function ensureSharedUiStyles(id: string): () => void {
  return ensureStyle(id, `${themeCss}\n${sharedUiStyles}`)
}

export default sharedUiStyles