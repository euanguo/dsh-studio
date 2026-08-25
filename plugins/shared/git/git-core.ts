/**
 * Shared Git operations for the desktop plugins (source-control panel,
 * workspace facts, left-rail worktree browser). Everything goes through
 * the system `git` binary spawned per request (no library, no state), with
 * porcelain-parseable output formats (`-z` NUL framing, unit separators)
 * so parsing never depends on locale or color config.
 *
 * Upgraded from the vendored `capabilities/src/git.ts` (moved to
 * plugins/shared so the sidebar and desktop-left-rail hosts share
 * exactly one implementation):
 * - `statusV2()`: `git status --porcelain=2 --branch` — branch, upstream,
 *   ahead/behind and entries from ONE subprocess (the v1 path needed three).
 * - `core.quotePath=false` on every command (non-ASCII/special paths stay
 *   literal instead of C-escaped).
 *
 * Kept on the system `git` binary + hand-rolled porcelain parsing on purpose
 * (ADR): the porcelain v2 / `-z` parsers are ~120 lines with contract tests,
 * and swapping to a JS-git library (isomorphic-git, simple-git) would rewrite
 * every operation (spawn semantics, `.git` layout access, credential flow)
 * for no behavior gain — git CLI is the stable, locale-proof contract here.
 * - `maxOutputBytes` guard so a huge diff cannot blow up the process heap.
 *
 * Commits use the user's git global identity untouched (never sets
 * user.name/user.email).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

/** A parsed `git status --porcelain=v1 -z` entry. */
export interface GitStatusEntry {
  path: string
  /** Two-letter index/worktree status (X Y), e.g. 'M ', ' M', 'A ', '??'. */
  xy: string
}

/** The source-control panel snapshot (v1-compatible shape). Internal: only
 *  the v1 `status()` chain (and worktreeRemovalPreview) consume it. */
interface GitStatusResult {
  isRepo: boolean
  branch?: string
  entries: GitStatusEntry[]
}

/** The porcelain v2 snapshot — one `status --porcelain=2 --branch` subprocess. */
export interface GitStatusV2Result {
  isRepo: boolean
  branch?: string | undefined
  /** Upstream ref (`refs/remotes/...`) when the branch tracks one. */
  upstream?: string | undefined
  ahead: number
  behind: number
  entries: GitStatusEntry[]
}

/** One `git log` row. */
export interface GitLogEntry {
  /** Short hash (7+ chars, display). */
  hash: string
  /** Full 40-char hash (advanced operations: revert / cherry-pick). */
  hashFull: string
  subject: string
  author: string
  /** ISO 8601 author date (`%ai`), e.g. `2024-01-01 10:00:00 +0800`. */
  date: string
  /** Ref decorations (`%D` with --decorate=short), e.g. `HEAD -> main, origin/main`; '' when none. */
  refs: string
}

/** One git failure (stderr text as the message). */
export class GitCommandError extends Error {
  readonly code: string
  readonly command: string

  constructor(message: string, code = 'git-error', command: string) {
    super(message)
    this.code = code
    this.command = command
  }
}

export interface RunGitOptions {
  timeoutMs?: number
  /** Kill the child and fail when stdout exceeds this many bytes. */
  maxOutputBytes?: number
  /** Let non-zero exits resolve to `{ code, stdout, stderr }` instead of rejecting. */
  allowNonZeroExit?: boolean
  /** Abort the child when this signal fires (rejects with code `git-aborted`). */
  signal?: AbortSignal
}

export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

/** Reject with an abort error whose code the caller can distinguish. */
function abortError(args: readonly string[]): GitCommandError {
  return new GitCommandError('git command aborted', 'git-aborted', args.join(' '))
}

/** Run one git command; resolves with stdout, rejects with GitCommandError. */
export function runGit(cwd: string, args: readonly string[], options: RunGitOptions = {}): Promise<string> {
  return runGitResult(cwd, args, options).then(result => {
    if (result.code !== 0) {
      throw new GitCommandError(
        result.stderr.trim() || `git exited with ${String(result.code)}`,
        'git-error',
        args.join(' '),
      )
    }
    return result.stdout
  })
}

/** Run one git command and always resolve with the raw exit envelope. */
export function runGitResult(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<GitRunResult> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024
  // quotePath=false keeps non-ASCII / special paths literal in every
  // machine-readable format (porcelain, numstat, log).
  const full = ['-C', cwd, '--no-pager', '-c', 'color.ui=false', '-c', 'core.quotePath=false', ...args]
  return new Promise<GitRunResult>((resolvePromise, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(args))
      return
    }
    const child = spawn('git', full, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let killedForLimit = false
    let settled = false

    const cleanup = (): void => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (error: GitCommandError | null, result?: GitRunResult): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== null) reject(error)
      else resolvePromise(result as GitRunResult)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new GitCommandError(
        `git ${args[0] ?? ''} timed out after ${timeoutMs}ms`,
        'git-error',
        args.join(' '),
      ))
    }, timeoutMs)
    const onAbort = (): void => {
      child.kill('SIGKILL')
      finish(abortError(args))
    }
    options.signal?.addEventListener('abort', onAbort)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > maxOutputBytes) {
        killedForLimit = true
        child.kill('SIGKILL')
        return
      }
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      finish(new GitCommandError(`cannot run git: ${error.message}`, 'git-error', args.join(' ')))
    })
    child.on('close', (code) => {
      if (killedForLimit) {
        finish(new GitCommandError(
          `git ${args[0] ?? ''} output exceeded ${maxOutputBytes} bytes`,
          'git-output-limit',
          args.join(' '),
        ))
        return
      }
      finish(null, { code: code ?? -1, stdout, stderr })
    })
  })
}

/* ---------- porcelain v1 (-z) ---------- */

/** Parse porcelain v1 -z output into entries (rename/copy pairs collapse to one row).
 *  Internal: only the v1 `status()` chain consumes it. */
function parsePorcelainZ(output: string): GitStatusEntry[] {
  const tokens = output.split('\0')
  const entries: GitStatusEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    index += 1
    if (token === '') continue
    const xy = token.slice(0, 2)
    const rest = token.slice(3)
    entries.push({ path: rest, xy })
    // Rename/copy entries carry the ORIGIN path as the next NUL field; the
    // new path (the file as it exists now) is the display path.
    if ((xy[0] === 'R' || xy[0] === 'C') && tokens[index] !== undefined && tokens[index] !== '') {
      index += 1
    }
  }
  return entries
}

/* ---------- porcelain v2 ---------- */

function parseBranchAb(value: string): { ahead: number; behind: number } {
  const match = /^\+(\d+)\s+-(\d+)$/.exec(value)
  if (match === null) return { ahead: 0, behind: 0 }
  return {
    ahead: Number(match[1] ?? '0'),
    behind: Number(match[2] ?? '0'),
  }
}

/**
 * Parse `git status --porcelain=2 --branch` output into the v1-compatible
 * entry shape plus branch/upstream/ahead/behind.
 *
 * v2 line grammar (paths are literal because quotePath=false):
 *   # branch.head <name>          | # branch.upstream <ref>
 *   # branch.ab +<ahead> -<behind>
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
 *   u <XY> ...                    (unmerged — reported as 'UU' conflict)
 *   ? <path>                      (untracked)
 */
export function parsePorcelainV2(output: string): GitStatusV2Result {
  let branch: string | undefined
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  const entries: GitStatusEntry[] = []

  for (const rawLine of output.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') continue
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      if (!value.startsWith('(')) branch = value
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      const value = line.slice('# branch.upstream '.length).trim()
      if (value !== '') upstream = value
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const parsed = parseBranchAb(line.slice('# branch.ab '.length).trim())
      ahead = parsed.ahead
      behind = parsed.behind
      continue
    }
    if (line.startsWith('? ')) {
      const path = line.slice(2).trim()
      if (path !== '') entries.push({ path, xy: '??' })
      continue
    }
    if (line.startsWith('! ')) continue // ignored
    if (line.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ').trim()
      if (path !== '') entries.push({ path, xy: 'UU' })
      continue
    }
    if (line.startsWith('1 ')) {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(8).join(' ').trim()
      if (path !== '') entries.push({ path, xy })
      continue
    }
    if (line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      // Rename/copy rows carry `<path>\t<origPath>` in the tail.
      const head = line.split('\t')[0] ?? ''
      const path = head.split(' ').slice(9).join(' ').trim()
      if (path !== '') entries.push({ path, xy })
      continue
    }
    // Other `# ...` lines (branch.oid, rebase state) are ignored.
  }

  return { isRepo: true, branch, upstream, ahead, behind, entries }
}

/** Working-tree status via one porcelain v2 subprocess (non-repo → isRepo:false). */
export async function statusV2(cwd: string, options: { signal?: AbortSignal } = {}): Promise<GitStatusV2Result> {
  let result: GitRunResult
  try {
    result = await runGitResult(cwd, ['status', '--porcelain=2', '--branch'], options.signal === undefined ? {} : { signal: options.signal })
  } catch (error) {
    if (error instanceof GitCommandError) throw error
    return { isRepo: false, ahead: 0, behind: 0, entries: [] }
  }
  if (result.code === 128 && result.stderr.includes('not a git repository')) {
    return { isRepo: false, ahead: 0, behind: 0, entries: [] }
  }
  if (result.code !== 0) {
    throw new GitCommandError(result.stderr.trim() || `git status failed: ${String(result.code)}`, 'git-error', 'status')
  }
  return parsePorcelainV2(result.stdout)
}

/* ---------- log / numstat / worktree ---------- */

/** Parse `git log --pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D` rows. */
export function parseLogLines(output: string): GitLogEntry[] {
  const rows: GitLogEntry[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [hash, subject, author, date, hashFull, refs] = line.split('\x1f')
    if (hash === undefined || subject === undefined) continue
    rows.push({
      hash,
      subject,
      author: author ?? '',
      date: date ?? '',
      hashFull: hashFull ?? hash,
      refs: refs ?? '',
    })
  }
  return rows
}

/** One `git diff --numstat -z` row. */
export interface GitNumstatEntry {
  path: string
  additions: number
  deletions: number
}

/**
 * Parse `git diff --numstat -z` output. Paths may contain tabs (the -z frame
 * keeps them literal); rename rows carry the origin path in a trailing NUL
 * field which is skipped. Binary rows report `-` and are dropped (0/0).
 */
export function parseNumstatZ(output: string): GitNumstatEntry[] {
  const rows: GitNumstatEntry[] = []
  const tokens = output.split('\0')
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    index += 1
    if (token === '') continue
    const first = token.indexOf('\t')
    const second = first >= 0 ? token.indexOf('\t', first + 1) : -1
    if (first < 0 || second < 0) continue
    const additions = Number(token.slice(0, first))
    const deletions = Number(token.slice(first + 1, second))
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue
    const path = token.slice(second + 1)
    if (path !== '') rows.push({ path, additions, deletions })
  }
  return rows
}

/** One entry from `git worktree list --porcelain`. */
export interface GitWorktreeEntry {
  path: string
  /** Commit the worktree's HEAD points at; null on bare repositories. */
  head: string | null
  /** Short branch name (refs/heads/ stripped); null when detached or bare. */
  branch: string | null
  /** The main worktree (the first `worktree` block). */
  main: boolean
  /** Git has locked this worktree against pruning/removal. */
  locked?: boolean
  /** Git reported a prunable reason for this worktree. */
  prunable?: string
}

/** The worktree layout of one repository. */
export interface GitWorktreeLayout {
  /** The main worktree path — the project identity (repo root). */
  repoRoot: string
  worktrees: GitWorktreeEntry[]
}

/**
 * Parse `git worktree list --porcelain` output: blank-line separated blocks
 * with `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>` lines
 * (detached worktrees carry no branch line; bare repositories carry no HEAD).
 */
export function parseWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  for (const block of output.split(/\n\n+/)) {
    let path: string | undefined
    let head: string | null = null
    let branch: string | null = null
    let locked = false
    let prunable: string | undefined
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length)
      else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
      } else if (line === 'locked' || line.startsWith('locked ')) {
        // `locked` may carry a human-readable reason after the marker.
        locked = true
      } else if (line.startsWith('prunable ')) {
        prunable = line.slice('prunable '.length)
      }
    }
    if (path !== undefined) {
      entries.push({
        path,
        head,
        branch,
        main: entries.length === 0,
        ...(locked ? { locked: true } : {}),
        ...(prunable === undefined ? {} : { prunable }),
      })
    }
  }
  return entries
}

/* ---------- operations ---------- */

/** Whether the directory is inside a git work tree (exit-0 `git rev-parse`). */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/** The repository top level containing `cwd` (`git rev-parse --show-toplevel`). */
export async function repoRoot(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  return out.trim()
}

/** The current branch name (`git rev-parse --abbrev-ref HEAD`; 'HEAD' when detached). */
export async function currentBranch(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.trim()
}

/** Working-tree status (untracked included), v1 shape (three subprocesses). */
export async function status(cwd: string): Promise<GitStatusResult> {
  const repo = await isGitRepo(cwd)
  if (!repo) return { isRepo: false, entries: [] }
  const [branch, raw] = await Promise.all([
    currentBranch(cwd).catch(() => 'HEAD'),
    runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']),
  ])
  return { isRepo: true, branch, entries: parsePorcelainZ(raw) }
}

/** `git worktree list --porcelain`; null when cwd is not inside a work tree. */
export async function worktreeList(cwd: string): Promise<GitWorktreeLayout | null> {
  let out: string
  try {
    out = await runGit(cwd, ['worktree', 'list', '--porcelain'])
  } catch {
    return null
  }
  const worktrees = parseWorktreeList(out)
  if (worktrees.length === 0) return null
  return { repoRoot: worktrees[0]!.path, worktrees }
}

/**
 * Create a linked worktree. `createBranch` true → `git worktree add -b
 * <branch> <path> [<base>]` (new branch, optionally starting at `base`
 * instead of HEAD); false → attach an existing branch.
 * @param cwd - inside the target repository.
 * @param path - absolute linked-worktree path (git rejects paths inside the
 *   main worktree itself).
 * @param branch - existing branch name (createBranch=false) or new name.
 * @param createBranch - whether to create the branch.
 * @param base - start point for the new branch (commit-ish; ignored when
 *   createBranch is false).
 */
export async function worktreeAdd(
  cwd: string,
  path: string,
  branch: string,
  createBranch: boolean,
  base?: string,
): Promise<void> {
  const trimmedBase = base?.trim()
  const args = createBranch
    ? ['worktree', 'add', '-b', branch, path, ...(trimmedBase === undefined || trimmedBase === '' ? [] : [trimmedBase])]
    : ['worktree', 'add', path, branch]
  await runGit(cwd, args)
}

/** Facts required before a linked worktree can be removed. */
export interface GitWorktreeRemovalPreview {
  repoRoot: string
  worktree: GitWorktreeEntry
  dirty: boolean
  statusEntries: GitStatusEntry[]
}

function worktreeEntryAt(
  layout: GitWorktreeLayout | null,
  path: string,
): GitWorktreeEntry | undefined {
  if (layout === null) return undefined
  const target = resolvePath(path)
  return layout.worktrees.find(entry => resolvePath(entry.path) === target)
}

/** Resolve and inspect one currently registered linked worktree. */
export async function worktreeRemovalPreview(cwd: string, path: string): Promise<GitWorktreeRemovalPreview> {
  const layout = await worktreeList(cwd)
  if (layout === null) {
    throw new GitCommandError('not a git worktree', 'git-worktree-not-found', 'worktree list')
  }
  const worktree = worktreeEntryAt(layout, path)
  if (worktree === undefined) {
    throw new GitCommandError('worktree is not registered by git', 'git-worktree-not-found', 'worktree list')
  }
  if (worktree.main) {
    throw new GitCommandError('the primary worktree cannot be removed', 'git-worktree-primary', 'worktree remove')
  }
  const statusResult = await status(worktree.path)
  return {
    repoRoot: layout.repoRoot,
    worktree,
    dirty: statusResult.entries.length > 0,
    statusEntries: statusResult.entries,
  }
}

/** Remove one non-primary linked worktree after a fresh host-side revalidation. */
export async function worktreeRemove(
  cwd: string,
  path: string,
  force = false,
): Promise<GitWorktreeLayout | null> {
  const preview = await worktreeRemovalPreview(cwd, path)
  if (preview.worktree.locked && !force) {
    throw new GitCommandError('worktree is locked', 'git-worktree-locked', 'worktree remove')
  }
  if (preview.dirty && !force) {
    throw new GitCommandError('worktree has uncommitted changes', 'git-worktree-dirty', 'worktree remove')
  }
  await runGit(cwd, [
    'worktree', 'remove',
    ...(force ? ['--force'] : []),
    '--', preview.worktree.path,
  ])
  return worktreeList(cwd)
}

/** Diff text of the worktree (unstaged) or the index (staged). */
export async function diff(cwd: string, path: string | undefined, staged: boolean, context = 3): Promise<string> {
  const args = ['diff', '--no-ext-diff', '--no-color', `-U${Math.max(0, Math.min(200, context))}`]
  if (staged) args.push('--cached')
  if (path !== undefined) args.push('--', path)
  return runGit(cwd, args)
}

/** Per-path +N/−M counts of the worktree (staged=false) or the index (staged=true). */
export async function numstat(cwd: string, staged: boolean): Promise<GitNumstatEntry[]> {
  const args = ['diff', '--numstat', '-z', '-M']
  if (staged) args.push('--cached')
  return parseNumstatZ(await runGit(cwd, args))
}

/** Normalize `path | paths[] | undefined` into `--`-prefixed args (empty = act on all). */
function pathsArgs(paths: string | readonly string[] | undefined): string[] {
  if (paths === undefined) return []
  const list = typeof paths === 'string' ? [paths] : [...paths]
  return list.length === 0 ? [] : ['--', ...list]
}

/** Stage paths (all when paths is undefined/empty). */
export async function stage(cwd: string, paths: string | readonly string[] | undefined): Promise<void> {
  await runGit(cwd, ['add', '-A', ...pathsArgs(paths)])
}

/** Unstage paths (all when paths is undefined/empty). */
export async function unstage(cwd: string, paths: string | readonly string[] | undefined): Promise<void> {
  await runGit(cwd, ['reset', '-q', ...pathsArgs(paths)])
}

/** Commit the staged changes with a message (global identity untouched). */
export async function commit(cwd: string, message: string): Promise<void> {
  await runGit(cwd, ['commit', '-m', message])
}

/** Branch names (current first). */
export async function branches(cwd: string): Promise<{ current: string; names: string[] }> {
  const [current, raw] = await Promise.all([
    currentBranch(cwd).catch(() => 'HEAD'),
    runGit(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
  ])
  const names = raw.split('\n').filter(line => line !== '')
  return { current, names: names.includes(current) ? names : [current, ...names] }
}

/** Switch to an existing branch. */
export async function checkout(cwd: string, branch: string): Promise<void> {
  await runGit(cwd, ['checkout', branch])
}

/** Recent commit history (newest first), lazily pageable via skip/count. */
export async function log(cwd: string, count = 30, skip = 0): Promise<GitLogEntry[]> {
  const raw = await runGit(cwd, [
    'log', '-n', String(count), '--skip', String(skip), '--decorate=short',
    '--pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D',
  ])
  return parseLogLines(raw)
}

// // unwired-capability (leaf-R1 ④): `git show <rev>:<path>` — restored from
// // HEAD. No current UI calls it (a blamer/at-revision file viewer is not
// // wired); kept as a real capability, not a dead wrapper.
/**
 * Content of a file at a revision (`git show <rev>:<path>`), or null when the
 * revision has no such path (a new/untracked file has no HEAD side).
 */
export async function show(cwd: string, rev: string, path: string): Promise<string | null> {
  try {
    return await runGit(cwd, ['show', `${rev}:${path}`])
  } catch {
    return null
  }
}

/** Full patch text of one commit (`git show` with the commit header suppressed).
 *  Merge commits show their diff against the first parent (`-m --first-parent`
 *  is a no-op for regular commits), so a history click always has content. */
export async function commitDiff(cwd: string, hash: string): Promise<string> {
  return runGit(cwd, ['show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent', hash])
}

/** One file touched by a commit (`git show --name-status` + numstat). */
export interface GitCommitFileEntry {
  path: string
  /** Status letter (A/M/D/R/C/T). */
  status: string
  additions: number
  deletions: number
}

/**
 * Parse `git show --name-status -z` output. With `-z` the status letter and
 * each path are SEPARATE NUL-terminated fields (NOT `status\tpath`):
 *   M\0path\0            (add/modify/delete/typechange)
 *   R100\0oldPath\0newPath\0   (rename/copy: old path first, new path second)
 * The new path is what the file is called now — the display path.
 */
export function parseCommitFilesZ(output: string): GitCommitFileEntry[] {
  const tokens = output.split('\0')
  const files: GitCommitFileEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const statusToken = tokens[index]
    index += 1
    if (statusToken === undefined || statusToken === '') continue
    const letter = statusToken.charAt(0).toUpperCase()
    const first = tokens[index]
    if (first === undefined || first === '') {
      index += 1
      continue
    }
    index += 1
    let path = first
    // Rename/copy carry the new path as the SECOND path field.
    if (letter === 'R' || letter === 'C') {
      const second = tokens[index]
      if (second !== undefined && second !== '') {
        path = second
        index += 1
      }
    }
    files.push({ path, status: letter, additions: 0, deletions: 0 })
  }
  return files
}

/** Merge `--numstat -z` +N/−M counts into name-status entries by path. */
function mergeCommitNumstat(
  files: readonly GitCommitFileEntry[],
  stats: readonly GitNumstatEntry[],
): GitCommitFileEntry[] {
  const byPath = new Map(stats.map(stat => [stat.path, stat] as const))
  return files.map(file => {
    const stat = byPath.get(file.path)
    return { ...file, additions: stat?.additions ?? 0, deletions: stat?.deletions ?? 0 }
  })
}

/** The files touched by one commit (newest-path order), for the inline file
 *  list shown when a history row expands. */
export async function commitFiles(cwd: string, hash: string): Promise<GitCommitFileEntry[]> {
  const [nameStatus, numstat] = await Promise.all([
    runGit(cwd, [
      'show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent',
      '--name-status', '-z', '-M', hash,
    ]),
    runGit(cwd, [
      'show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent',
      '--numstat', '-z', '-M', hash,
    ]),
  ])
  return mergeCommitNumstat(parseCommitFilesZ(nameStatus), parseNumstatZ(numstat))
}

/** Patch of a single file within one commit (`git show <hash> -- <path>`). */
export async function commitFileDiff(cwd: string, hash: string, path: string): Promise<string> {
  return runGit(cwd, [
    'show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent', hash, '--', path,
  ])
}

/** The current branch's upstream (e.g. `origin/main`); null when it tracks none. */
export async function upstreamRef(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}'])
    const ref = out.trim()
    return ref === '' || ref === 'HEAD' ? null : ref
  } catch {
    return null
  }
}

/** One active Git operation that must be explicitly resolved or aborted. */
export type GitConflictOperation = 'merge' | 'rebase' | null

/**
 * The source-control remote state derived from Git itself. This deep module
 * hides detached-head handling, absent upstreams, and operation detection so
 * UI callers only consume one stable factual snapshot.
 */
export interface GitUpstreamStatus {
  branch: string | null
  upstream: string | null
  hasRemote: boolean
  hasUpstream: boolean
  ahead: number
  behind: number
  conflictOperation: GitConflictOperation
}

const REMOTE_TIMEOUT_MS = 120_000
const REMOTE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

async function runRemoteGit(cwd: string, args: readonly string[]): Promise<string> {
  return runGit(cwd, args, {
    timeoutMs: REMOTE_TIMEOUT_MS,
    maxOutputBytes: REMOTE_MAX_OUTPUT_BYTES,
  })
}

async function conflictOperation(cwd: string): Promise<GitConflictOperation> {
  const mergeHead = await runGitResult(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (mergeHead.code === 0) return 'merge'
  for (const location of ['rebase-merge', 'rebase-apply']) {
    const result = await runGitResult(cwd, ['rev-parse', '--git-path', location])
    if (result.code === 0 && existsSync(resolvePath(cwd, result.stdout.trim()))) return 'rebase'
  }
  return null
}

/** Read branch tracking, ahead/behind, remote, and in-progress operation facts. */
export async function readUpstreamStatus(cwd: string): Promise<GitUpstreamStatus> {
  if (!await isGitRepo(cwd)) {
    return {
      branch: null,
      upstream: null,
      hasRemote: false,
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      conflictOperation: null,
    }
  }
  const [branchRaw, remotes, upstream, activeOperation] = await Promise.all([
    currentBranch(cwd).catch(() => 'HEAD'),
    runGit(cwd, ['remote']).catch(() => ''),
    upstreamRef(cwd),
    conflictOperation(cwd),
  ])
  const branch = branchRaw === '' || branchRaw === 'HEAD' ? null : branchRaw
  let ahead = 0
  let behind = 0
  if (upstream !== null) {
    const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
      .catch(() => '')
    const [aheadRaw, behindRaw] = counts.trim().split(/\s+/)
    const nextAhead = Number(aheadRaw)
    const nextBehind = Number(behindRaw)
    ahead = Number.isFinite(nextAhead) ? nextAhead : 0
    behind = Number.isFinite(nextBehind) ? nextBehind : 0
  }
  return {
    branch,
    upstream,
    hasRemote: remotes.trim() !== '',
    hasUpstream: upstream !== null,
    ahead,
    behind,
    conflictOperation: activeOperation,
  }
}

/** Fetch all configured remotes using the user's Git configuration. */
export async function fetch(cwd: string): Promise<void> {
  await runRemoteGit(cwd, ['fetch'])
}

/** Pull the current upstream without allowing an implicit merge or rebase. */
export async function pullFastForward(cwd: string): Promise<void> {
  await runRemoteGit(cwd, ['pull', '--ff-only'])
}

/** Push the current branch, publishing it to origin when it has no upstream. */
export async function push(cwd: string): Promise<void> {
  const state = await readUpstreamStatus(cwd)
  if (!state.hasRemote) throw new GitCommandError('repository has no Git remote', 'git-no-remote', 'push')
  if (state.hasUpstream) {
    await runRemoteGit(cwd, ['push'])
    return
  }
  if (state.branch === null) throw new GitCommandError('cannot push a detached HEAD', 'git-detached-head', 'push')
  await runRemoteGit(cwd, ['push', '--set-upstream', 'origin', state.branch])
}

/** Safely force-push the current branch without overwriting a moved upstream. */
export async function forcePushWithLease(cwd: string): Promise<void> {
  const state = await readUpstreamStatus(cwd)
  if (!state.hasUpstream) throw new GitCommandError('current branch has no upstream', 'git-no-upstream', 'push --force-with-lease')
  await runRemoteGit(cwd, ['push', '--force-with-lease'])
}

/** Safely synchronize the current branch: fast-forward pull, then push. */
export async function syncFastForward(cwd: string): Promise<void> {
  await pullFastForward(cwd)
  await push(cwd)
}

/** Abort an in-progress merge only when Git reports one. */
export async function abortMerge(cwd: string): Promise<void> {
  if (await conflictOperation(cwd) !== 'merge') {
    throw new GitCommandError('no merge is in progress', 'git-no-merge', 'merge --abort')
  }
  await runGit(cwd, ['merge', '--abort'])
}

/** Abort an in-progress rebase only when Git reports one. */
export async function abortRebase(cwd: string): Promise<void> {
  if (await conflictOperation(cwd) !== 'rebase') {
    throw new GitCommandError('no rebase is in progress', 'git-no-rebase', 'rebase --abort')
  }
  await runGit(cwd, ['rebase', '--abort'])
}

/** Files changed in the local commits ahead of `baseRef` (three-dot diff). */
export async function committedFiles(cwd: string, baseRef: string): Promise<GitCommitFileEntry[]> {
  const [nameStatus, numstat] = await Promise.all([
    runGit(cwd, [
      'diff', '--no-ext-diff', '--no-color', '--name-status', '-z', '-M', `${baseRef}...HEAD`,
    ]),
    runGit(cwd, [
      'diff', '--no-ext-diff', '--no-color', '--numstat', '-z', '-M', `${baseRef}...HEAD`,
    ]),
  ])
  return mergeCommitNumstat(parseCommitFilesZ(nameStatus), parseNumstatZ(numstat))
}

/** Diff of the local commits ahead of `baseRef` (optionally a single file). */
export async function committedDiff(cwd: string, baseRef: string, path?: string): Promise<string> {
  const args = ['diff', '--no-ext-diff', '--no-color', '-U3', `${baseRef}...HEAD`]
  if (path !== undefined) args.push('--', path)
  return runGit(cwd, args)
}

/** Discard the worktree changes of the given paths (`git checkout <paths>`; the index is untouched). */
export async function discard(cwd: string, paths: string | readonly string[]): Promise<void> {
  await runGit(cwd, ['checkout', ...pathsArgs(paths)])
}

// // unwired-capability (leaf-R1 ④): revert/cherryPick restored from HEAD.
// // No current UI wires them (single-commit undo/port of the source-control
// // panel is not connected); kept as real git capabilities.
/** Revert one commit onto the current branch with an auto-generated message. */
export async function revert(cwd: string, hash: string): Promise<void> {
  await runGit(cwd, ['revert', '--no-edit', hash])
}

/** Cherry-pick one commit onto the current branch. */
export async function cherryPick(cwd: string, hash: string): Promise<void> {
  await runGit(cwd, ['cherry-pick', hash])
}
