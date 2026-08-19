import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import * as git from '@dsh-studio/shared/git-core'

const MAX_ICON_BYTES = 256 * 1024
const MAX_SOURCE_BYTES = 256 * 1024
const FILE_CANDIDATES = [
  'favicon.png',
  'public/favicon.png',
  'app/favicon.png',
  'app/icon.png',
  'src/favicon.png',
  'src/app/icon.png',
  'assets/favicon.png',
  'assets/icon.png',
  'static/favicon.png',
  'logo.png',
  'public/logo.png',
] as const
const SOURCE_CANDIDATES = [
  'index.html',
  'public/index.html',
  'app/routes/__root.tsx',
  'src/routes/__root.tsx',
  'app/root.tsx',
  'src/root.tsx',
  'src/index.html',
] as const
const SKIP_FAVICON_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'gitlab.com',
  'www.gitlab.com',
  'bitbucket.org',
  'www.bitbucket.org',
])
const LINK_ICON_RE = /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))/i

type DetectedProjectIcon =
  | { kind: 'image'; src: string; source: 'file' | 'favicon' | 'github'; label: string }
  | null

export interface ProjectIconDetection {
  repoRoot: string
  icon: DetectedProjectIcon
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
}

function pathInside(root: string, candidate: string): string | null {
  const absoluteRoot = resolve(root)
  const absoluteCandidate = resolve(candidate)
  const rest = relative(absoluteRoot, absoluteCandidate)
  if (rest === '' || rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest)) return null
  return absoluteCandidate
}

async function readPng(root: string, relativePath: string): Promise<DetectedProjectIcon> {
  const path = pathInside(root, join(root, relativePath))
  if (path === null) return null
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_ICON_BYTES) return null
  const buffer = await readFile(path)
  if (!isPng(buffer)) return null
  return {
    kind: 'image',
    src: `data:image/png;base64,${buffer.toString('base64')}`,
    source: 'file',
    label: relativePath,
  }
}

async function detectFileIcon(root: string): Promise<DetectedProjectIcon> {
  for (const relativePath of FILE_CANDIDATES) {
    try {
      const icon = await readPng(root, relativePath)
      if (icon !== null) return icon
    } catch {
      // A missing or unreadable candidate does not stop the bounded probe.
    }
  }
  for (const sourceFile of SOURCE_CANDIDATES) {
    try {
      const sourcePath = pathInside(root, join(root, sourceFile))
      if (sourcePath === null) continue
      const info = await stat(sourcePath)
      if (!info.isFile() || info.size > MAX_SOURCE_BYTES) continue
      const href = (await readFile(sourcePath, 'utf8')).match(LINK_ICON_RE)?.[1]
      if (href === undefined || href === '' || href.startsWith('http:') || href.startsWith('https:') || href.startsWith('//')) continue
      const candidate = pathInside(root, resolve(dirname(sourcePath), href))
      if (candidate === null) continue
      const icon = await readPng(root, relative(root, candidate))
      if (icon !== null) return { ...icon, label: href }
    } catch {
      // Continue through the conventional entry files.
    }
  }
  return null
}

async function detectHomepageIcon(root: string): Promise<DetectedProjectIcon> {
  try {
    const packagePath = pathInside(root, join(root, 'package.json'))
    if (packagePath === null) return null
    const info = await stat(packagePath)
    if (!info.isFile() || info.size > 128 * 1024) return null
    const homepage = (JSON.parse(await readFile(packagePath, 'utf8')) as { homepage?: unknown }).homepage
    if (typeof homepage !== 'string' || homepage.trim() === '') return null
    const url = new URL(homepage.includes('://') ? homepage : `https://${homepage}`)
    if (!['http:', 'https:'].includes(url.protocol) || SKIP_FAVICON_HOSTS.has(url.hostname.toLowerCase())) return null
    return {
      kind: 'image',
      src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`,
      source: 'favicon',
      label: url.hostname,
    }
  } catch {
    return null
  }
}

function githubAvatarFromRemote(raw: string): DetectedProjectIcon {
  const trimmed = raw.trim()
  const ssh = trimmed.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i)
  let host: string
  let owner: string
  let repo: string
  if (ssh !== null) {
    host = ssh[1]!
    owner = ssh[2]!
    repo = ssh[3]!
  } else {
    try {
      const url = new URL(trimmed)
      if (!['http:', 'https:'].includes(url.protocol)) return null
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length < 2) return null
      host = url.hostname
      owner = parts[0]!
      repo = parts[1]!.replace(/\.git$/i, '')
    } catch {
      return null
    }
  }
  if (owner === '' || repo === '' || host === '') return null
  const normalizedHost = host.toLowerCase()
  if (normalizedHost !== 'github.com' && normalizedHost !== 'www.github.com' && !normalizedHost.endsWith('.github.com')) return null
  return {
    kind: 'image',
    src: `https://${host}/${encodeURIComponent(owner)}.png?size=64`,
    source: 'github',
    label: `${owner}/${repo}`,
  }
}

async function detectGitProviderIcon(root: string): Promise<DetectedProjectIcon> {
  try {
    const remote = await git.runGit(root, ['remote', 'get-url', 'origin'])
    return githubAvatarFromRemote(remote)
  } catch {
    return null
  }
}

/** Orca-inspired bounded project icon detection; failures degrade to null. */
export async function detectProjectIcon(cwd: string): Promise<ProjectIconDetection> {
  const layout = await git.worktreeList(cwd)
  const repoRoot = layout?.repoRoot ?? resolve(cwd)
  const fileIcon = await detectFileIcon(repoRoot)
  if (fileIcon !== null) return { repoRoot, icon: fileIcon }
  const homepageIcon = await detectHomepageIcon(repoRoot)
  if (homepageIcon !== null) return { repoRoot, icon: homepageIcon }
  if (layout !== null) {
    const providerIcon = await detectGitProviderIcon(repoRoot)
    if (providerIcon !== null) return { repoRoot, icon: providerIcon }
  }
  return { repoRoot, icon: null }
}
