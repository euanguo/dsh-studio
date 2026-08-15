/**
 * CodeMirror 6 editor chunk (lazy loaded via /sidebar/bundle/editor.js).
 * Kept React-free so the chunk can be a plain browser script — the client
 * only needs a DOM element and callbacks.
 */
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'

export interface EditorMountOptions {
  parent: HTMLElement
  value: string
  filePath: string
  readOnly: boolean
  onChange?(value: string): void
  onSave?(): void
}

export interface EditorHandle {
  readonly view: EditorView
  getValue(): string
  setValue(value: string): void
  focus(): void
  destroy(): void
}

function languageFor(filePath: string): ReturnType<typeof javascript> | ReturnType<typeof markdown> | null {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : ''
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return markdown()
  if (ext === 'json') return json()
  if (ext === 'html' || ext === 'htm') return html()
  if (ext === 'css' || ext === 'scss' || ext === 'less') return css()
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs' || ext === 'mts' || ext === 'cts') {
    return javascript({ jsx: ext === 'jsx' || ext === 'tsx', typescript: ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts' })
  }
  return null
}

export function mountCodeEditor(options: EditorMountOptions): EditorHandle {
  const language = languageFor(options.filePath)
  const updateListener = EditorView.updateListener.of(update => {
    if (update.docChanged) {
      options.onChange?.(update.state.doc.toString())
    }
  })
  const state = EditorState.create({
    doc: options.value,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      updateListener,
      EditorState.readOnly.of(options.readOnly),
      EditorView.contentAttributes.of({ 'data-testid': 'code-mirror-editor' }),
      ...(language === null ? [] : [language]),
    ],
  })
  const view = new EditorView({
    state,
    parent: options.parent,
  })
  const handle: EditorHandle = {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: value => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    },
    focus: () => { view.focus() },
    destroy: () => { view.destroy() },
  }
  view.dom.addEventListener('keydown', (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      options.onSave?.()
    }
  })
  return handle
}

declare global {
  interface Window {
    __ohDshEditorChunk?: {
      mountCodeEditor: typeof mountCodeEditor
    }
  }
}

if (typeof window !== 'undefined') {
  window.__ohDshEditorChunk = { mountCodeEditor }
}
