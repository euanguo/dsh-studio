/**
 * Client-side chunk loader for /capabilities/bundle/<name>.js.
 * Scripts are loaded once and cached for the lifetime of the page.
 * `name` is the shared ChunkName union — the servable set (host) and the
 * requested set (client) come from the same list.
 */
import type { ChunkName } from '@dsh-studio/shared/bundle-names'

const loaded = new Map<string, Promise<void>>()

export function loadChunk(name: ChunkName): Promise<void> {
  const existing = loaded.get(name)
  if (existing !== undefined) return existing
  const promise = new Promise<void>((resolvePromise, reject) => {
    const script = document.createElement('script')
    script.src = `/capabilities/bundle/${name}.js`
    script.async = true
    script.onload = () => { resolvePromise() }
    script.onerror = () => { reject(new Error(`Failed to load chunk "${name}".`)) }
    document.head.append(script)
  })
  loaded.set(name, promise)
  return promise
}

export type MermaidChunkApi = NonNullable<Window['__dshStudioMermaidChunk']>

export async function loadMermaidChunk(): Promise<MermaidChunkApi> {
  await loadChunk('mermaid')
  const api = window.__dshStudioMermaidChunk
  if (api === undefined) throw new Error('Mermaid chunk did not register itself.')
  return api
}
