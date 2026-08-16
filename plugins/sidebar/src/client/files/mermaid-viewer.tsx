/**
 * Mermaid diagram viewer: lazy-loads the mermaid chunk on first mount,
 * renders the SVG into a container, and falls back to the raw source on
 * parse/load errors.
 */
import { useEffect, useRef, useState } from 'react'
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { loadMermaidChunk } from '../chunk-loader.ts'
import { LoadingView } from '../kit/status.tsx'

export function MermaidViewer({
  content,
  t,
}: {
  content: string
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setError('')
    setLoading(true)
    void loadMermaidChunk()
      .then(api => api.renderMermaid(hostRef.current!, content))
      .then(() => {
        if (alive) setLoading(false)
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setLoading(false)
        }
      })
    return () => { alive = false }
  }, [content])

  return (
    <div className="oh-dsh-mermaid-viewer" data-testid="mermaid-viewer">
      {loading ? <LoadingView label={t('files.rendering-diagram')} /> : null}
      {error !== '' ? (
        <pre className="oh-dsh-mermaid-source">
          <code>{content}</code>
        </pre>
      ) : (
        <div ref={hostRef} className="oh-dsh-mermaid-svg" />
      )}
    </div>
  )
}
