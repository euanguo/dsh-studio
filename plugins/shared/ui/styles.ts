import { ensureStyle } from '../style-injector.ts'
import themeCss from '../theme.css'
import listRowCss from '../list-row.css'
import filenameLabelCss from '../filename-label.css'
import surfaceTabCss from '../surface-tab.css'
import uiCss from './ui.css'

/**
 * One stylesheet payload for shared UI composites. Keeping the aggregation in
 * the package means plugin authors do not need to remember which geometry file
 * belongs to ListRow, SurfaceTab, or ScrollArea.
 */
export const sharedUiStyles = [
  uiCss,
  listRowCss,
  filenameLabelCss,
  surfaceTabCss,
].join('\n')

export function ensureSharedUiStyles(id: string): () => void {
  return ensureStyle(id, `${themeCss}\n${sharedUiStyles}`)
}

export default sharedUiStyles
