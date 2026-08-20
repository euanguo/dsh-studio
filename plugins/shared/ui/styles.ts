import listRowCss from '../list-row.css'
import filenameLabelCss from '../filename-label.css'
import scrollableCss from '../scrollable.css'
import surfaceTabCss from '../surface-tab.css'
import uiCss from './ui.css'

/**
 * One stylesheet payload for shared UI composites. Keeping the aggregation in
 * the package means plugin authors do not need to remember which geometry file
 * belongs to ListRow, SurfaceTab, or Scrollable.
 */
export const sharedUiStyles = [
  uiCss,
  listRowCss,
  filenameLabelCss,
  surfaceTabCss,
  scrollableCss,
].join('\n')

export default sharedUiStyles
