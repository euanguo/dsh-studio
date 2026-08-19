/**
 * Mermaid rendering chunk (lazy loaded via /sidebar/bundle/mermaid.js).
 * React-free like the editor chunk.
 */
import mermaid from 'mermaid'

let nextId = 1

export async function renderMermaid(element: HTMLElement, code: string): Promise<void> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  })
  const id = `dsh-studio-mermaid-${String(nextId += 1)}-${String(Date.now())}`
  const result = await mermaid.render(id, code)
  element.innerHTML = result.svg
}

declare global {
  interface Window {
    __dshStudioMermaidChunk?: { renderMermaid: typeof renderMermaid }
  }
}

if (typeof window !== 'undefined') {
  window.__dshStudioMermaidChunk = { renderMermaid }
}
