/**
 * Desktop identity single source: product name, app user model id, official
 * release repository, and per-channel title/appId derivation all live here.
 * `main.ts`, `update-manager.ts`, and the packaged `build` assertion must
 * consume these facts instead of restating them; a renamed repo or app is
 * fixed in exactly this file.
 */
import {
  DSH_STUDIO_DEV_CHANNEL,
  type DshStudioChannel,
} from './data-root.ts'

/** Stable-channel product name; also the packaged `build.productName`. */
export const PRODUCT_NAME = 'DSH Studio'

/** Stable-channel macOS/Windows app user model id; packaged `build.appId`. */
export const DESKTOP_APP_USER_MODEL_ID = 'ai.deepseek.dsh-studio'

/**
 * The single source for the GitHub release repository. The desktop package's
 * `build.publish` owner/repo must match this or the app produces 404
 * `releaseUrl`s; startup asserts that (`releaseIdentityProblem`).
 */
export function officialRepository(): string {
  return 'euanguo/dsh-studio-app'
}

/** GitHub releases tag base for `officialRepository()`. */
export function officialReleaseBase(): string {
  return `https://github.com/${officialRepository()}/releases/tag/`
}

/** Electron/BrowserWindow-facing name of one channel's instance. */
export function productNameForChannel(channel: DshStudioChannel): string {
  return channel === DSH_STUDIO_DEV_CHANNEL ? `${PRODUCT_NAME}-Dev` : PRODUCT_NAME
}

/** Window/menu title of one channel's instance. */
export function windowTitleForChannel(channel: DshStudioChannel): string {
  return channel === DSH_STUDIO_DEV_CHANNEL ? `${PRODUCT_NAME} (Dev)` : PRODUCT_NAME
}

/** App user model id of one channel's instance (dev carries a `.dev` suffix). */
export function appUserModelIdForChannel(channel: DshStudioChannel): string {
  return channel === DSH_STUDIO_DEV_CHANNEL
    ? `${DESKTOP_APP_USER_MODEL_ID}.dev`
    : DESKTOP_APP_USER_MODEL_ID
}

/**
 * Compare a package manifest's `build` section against the identity facts
 * above. Returns undefined when the section is absent (source launches may
 * lack one entirely) or consistent; otherwise returns the full failure
 * message to log and throw.
 */
export function releaseIdentityProblem(
  build: Record<string, unknown> | undefined,
): string | undefined {
  if (build === undefined) return undefined
  const appId = build.appId
  const productName = build.productName
  const publishOwner = (build.publish as Record<string, unknown> | undefined)?.owner
  const publishRepo = (build.publish as Record<string, unknown> | undefined)?.repo
  const problem: string | undefined =
    (typeof appId === 'string' && appId !== DESKTOP_APP_USER_MODEL_ID)
      ? `build.appId "${appId}" != DESKTOP_APP_USER_MODEL_ID "${DESKTOP_APP_USER_MODEL_ID}"`
      : (typeof productName === 'string' && productName !== PRODUCT_NAME)
        ? `build.productName "${productName}" != PRODUCT_NAME "${PRODUCT_NAME}"`
        : (typeof publishOwner === 'string' && typeof publishRepo === 'string' && `${publishOwner}/${publishRepo}` !== officialRepository())
          ? `build.publish owner/repo "${publishOwner}/${publishRepo}" != officialRepository() "${officialRepository()}"`
          : undefined
  if (problem === undefined) return undefined
  return `release identity mismatch: ${problem}. Update the source constant and the package.json build section together so automatic updates keep resolving.`
}
