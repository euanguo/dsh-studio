/** /capabilities fs.* handlers: tree/read/write/create/rename/delete/copy/
 *  search, scoped to the session working directory. Split from routes.ts. */
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { requireAbsolute, listDirectory } from '@dsh-studio/shared/fs-tree'
import { errorMessage } from '@dsh-studio/shared/errors'
import {
  optionalBoolean,
  optionalInteger,
  requireString,
  CapabilityError,
} from '@dsh-studio/shared/wire'
import {
  assertWithinSession,
  readText,
  resolveGitPath,
  searchWorkspace,
  type FsHandlerDeps,
} from './shared.ts'
import type { ApiMethod } from './types.ts'

/** Build the fs.* route group. */
export function buildFsHandlers(deps: FsHandlerDeps): Record<string, ApiMethod> {
  const { cwdOf, resolved } = deps
  return {
    'fs.tree': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { path?: unknown }
      const target = record.path === undefined ? cwd : requireAbsolute(requireString(payload, 'path'))
      return listDirectory(target, resolved.listLimit)
    },
    'fs.read': async (payload) => {
      const { cwd } = cwdOf(payload)
      // Relative paths are git-derived (status/diff report repo-root-relative
      // names; the untracked diff view reads the file through this route).
      const path = await resolveGitPath(cwd, requireString(payload, 'path'))
      const { content, truncated, binary, size, head, data } = await readText(path, resolved.readLimit)
      if (binary) {
        return {
          kind: 'binary',
          size,
          truncated,
          ...(head === undefined ? {} : { head }),
          ...(data === undefined ? {} : { data }),
        }
      }
      return { kind: 'text', content, truncated }
    },
    'fs.write': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      assertWithinSession(cwd, path, 'write')
      const content = requireString(payload, 'content')
      const tmp = `${path}.dsh-sidebar-tmp-${process.pid}`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {})
        throw new CapabilityError('fs-error', `cannot write "${path}": ${errorMessage(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.create': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      assertWithinSession(cwd, path, 'create')
      const record = payload as { directory?: unknown }
      try {
        if (record.directory === true) {
          await mkdir(path, { recursive: false })
        } else {
          await writeFile(path, '', { encoding: 'utf8', flag: 'wx' })
        }
      } catch (error) {
        throw new CapabilityError('fs-error', `cannot create "${path}": ${errorMessage(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.rename': async (payload) => {
      const { cwd } = cwdOf(payload)
      const from = requireAbsolute(requireString(payload, 'from'))
      const to = requireAbsolute(requireString(payload, 'to'))
      assertWithinSession(cwd, from, 'rename')
      assertWithinSession(cwd, to, 'rename')
      try {
        await rename(from, to)
      } catch (error) {
        throw new CapabilityError('fs-error', `cannot rename "${from}": ${errorMessage(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.delete': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      assertWithinSession(cwd, path, 'delete')
      try {
        await rm(path, { recursive: true, force: false })
      } catch (error) {
        throw new CapabilityError('fs-error', `cannot delete "${path}": ${errorMessage(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.copy': async (payload) => {
      const { cwd } = cwdOf(payload)
      const from = requireAbsolute(requireString(payload, 'from'))
      const to = requireAbsolute(requireString(payload, 'to'))
      assertWithinSession(cwd, from, 'copy')
      assertWithinSession(cwd, to, 'copy')
      try {
        await copyFile(from, to)
      } catch (error) {
        throw new CapabilityError('fs-error', `cannot copy "${from}": ${errorMessage(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.search': async (payload) => {
      const { cwd } = cwdOf(payload)
      const pattern = requireString(payload, 'pattern')
      return searchWorkspace(cwd, pattern, optionalBoolean(payload, 'caseSensitive') === true)
    },
    // fs.tail stays a dormant handler — no surfaced consumer calls it yet.
    // Reads the tail of a session-scoped file (runs-byte window, capped at
    // 512 KiB).
    'fs.tail': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = await resolveGitPath(cwd, requireString(payload, 'path'))
      const maxBytes = Math.min(optionalInteger(payload, 'maxBytes', 1, Number.MAX_SAFE_INTEGER) ?? 128 * 1024, 512 * 1024)
      const info = await stat(path).catch((error: unknown) => {
        throw new CapabilityError('fs-error', `cannot read "${path}": ${errorMessage(error)}`, 400)
      })
      const handle = await open(path, 'r')
      try {
        const readSize = Math.min(info.size, maxBytes)
        const buffer = Buffer.alloc(readSize)
        const { bytesRead } = await handle.read(buffer, 0, readSize, Math.max(0, info.size - readSize))
        return { content: buffer.subarray(0, bytesRead).toString('utf8'), truncated: info.size > maxBytes }
      } finally {
        await handle.close()
      }
    },
  }
}