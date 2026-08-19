import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

test('virtualized diff owns its scroll host instead of nesting under Scrollable', () => {
  const css = read('plugins/sidebar/src/client/diff/diff-viewer.css')
  assert.match(
    css,
    /\.dsh-studio-diff-surface-body:has\(> \.dsh-studio-diff-viewer\[data-virtualize=['"]on['"]\]\)\s*\{[^}]*overflow:\s*hidden/s,
    'the outer diff body must switch to a flex/non-scrolling shell for virtualized diffs',
  )
  assert.match(
    css,
    /\.dsh-studio-pierre-surface\s*\{[^}]*overflow:\s*auto/s,
    'the Pierre Virtualizer root must be the actual scroll container',
  )
  assert.match(
    css,
    /\.dsh-studio-pierre-surface\s*\{[^}]*min-height:\s*0/s,
    'the Pierre Virtualizer root must be shrinkable inside the flex shell',
  )
})

test('virtualized file viewers own their scroll host instead of outer file surface', () => {
  const css = read('plugins/sidebar/src/client/sidebar.css')
  assert.match(
    css,
    /\.dsh-studio-file-surface-body:has\(\.dsh-studio-pierre-file-host\)\s*\{[^}]*overflow:\s*hidden/s,
    'the file surface must switch to a non-scrolling shell for Pierre viewers',
  )
  assert.match(
    css,
    /\.dsh-studio-pierre-file-host\s*\{[^}]*overflow:\s*auto/s,
    'the Pierre file host must own the code viewer scroll position',
  )
  assert.match(
    css,
    /\.dsh-studio-pierre-file-host\s*\{[^}]*min-height:\s*0/s,
    'the Pierre file host must be shrinkable inside the file surface',
  )
})

test('conflict viewer uses an auto-scrolling Pierre host', () => {
  const css = read('plugins/sidebar/src/client/sidebar.css')
  assert.match(
    css,
    /\.dsh-studio-conflict-host\s*\{[^}]*overflow:\s*auto/s,
    'the conflict host must be the actual scroll owner',
  )
})

test('multi-file diff intentionally keeps the outer stack as scroll owner', () => {
  const source = read('plugins/sidebar/src/client/diff/multi-diff-file-stack.tsx')
  assert.match(source, /<DiffViewer[\s\S]*?virtualize=\{false\}/)
  const renderers = read('plugins/sidebar/src/client/surfaces/diff-renderers.tsx')
  assert.match(renderers, /className="dsh-studio-diff-all-stack"/)
})
