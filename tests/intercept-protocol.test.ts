import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLinkProtocolIntercepted } from '../plugins/sidebar/src/client/intercept.ts'

const allOn = { browserInterceptHttp: true, browserInterceptHttps: true }
const allOff = { browserInterceptHttp: false, browserInterceptHttps: false }

test('link protocol gate routes http/https by their per-protocol flags', () => {
  assert.equal(
    isLinkProtocolIntercepted('http:', { browserInterceptHttp: true, browserInterceptHttps: false }),
    true,
  )
  assert.equal(
    isLinkProtocolIntercepted('https:', { browserInterceptHttp: true, browserInterceptHttps: false }),
    false,
  )
  assert.equal(
    isLinkProtocolIntercepted('https:', { browserInterceptHttp: false, browserInterceptHttps: true }),
    true,
  )
})

test('link protocol gate refuses every protocol outside http/https', () => {
  for (const protocol of ['ftp:', 'file:', 'mailto:', 'javascript:', 'data:', 'about:']) {
    assert.equal(isLinkProtocolIntercepted(protocol, allOn), false, protocol)
  }
})

test('link protocol gate defaults match the runtime defaults (http on, https off)', () => {
  // The default document: http intercepted, https left to the system browser.
  assert.equal(isLinkProtocolIntercepted('http:', { browserInterceptHttp: true, browserInterceptHttps: false }), true)
  assert.equal(isLinkProtocolIntercepted('https:', { browserInterceptHttp: true, browserInterceptHttps: false }), false)
  assert.equal(isLinkProtocolIntercepted('http:', allOff), false)
  assert.equal(isLinkProtocolIntercepted('https:', allOff), false)
})