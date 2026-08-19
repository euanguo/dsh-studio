export interface GitHubSourceAdapterOptions {
  apiBase?: string
  fetch?: typeof globalThis.fetch
  rawBase?: string
  userAgent?: string
}

export class GitHubSourceError extends Error {
  readonly code: 'not-found' | 'request-failed' | 'invalid-response'
  readonly status: number | null

  constructor(
    message: string,
    code: GitHubSourceError['code'],
    status: number | null = null,
  ) {
    super(message)
    this.name = 'GitHubSourceError'
    this.code = code
    this.status = status
  }
}

export function validateGitHubRepository(repository: string): void {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new GitHubSourceError(`invalid GitHub repository: ${JSON.stringify(repository)}`, 'invalid-response')
  }
}

export function validateExactCommit(commit: string): void {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new GitHubSourceError('GitHub source must resolve to a lowercase 40-character commit', 'invalid-response')
  }
}

function encodePath(path: string): string {
  const normalized = path.startsWith('./') ? path.slice(2) : path
  const segments = normalized.split('/')
  if (segments.length === 0 || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new GitHubSourceError(`invalid GitHub file path: ${JSON.stringify(path)}`, 'invalid-response')
  }
  return segments.map(segment => encodeURIComponent(segment)).join('/')
}

function responseMessage(response: Response): string {
  return `GitHub request failed with HTTP ${String(response.status)} ${response.statusText}`.trim()
}

/** Read public GitHub refs and files over HTTPS without requiring `gh`. */
export class GitHubSourceAdapter {
  readonly #apiBase: string
  readonly #fetch: typeof globalThis.fetch
  readonly #rawBase: string
  readonly #userAgent: string

  constructor(options: GitHubSourceAdapterOptions = {}) {
    this.#apiBase = options.apiBase ?? 'https://api.github.com'
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#rawBase = options.rawBase ?? 'https://raw.githubusercontent.com'
    this.#userAgent = options.userAgent ?? 'dsh-studio'
  }

  async resolveCommit(repository: string, requestedRef: string | null = null): Promise<string> {
    validateGitHubRepository(repository)
    const ref = requestedRef === null || requestedRef === '' ? 'HEAD' : requestedRef
    const response = await this.#fetch(
      `${this.#apiBase}/repos/${repository}/commits/${encodeURIComponent(ref)}`,
      { headers: this.#headers(), signal: AbortSignal.timeout(30_000) },
    )
    if (!response.ok) {
      throw new GitHubSourceError(responseMessage(response), response.status === 404 ? 'not-found' : 'request-failed', response.status)
    }
    let value: unknown
    try {
      value = await response.json()
    } catch (error) {
      throw new GitHubSourceError(`GitHub commit response was not JSON: ${String(error)}`, 'invalid-response', response.status)
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || typeof (value as { sha?: unknown }).sha !== 'string') {
      throw new GitHubSourceError('GitHub commit response omitted sha', 'invalid-response', response.status)
    }
    const commit = (value as { sha: string }).sha.toLowerCase()
    validateExactCommit(commit)
    return commit
  }

  async readFile(repository: string, path: string, commit: string): Promise<string | null> {
    validateGitHubRepository(repository)
    validateExactCommit(commit)
    const response = await this.#fetch(
      `${this.#rawBase}/${repository}/${commit}/${encodePath(path)}`,
      { headers: this.#headers(), signal: AbortSignal.timeout(30_000) },
    )
    if (response.status === 404) return null
    if (!response.ok) {
      throw new GitHubSourceError(responseMessage(response), 'request-failed', response.status)
    }
    return await response.text()
  }

  #headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'user-agent': this.#userAgent,
    }
  }
}
