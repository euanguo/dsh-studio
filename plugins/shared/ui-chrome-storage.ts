/**
 * Shared browser client for domain-backed UI chrome. It has one transport
 * path, serializes writes, and falls back to memory only when the host store
 * is unavailable. It never reads or writes browser localStorage.
 */
import {
  callCapabilitiesGlobalApi,
} from './contracts/capabilities-api.ts'
import type { UiChromeTableName } from './ui-chrome-tables.ts'

export interface UiChromeStorageApi {
  get(table: UiChromeTableName, signal?: AbortSignal): Promise<unknown>
  put(table: UiChromeTableName, value: unknown): Promise<void>
  delete(table: UiChromeTableName): Promise<void>
}

const capabilitiesApi: UiChromeStorageApi = {
  async get(table, signal) {
    const result = await callCapabilitiesGlobalApi<{ value?: unknown }>(
      'ui-chrome.get',
      { table },
      signal,
    )
    return result.value
  },
  async put(table, value) {
    await callCapabilitiesGlobalApi(
      'ui-chrome.put',
      { table, value },
    )
  },
  async delete(table) {
    await callCapabilitiesGlobalApi(
      'ui-chrome.delete',
      { table },
    )
  },
}

export interface UiChromeStorageOptions<T> {
  table: UiChromeTableName
  defaults(): T
  sanitize(value: unknown): T
  debounceMs?: number
  api?: UiChromeStorageApi
}

export type UiChromeStorageAvailability = 'available' | 'unavailable'

function copy<T>(value: T): T {
  return structuredClone(value)
}

/**
 * One table's client storage handle. A failed transport keeps the current
 * in-memory view responsive and retains the latest failed write for a later
 * flush or save.
 */
export class UiChromeStorage<T> {
  private readonly api: UiChromeStorageApi
  private readonly debounceMs: number
  private pending: T | undefined
  private pendingVersion = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<void> = Promise.resolve()
  private state: UiChromeStorageAvailability = 'available'
  private readonly options: UiChromeStorageOptions<T>

  constructor(options: UiChromeStorageOptions<T>) {
    this.options = options
    this.api = options.api ?? capabilitiesApi
    this.debounceMs = options.debounceMs ?? 250
  }

  availability(): UiChromeStorageAvailability {
    return this.state
  }

  async load(signal?: AbortSignal): Promise<T> {
    try {
      const value = await this.api.get(this.options.table, signal)
      this.state = 'available'
      return copy(this.options.sanitize(value))
    } catch {
      this.state = 'unavailable'
      return copy(this.options.defaults())
    }
  }

  save(value: T): void {
    this.pendingVersion += 1
    this.pending = copy(value)
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flushPending()
    }, this.debounceMs)
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.flushPending()
    await this.queue
  }

  async clear(): Promise<void> {
    this.pendingVersion += 1
    this.pending = undefined
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.queue = this.queue.then(
      async () => {
        await this.api.delete(this.options.table)
        this.state = 'available'
      },
      async () => {
        await this.api.delete(this.options.table)
        this.state = 'available'
      },
    ).catch(() => {
      this.state = 'unavailable'
    })
    await this.queue
  }

  private flushPending(): void {
    const value = this.pending
    if (value === undefined) return
    const version = this.pendingVersion
    this.pending = undefined
    const put = async (): Promise<void> => {
      try {
        await this.api.put(this.options.table, value)
        this.state = 'available'
      } catch {
        // Keep a failed write available for the next explicit flush or save.
        // A newer save wins and prevents an older failure from overwriting it.
        if (this.pendingVersion === version && this.pending === undefined) {
          this.pending = value
        }
        this.state = 'unavailable'
      }
    }
    this.queue = this.queue.then(put, put)
  }
}

export function createUiChromeStorage<T>(options: UiChromeStorageOptions<T>): UiChromeStorage<T> {
  return new UiChromeStorage(options)
}
