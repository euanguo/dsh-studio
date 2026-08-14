/**
 * Lightweight syntax highlighting (Prism, on-demand languages).
 *
 * Only the languages below are bundled — no wasm, no theme registry.
 * The visual theme lives in CSS tokens (--dsw-*), so highlighting follows
 * the DSH light/dark switch automatically.
 */
import Prism from 'prismjs'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-diff'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-java'

const BY_EXT: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  python: 'python',
  sql: 'sql',
  diff: 'diff',
  go: 'go',
  rs: 'rust',
  java: 'java',
}

/** Language id for a path ('' when unknown — rendered plain). */
export function languageForPath(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  return BY_EXT[ext] ?? ''
}

/** Highlight source text; falls back to escaped plain text. */
export function highlightCode(content: string, language: string): string {
  if (language === '' || Prism.languages[language] === undefined) {
    return escapeHtml(content)
  }
  try {
    return Prism.highlight(content, Prism.languages[language]!, language)
  } catch {
    return escapeHtml(content)
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
