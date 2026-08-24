/**
 * Image diff viewer: Original / Modified side-by-side panes.
 * Both panes are base64 data URIs served by the host's `git.image-diff`.
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { ScrollArea } from '@dsh-studio/shared/ui'

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
    <ScrollArea axis="both" className={surfaceCss["dsh-studio-image-diff"]} viewportClassName="dsh-studio-ui-scroll-viewport-inset" data-testid="image-diff-viewer">
      <div className={surfaceCss["dsh-studio-image-diff-pane"]}>
        <span className={surfaceCss["dsh-studio-image-diff-label"]}>{oldLabel}</span>
        <img src={`data:image/*;base64,${oldData}`} alt={oldLabel} />
      </div>
      <div className={surfaceCss["dsh-studio-image-diff-pane"]}>
        <span className={surfaceCss["dsh-studio-image-diff-label"]}>{newLabel}</span>
        <img src={`data:image/*;base64,${newData}`} alt={newLabel} />
      </div>
    </ScrollArea>
  )
}
