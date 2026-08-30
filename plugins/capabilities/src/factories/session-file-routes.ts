/**
 * The media (/capabilities/file) and HTML preview (/capabilities/html) GET
 * routes: resolve the absolute path against the session cwd, enforce
 * isWithin + isFile + size, read binary-safe, then let each route write its
 * own headers so the two keep their distinct security/header contracts.
 * The HTML preview is path-encoded (see html-route.ts) so relative assets
 * resolve back into the session scope, and every response carries the CSP
 * `sandbox` directive as defense-in-depth behind the iframe sandbox
 * ATTRIBUTE boundary.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isWithin, requireAbsolute } from '@dsh-studio/shared/fs-tree'
import { decodeHtmlUrl } from '../html-route.ts'
import { sessionCwdOf } from '../routes.ts'
import { CapabilityError, writeError } from '@dsh-studio/shared/wire'
import type { Context } from '../context-types.ts'
import type { ResolvedCapabilitiesConfig } from '../config.ts'

/** Content types for the media route, by extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
}

/** Content type served by /capabilities/file (binary-safe fallback for unknowns). */
export function mediaTypeForPath(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

async function serveSessionFile(
  ctx: Context,
  resolved: ResolvedCapabilitiesConfig,
  res: ServerResponse,
  opts: {
    scope: 'media' | 'html'
    sessionId: string
    clientCwd?: string
    resolvePath: () => string
    headers(type: string, path: string): Record<string, string>
  },
): Promise<void> {
  const cwd = sessionCwdOf(ctx, opts.sessionId, opts.clientCwd)
  const absolute = requireAbsolute(opts.resolvePath())
  if (!isWithin(cwd, absolute)) {
    // Only files under the session cwd are served (isWithin, not a raw
    // startsWith, so case-mismatched Windows paths and mixed separators
    // cannot be misclassified).
    throw new CapabilityError('fs-error', `${opts.scope} path outside the session working directory`, 403)
  }
  const info = await stat(absolute)
  if (!info.isFile() || info.size > resolved.mediaLimit) {
    throw new CapabilityError('fs-error', 'not a file or too large', 400)
  }
  const body = await readFile(absolute)
  res.writeHead(200, opts.headers(mediaTypeForPath(absolute), absolute))
  res.end(body)
}

/** Register both GET routes on the fenced web server. */
export function registerSessionFileRoutes(
  ctx: Context,
  opts: {
    fence(req: IncomingMessage): boolean
    resolved: ResolvedCapabilitiesConfig
  },
): void {
  // ── Media route (images for the editor) ─────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/capabilities/file',
    handler: async (req, res) => {
      if (!opts.fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sessionId = url.searchParams.get('sessionId')
        const raw = url.searchParams.get('path')
        if (sessionId === null || raw === null) throw new CapabilityError('bad-request', 'sessionId and path are required')
        await serveSessionFile(ctx, opts.resolved, res, {
          scope: 'media',
          sessionId,
          ...(url.searchParams.get('cwd') === null ? {} : { clientCwd: url.searchParams.get('cwd') as string }),
          resolvePath: () => raw,
          headers: (type, path) => {
            // Raw bytes either way (binary-safe); ?download=1 switches the
            // disposition so the browser saves the file instead of showing it.
            const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache' }
            if (url.searchParams.get('download') === '1') {
              headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`
            }
            return headers
          },
        })
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'capabilities: /capabilities/file media route')

  // ── HTML preview route (sandboxed HTML + its relative assets) ───────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/capabilities/html',
    handler: async (req, res) => {
      if (!opts.fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const decoded = decodeHtmlUrl(url.pathname)
        if (!decoded.ok) {
          writeError(res, new CapabilityError('bad-request', decoded.message, decoded.status))
          return
        }
        const { sessionId, path } = decoded.ref
        await serveSessionFile(ctx, opts.resolved, res, {
          scope: 'html',
          sessionId,
          resolvePath: () => path,
          headers: (type) => ({
            'content-type': type,
            'cache-control': 'no-cache',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            // The sandbox directive (no allow-same-origin → opaque origin) is
            // the previewer's security boundary even for top-level loads;
            // object-src 'none' blocks plugin embeds.
            'content-security-policy': "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'",
          }),
        })
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'capabilities: /capabilities/html preview route')
}
