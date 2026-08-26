/**
 * Desktop identity single-source behavior tests (kernel-refactor leaf-2.1).
 * Exercises the channel derivations and the packaged-build assertion logic
 * of src/desktop-identity.ts, plus the wiring fact that the update manager
 * builds its release URLs on the same repository fact.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DESKTOP_APP_USER_MODEL_ID,
  PRODUCT_NAME,
  appUserModelIdForChannel,
  officialReleaseBase,
  officialRepository,
  productNameForChannel,
  releaseIdentityProblem,
  windowTitleForChannel,
} from '../src/desktop-identity.ts'
import { DSH_STUDIO_DEV_CHANNEL, DSH_STUDIO_STABLE_CHANNEL } from '../src/data-root.ts'
import { officialReleaseUrl } from '../src/update-manager.ts'

test('dev channel brands instance names as Dev variants of the stable product', () => {
  assert.equal(productNameForChannel(DSH_STUDIO_STABLE_CHANNEL), PRODUCT_NAME)
  assert.equal(productNameForChannel(DSH_STUDIO_DEV_CHANNEL), `${PRODUCT_NAME}-Dev`)
  assert.equal(windowTitleForChannel(DSH_STUDIO_STABLE_CHANNEL), PRODUCT_NAME)
  assert.equal(windowTitleForChannel(DSH_STUDIO_DEV_CHANNEL), `${PRODUCT_NAME} (Dev)`)
})

test('dev channel appends .dev to the stable app user model id', () => {
  assert.equal(appUserModelIdForChannel(DSH_STUDIO_STABLE_CHANNEL), DESKTOP_APP_USER_MODEL_ID)
  assert.equal(appUserModelIdForChannel(DSH_STUDIO_DEV_CHANNEL), `${DESKTOP_APP_USER_MODEL_ID}.dev`)
})

test('official repository is an owner/repo pair and drives the release tag base', () => {
  assert.match(officialRepository(), /^[^/\s]+\/[^/\s]+$/)
  const base = officialReleaseBase()
  assert.match(base, new RegExp(`https://github\\.com/${officialRepository()}/releases/tag/$`))
})

test('update-manager release URLs resolve through the shared repository fact', () => {
  const url = officialReleaseUrl('1.2.3')
  assert.ok(url.startsWith(officialReleaseBase()), `${url} must sit under ${officialReleaseBase()}`)
  assert.ok(url.endsWith('/v1.2.3'))
})

function consistentBuild(): Record<string, unknown> {
  return {
    appId: DESKTOP_APP_USER_MODEL_ID,
    productName: PRODUCT_NAME,
    publish: { owner: officialRepository().split('/')[0], repo: officialRepository().split('/')[1] },
  }
}

test('releaseIdentityProblem accepts a manifest build section that matches', () => {
  assert.equal(releaseIdentityProblem(undefined), undefined)
  assert.equal(releaseIdentityProblem(consistentBuild()), undefined)
  // Non-string or absent publish info cannot be validated and must not fail.
  assert.equal(releaseIdentityProblem({ appId: DESKTOP_APP_USER_MODEL_ID, productName: PRODUCT_NAME }), undefined)
})

test('releaseIdentityProblem reports each drifted identity field', () => {
  const appIdDrift = releaseIdentityProblem({ ...consistentBuild(), appId: 'com.example.wrong' })
  assert.match(appIdDrift ?? '', /release identity mismatch/)
  assert.match(appIdDrift ?? '', /build\.appId "com\.example\.wrong"/)

  const nameDrift = releaseIdentityProblem({ ...consistentBuild(), productName: 'Not Studio' })
  assert.match(nameDrift ?? '', /build\.productName "Not Studio"/)

  const [owner, repo] = officialRepository().split('/')
  const repoDrift = releaseIdentityProblem({
    ...consistentBuild(),
    publish: { owner, repo: `${repo}-moved` },
  })
  assert.match(repoDrift ?? '', /owner\/repo/)
  // The failure message tells the operator how to recover.
  assert.match(repoDrift ?? '', /package\.json build section/)
})
