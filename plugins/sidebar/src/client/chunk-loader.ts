/**
 * Client-side chunk loader for /sidebar/bundle/<name>.js.
 * Scripts are loaded once and cached for the lifetime of the page.
 */
const loaded = new Map<string, Promise<void>>()

export function loadChunk(name: string): Promise<void> {
  const existing = loaded.get(name)
  if (existing !== undefined) return existing
  const promise = new Promise<void>((resolvePromise, reject) => {
    const script = document.createElement('script')
    script.src = `/sidebar/bundle/${name}.js`
    script.async = true
    script.onload = () => { resolvePromise() }
    script.onerror = () => { reject(new Error(`Failed to load chunk "${name}".`)) }
    document.head.append(script)
  })
  loaded.set(name, promise)
  return promise
}

export type EditorChunkApi = NonNullable<Window['__ohDshEditorChunk']>

export async function loadEditorChunk(): Promise<EditorChunkApi> {
  await loadChunk('editor')
  const api = window.__ohDshEditorChunk
  if (api === undefined) throw new Error('Editor chunk did not register itself.')
  return api
}
