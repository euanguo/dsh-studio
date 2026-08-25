import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CancellationToken, type ProgressInfo, type UpdateInfo, type UpdateFileInfo } from 'electron-updater'
import { gt, prerelease, valid } from 'semver'
import type {
  DesktopUpdatePlatform,
  DesktopUpdateState,
} from './contracts.ts'
import { singleFlight } from './update-lifecycle.ts'

const OFFICIAL_RELEASE_BASE = `https://github.com/${officialRepository()}/releases/tag/`

/**
 * The single source for the GitHub release repository. The desktop package's
 * `build.publish` owner/repo must match this or the app produces 404
 * `releaseUrl`s; `main.ts` asserts that at startup (RD-52).
 */
export function officialRepository(): string {
  return 'euanguo/dsh-studio-app'
}

export interface UpdateEventSource {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableDifferentialDownload: boolean
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo } | null>
  downloadUpdate(token?: CancellationToken): Promise<string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener?(event: string, listener: (...args: any[]) => void): unknown
}

export interface UpdateManagerOptions {
  currentVersion: string
  platform?: NodeJS.Platform
  arch?: string
  appIsPackaged?: boolean
  resourcesPath?: string
  packageType?: 'appimage' | 'deb' | 'unsupported'
  updater?: UpdateEventSource
  syncProxy?: () => Promise<void>
  onOpenRelease?: (url: string) => Promise<void> | void
  onOpenInstaller?: (path: string) => Promise<void> | void
  onLog?: (message: string) => void
}

interface UpdateMetadata {
  currentVersion: string
  latestVersion: string
  releaseName: string | null
  releaseNotes: string
  size: number | null
  platform: DesktopUpdatePlatform
  releaseUrl: string
  installerPath: string | null
}

type Operation = 'check' | 'download' | 'verify' | 'install'

export function officialReleaseUrl(version: string): string {
  const normalized = valid(version)
  if (normalized === null) throw new Error(`invalid release version: ${version}`)
  return `${OFFICIAL_RELEASE_BASE}v${normalized}`
}

export function releaseNotesText(notes: UpdateInfo['releaseNotes']): string {
  if (typeof notes === 'string') return notes
  if (!Array.isArray(notes)) return ''
  return notes
    .map(note => `${note.version}\n${note.note ?? ''}`.trim())
    .filter(Boolean)
    .join('\n\n')
}

function normalizeFileName(file: UpdateFileInfo): string {
  const raw = file.url
  try {
    return decodeURIComponent(new URL(raw).pathname.split('/').pop() ?? raw)
  } catch {
    return raw.split('/').pop() ?? raw
  }
}

export function platformFor(options: Pick<UpdateManagerOptions, 'platform' | 'packageType' | 'appIsPackaged'> = {}): DesktopUpdatePlatform {
  if (options.appIsPackaged === false) return 'unsupported'
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  if (platform === 'linux') {
    if (options.packageType === 'deb') return 'deb'
    if (options.packageType === 'appimage' || process.env.APPIMAGE !== undefined) return 'appimage'
  }
  return 'unsupported'
}

export function selectUpdateFile(
  info: UpdateInfo,
  platform: DesktopUpdatePlatform,
  arch: string = process.arch,
): UpdateFileInfo {
  const files = info.files.filter(file => {
    const name = normalizeFileName(file).toLowerCase()
    if (platform === 'mac') return name.endsWith('.zip') && name.includes(arch.toLowerCase())
    if (platform === 'win') return name.endsWith('.exe') && name.includes(arch.toLowerCase())
    if (platform === 'appimage') return name.endsWith('.appimage') && (name.includes('x86_64') || name.includes('amd64') || name.includes(arch.toLowerCase()))
    if (platform === 'deb') return name.endsWith('.deb') && (name.includes('amd64') || name.includes('x86_64') || name.includes(arch.toLowerCase()))
    return false
  })
  if (files.length !== 1) {
    throw Object.assign(
      new Error(files.length === 0 ? `no installable update asset for ${platform}/${arch}` : `multiple installable update assets for ${platform}/${arch}`),
      { code: files.length === 0 ? 'UPDATE_ASSET_MISSING' : 'UPDATE_ASSET_AMBIGUOUS' },
    )
  }
  return files[0]!
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  return 'UPDATE_FAILED'
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/authorization:\s*[^\s]+/gi, 'authorization: <redacted>')
    .replace(/([?&](?:token|access_token|password|passwd|secret))=[^&\s]*/gi, '$1=<redacted>')
    .slice(0, 1_000)
}

function isVerificationFailure(error: unknown): boolean {
  const code = errorCode(error).toLowerCase()
  const message = errorMessage(error).toLowerCase()
  return code.includes('signature') || code.includes('checksum') || message.includes('checksum') || message.includes('signature')
}

function isRetryable(error: unknown, stage: Operation): boolean {
  if (stage === 'verify' || stage === 'install') return false
  const code = errorCode(error)
  if (code === 'UPDATE_ASSET_MISSING' || code === 'UPDATE_ASSET_AMBIGUOUS' || code === 'ENOSPC') return false
  if (code.includes('INVALID_SIGNATURE') || code.includes('CHECKSUM')) return false
  return true
}

export async function detectPackageType(resourcesPath: string): Promise<'appimage' | 'deb' | 'unsupported'> {
  if (process.env.APPIMAGE !== undefined) return 'appimage'
  try {
    const packageType = (await readFile(join(resourcesPath, 'package-type'), 'utf8')).trim()
    return packageType === 'deb' ? 'deb' : 'unsupported'
  } catch {
    return 'unsupported'
  }
}

export class DesktopUpdateManager {
  readonly platform: DesktopUpdatePlatform
  private readonly currentVersion: string
  private readonly arch: string
  private readonly updater: UpdateEventSource | undefined
  private readonly syncProxy: (() => Promise<void>) | undefined
  private readonly onOpenRelease: ((url: string) => Promise<void> | void) | undefined
  private readonly onOpenInstaller: ((path: string) => Promise<void> | void) | undefined
  private readonly onLog: ((message: string) => void) | undefined
  private state: DesktopUpdateState
  private metadata: UpdateMetadata | undefined
  private token: CancellationToken | undefined
  private operation: Operation = 'check'
  /** Single-flight wrapper so concurrent check() callers share one run. */
  private readonly checkFlight = singleFlight(async (): Promise<DesktopUpdateState> => this.performCheck())
  private installOnQuitRequested = false
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>()
  private readonly eventListeners: Array<[string, (...args: any[]) => void]> = []

  constructor(options: UpdateManagerOptions) {
    this.currentVersion = options.currentVersion
    this.arch = options.arch ?? process.arch
    this.platform = platformFor(options)
    this.updater = options.updater
    this.syncProxy = options.syncProxy
    this.onOpenRelease = options.onOpenRelease
    this.onOpenInstaller = options.onOpenInstaller
    this.onLog = options.onLog
    this.state = { status: 'idle', currentVersion: this.currentVersion }
    if (this.updater !== undefined) {
      this.updater.autoDownload = false
      this.updater.autoInstallOnAppQuit = false
      this.updater.allowPrerelease = false
      this.updater.allowDowngrade = false
      this.updater.disableDifferentialDownload = false
      this.bindUpdaterEvents()
    }
  }

  getState(): DesktopUpdateState { return this.state }

  shouldInstallOnQuit(): boolean { return this.installOnQuitRequested }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  async command(command: { type: string }): Promise<DesktopUpdateState> {
    switch (command.type) {
      case 'check': return await this.check()
      case 'download': return await this.download()
      case 'cancel': return this.cancel()
      case 'retry': return await this.retry()
      case 'install-now': return await this.installNow()
      case 'install-on-quit': return this.installOnQuit()
      case 'open-release': return await this.openRelease()
      default: throw new Error(`unsupported update command: ${command.type}`)
    }
  }

  async check(): Promise<DesktopUpdateState> {
    return await this.checkFlight()
  }

  private async performCheck(): Promise<DesktopUpdateState> {
    if (this.platform === 'unsupported' || this.updater === undefined) {
      return this.publish({
        status: 'unsupported',
        currentVersion: this.currentVersion,
        platform: this.platform,
        message: 'This installation does not support automatic updates. Download the matching package from the official Release.',
        releaseUrl: null,
      })
    }
    this.operation = 'check'
    this.publish({ status: 'checking', currentVersion: this.currentVersion })
    try {
      await this.syncProxy?.()
      const result = await this.updater.checkForUpdates()
      if (result === null) {
        return this.publish({
          status: 'unsupported',
          currentVersion: this.currentVersion,
          platform: this.platform,
          message: 'Automatic updates are only available in a packaged, signed desktop installation.',
          releaseUrl: null,
        })
      }
      if (!result.isUpdateAvailable) {
        return this.publish({ status: 'not-available', currentVersion: this.currentVersion, checkedVersion: result.updateInfo.version })
      }
      return this.prepareAvailable(result.updateInfo)
    } catch (error) {
      return this.fail(error, 'check')
    }
  }

  private prepareAvailable(info: UpdateInfo): DesktopUpdateState {
    const normalized = valid(info.version)
    if (normalized === null || prerelease(normalized) !== null || !gt(normalized, this.currentVersion)) {
      return this.publish({ status: 'not-available', currentVersion: this.currentVersion, checkedVersion: info.version })
    }
    if (this.state.status === 'available' && this.state.latestVersion === normalized) return this.state
    try {
      const file = selectUpdateFile(info, this.platform, this.arch)
      this.metadata = {
        currentVersion: this.currentVersion,
        latestVersion: normalized,
        releaseName: info.releaseName ?? null,
        releaseNotes: releaseNotesText(info.releaseNotes),
        size: file.size ?? null,
        platform: this.platform,
        releaseUrl: officialReleaseUrl(normalized),
        installerPath: null,
      }
      return this.publishFromMetadata('available')
    } catch (error) {
      const code = errorCode(error)
      if (code === 'UPDATE_ASSET_MISSING' || code === 'UPDATE_ASSET_AMBIGUOUS') {
        return this.publish({
          status: 'unsupported',
          currentVersion: this.currentVersion,
          platform: this.platform,
          message: 'The latest Release does not contain one verified installer for this platform and architecture.',
          releaseUrl: officialReleaseUrl(normalized),
        })
      }
      return this.fail(error, 'check')
    }
  }

  async download(): Promise<DesktopUpdateState> {
    if (this.metadata === undefined || this.updater === undefined) return this.state
    this.operation = 'download'
    this.token = new CancellationToken()
    try {
      await this.syncProxy?.()
      const paths = await this.updater.downloadUpdate(this.token)
      if (this.metadata.installerPath === null) this.metadata.installerPath = paths[0] ?? null
      if (this.state.status !== 'downloaded') this.publishDownloaded()
      return this.state
    } catch (error) {
      if (this.token.cancelled) return this.publish({ status: 'cancelled', currentVersion: this.currentVersion, latestVersion: this.metadata.latestVersion })
      return this.fail(error, isVerificationFailure(error) ? 'verify' : 'download')
    } finally {
      this.token = undefined
    }
  }

  cancel(): DesktopUpdateState {
    this.token?.cancel()
    if (this.metadata !== undefined && (this.state.status === 'downloading' || this.state.status === 'available')) {
      return this.publish({ status: 'cancelled', currentVersion: this.currentVersion, latestVersion: this.metadata.latestVersion })
    }
    return this.state
  }

  async retry(): Promise<DesktopUpdateState> {
    if (this.state.status === 'error' && this.state.stage === 'download' && this.metadata !== undefined) return await this.download()
    return await this.check()
  }

  async installNow(): Promise<DesktopUpdateState> {
    const scheduledInstall = this.state.status === 'scheduled' && this.installOnQuitRequested
    if (this.metadata === undefined || (this.state.status !== 'downloaded' && !scheduledInstall)) return this.state
    this.operation = 'install'
    this.installOnQuitRequested = false
    try {
      if (this.metadata.platform === 'deb') {
        if (this.metadata.installerPath === null || this.onOpenInstaller === undefined) throw Object.assign(new Error('the downloaded .deb installer is unavailable'), { code: 'UPDATE_INSTALLER_MISSING' })
        await this.onOpenInstaller(this.metadata.installerPath)
        return this.publishScheduled()
      }
      this.updater?.quitAndInstall(false, true)
      if (this.state.status === 'error') return this.state
      return this.publishScheduled()
    } catch (error) {
      return this.fail(error, 'install')
    }
  }

  installOnQuit(): DesktopUpdateState {
    if (this.metadata === undefined || this.state.status !== 'downloaded' || this.metadata.platform === 'deb') return this.state
    this.installOnQuitRequested = true
    if (this.updater !== undefined) this.updater.autoInstallOnAppQuit = true
    return this.publishScheduled()
  }

  async openRelease(): Promise<DesktopUpdateState> {
    const url = this.metadata?.releaseUrl
    if (url !== undefined) await this.onOpenRelease?.(url)
    return this.state
  }

  private publishDownloaded(): void {
    const metadata = this.publicMetadata()
    if (metadata === undefined) return
    this.publish({
      status: 'downloaded',
      ...metadata,
      installOnQuit: false,
    })
  }

  private publishScheduled(): DesktopUpdateState {
    if (this.metadata === undefined) return this.state
    return this.publishFromMetadata('scheduled')
  }

  private bindUpdaterEvents(): void {
    const bind = (event: string, listener: (...args: any[]) => void): void => {
      this.updater?.on(event, listener)
      this.eventListeners.push([event, listener])
    }
    bind('checking-for-update', () => {
      if (this.state.status !== 'checking' && this.state.status !== 'downloading') this.publish({ status: 'checking', currentVersion: this.currentVersion })
    })
    bind('update-available', (info: UpdateInfo) => { this.prepareAvailable(info) })
    bind('update-not-available', (info: UpdateInfo) => {
      this.publish({ status: 'not-available', currentVersion: this.currentVersion, checkedVersion: info.version })
    })
    bind('download-progress', (progress: ProgressInfo) => {
      const metadata = this.publicMetadata()
      if (metadata === undefined) return
      const total = progress.total || metadata.size || 0
      const transferred = progress.transferred || 0
      const bytesPerSecond = progress.bytesPerSecond || 0
      this.publishFromMetadata('downloading', {
        percent: progress.percent || 0,
        transferred,
        total,
        bytesPerSecond,
        etaSeconds: bytesPerSecond > 0 && total > transferred ? Math.ceil((total - transferred) / bytesPerSecond) : null,
      })
    })
    bind('update-downloaded', (event: { downloadedFile?: string }) => {
      if (this.metadata === undefined) return
      if (event.downloadedFile !== undefined) this.metadata.installerPath = event.downloadedFile
      this.publishDownloaded()
    })
    bind('update-cancelled', () => {
      if (this.metadata !== undefined) this.publish({ status: 'cancelled', currentVersion: this.currentVersion, latestVersion: this.metadata.latestVersion })
    })
    bind('login', (_authInfo: unknown, callback: (username: string, password: string) => void) => {
      callback('', '')
      this.fail(Object.assign(new Error('The configured network proxy requires authentication.'), { code: 'PROXY_AUTH_REQUIRED' }), this.operation)
    })
    bind('error', (error: unknown) => {
      if (this.token?.cancelled) return
      this.fail(error, isVerificationFailure(error) ? 'verify' : this.operation)
    })
  }

  private fail(error: unknown, stage: Operation): DesktopUpdateState {
    const code = errorCode(error)
    const message = errorMessage(error)
    this.onLog?.(`update ${stage} failed (${code}): ${message}`)
    return this.publish({
      status: 'error',
      currentVersion: this.currentVersion,
      stage,
      code,
      message: code === 'ENOSPC' ? 'Not enough disk space to download the update.' : message,
      releaseUrl: this.metadata?.releaseUrl ?? null,
      retryable: isRetryable(error, stage),
    })
  }

  private publish(state: DesktopUpdateState): DesktopUpdateState {
    this.state = state
    for (const listener of this.listeners) listener(state)
    return state
  }

  /** The public metadata fields, dropping the private installer path. */
  private publicMetadata(): Omit<UpdateMetadata, 'installerPath'> | undefined {
    if (this.metadata === undefined) return undefined
    const { installerPath: _installerPath, ...publicMetadata } = this.metadata
    return publicMetadata
  }

  /**
   * Publish a full-field update state from the current metadata, avoiding the
   * eight-field expansion that used to be repeated at every publish site.
   */
  private publishFromMetadata(
    status: 'available' | 'downloading' | 'downloaded' | 'scheduled',
    extra: Record<string, unknown> = {},
  ): DesktopUpdateState {
    const metadata = this.publicMetadata()
    if (metadata === undefined) return this.state
    return this.publish({ status, ...metadata, ...extra } as DesktopUpdateState)
  }

  dispose(): void {
    for (const [event, listener] of this.eventListeners) this.updater?.removeListener?.(event, listener)
    this.eventListeners.length = 0
    this.listeners.clear()
  }
}
