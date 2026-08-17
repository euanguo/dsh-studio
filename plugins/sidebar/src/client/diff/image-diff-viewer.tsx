/**
 * Image diff viewer: Original / Modified side-by-side panes.
 * Both panes are base64 data URIs served by the host's `git.image-diff`.
 */
import { Scrollable } from '../../../../shared/scrollable.tsx'

export function ImageDiffViewer({
  oldData,
  newData,
  oldLabel,
  newLabel,
}: {
  oldData: string
  newData: string
  oldLabel: string
  newLabel: string
}): JSX.Element {
  return (
    <Scrollable axis="both" className="oh-dsh-image-diff" data-testid="image-diff-viewer">
      <div className="oh-dsh-image-diff-pane">
        <span className="oh-dsh-image-diff-label">{oldLabel}</span>
        <img src={`data:image/*;base64,${oldData}`} alt={oldLabel} />
      </div>
      <div className="oh-dsh-image-diff-pane">
        <span className="oh-dsh-image-diff-label">{newLabel}</span>
        <img src={`data:image/*;base64,${newData}`} alt={newLabel} />
      </div>
    </Scrollable>
  )
}
