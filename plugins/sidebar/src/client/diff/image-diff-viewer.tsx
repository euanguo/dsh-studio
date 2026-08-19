/**
 * Image diff viewer: Original / Modified side-by-side panes.
 * Both panes are base64 data URIs served by the host's `git.image-diff`.
 */
import { Scrollable } from '@dsh-studio/shared/scrollable'

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
    <Scrollable axis="both" className="dsh-studio-image-diff" data-testid="image-diff-viewer">
      <div className="dsh-studio-image-diff-pane">
        <span className="dsh-studio-image-diff-label">{oldLabel}</span>
        <img src={`data:image/*;base64,${oldData}`} alt={oldLabel} />
      </div>
      <div className="dsh-studio-image-diff-pane">
        <span className="dsh-studio-image-diff-label">{newLabel}</span>
        <img src={`data:image/*;base64,${newData}`} alt={newLabel} />
      </div>
    </Scrollable>
  )
}
