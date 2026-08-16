import { randomBytes } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import {
  DEFAULT_SKIN_PREFERENCES,
  PREFERENCES_API_PATH,
  parseSkinPreferences,
  type DesktopSkinPreferences,
} from './preferences.ts'

export interface DesktopCapability {
  appDataPath: string
}

export interface DesktopSkinPreferencesHostContext {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
  logger: {
    warn(message: string): void
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 4096) throw new Error('desktop skin preferences are too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export async function loadSkinPreferences(path: string): Promise<DesktopSkinPreferences> {
  try {
    const parsed = parseSkinPreferences(JSON.parse(await readFile(path, 'utf8')) as unknown)
    if (parsed === undefined) throw new Error('desktop skin preferences are invalid')
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_SKIN_PREFERENCES
    throw error
  }
}

export async function saveSkinPreferences(
  path: string,
  preferences: DesktopSkinPreferences,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.next-${randomBytes(6).toString('hex')}`
  await writeFile(temporary, `${JSON.stringify(preferences, undefined, 2)}\n`, { mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') {
      await unlink(temporary).catch(() => {})
      throw error
    }
    await copyFile(temporary, path)
    await unlink(temporary)
  }
}

export function mountDesktopSkinPreferences(
  ctx: DesktopSkinPreferencesHostContext,
  desktop: DesktopCapability,
): () => void {
  if (desktop.appDataPath.length === 0) {
    throw new Error('desktop-skins: desktop application data path is unavailable')
  }
  const path = join(desktop.appDataPath, 'desktop-skins.json')
  return ctx.webServer.register({
    kind: 'exact',
    path: PREFERENCES_API_PATH,
    handler: async (request, response) => {
      try {
        if (request.method === 'GET') {
          sendJson(response, 200, await loadSkinPreferences(path))
          return
        }
        if (request.method === 'PUT') {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'untrusted desktop skin preferences origin' })
            return
          }
          const preferences = parseSkinPreferences(await readJson(request))
          if (preferences === undefined) {
            sendJson(response, 400, { error: 'invalid desktop skin preferences' })
            return
          }
          await saveSkinPreferences(path, preferences)
          sendJson(response, 200, preferences)
          return
        }
        response.writeHead(405, { allow: 'GET, PUT' })
        response.end()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[desktop-skins] ${message}`)
        sendJson(response, 500, { error: message })
      }
    },
  })
}
