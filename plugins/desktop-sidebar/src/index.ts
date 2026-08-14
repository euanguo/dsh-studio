import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkspaceHostMutation } from './protocol.ts'
import { WORKSPACE_API_PATH } from './protocol.ts'
import { mutateWorkspace, readWorkspaceFacts } from './git-workspace.ts'
import { registerSidebarApi } from './sidebar-api.ts'
import {
  mountSidebarPreferences,
  type SidebarDesktopCapability,
} from './preferences-server.ts'

interface HostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    } | {
      kind: 'prefix'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
  logger: {
    warn(message: string): void
  }
}

export const name = 'oh-dsh-desktop-sidebar'
export const inject = ['desktop', 'settings', 'webServer']

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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 32 * 1024) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isMutation(value: unknown): value is WorkspaceHostMutation {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  if (input.action === 'push') return true
  return input.action === 'create-branch' && typeof input.branch === 'string'
}

export function apply(ctx: HostContext): void {
  ctx.effect(
    () => mountSidebarPreferences(
      ctx,
      ctx.get('desktop') as SidebarDesktopCapability,
    ),
    'oh-dsh-desktop: sidebar preferences',
  )
  ctx.effect(
    () => registerSidebarApi(ctx.webServer.register.bind(ctx.webServer), {
      settings: ctx.get('settings') as { describe(options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown; revision?: number }>; update(ns: string, patch: object, expectedRevision?: number): Promise<void> },
    }),
    'oh-dsh-desktop: sidebar JSON API',
  )
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WORKSPACE_API_PATH,
    handler: async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://oh-dsh.internal')
        const cwd = url.searchParams.get('cwd') ?? undefined
        if (request.method === 'GET') {
          sendJson(response, 200, await readWorkspaceFacts(cwd))
          return
        }
        if (request.method === 'POST') {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'untrusted workspace mutation origin' })
            return
          }
          const mutation = await readJsonBody(request)
          if (!isMutation(mutation)) throw new Error('invalid workspace mutation')
          sendJson(response, 200, await mutateWorkspace(cwd, mutation))
          return
        }
        response.writeHead(405, { allow: 'GET, POST' })
        response.end()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[desktop-sidebar] ${message}`)
        sendJson(response, 400, { error: message })
      }
    },
  }), 'oh-dsh-desktop: workspace Git API')
}
