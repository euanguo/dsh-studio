/**
 * Type shims for runtime-provided external modules (esbuild externals in
 * build-config.mjs). The host never bundles these — DSH provides them at
 * runtime — so their types are declared structurally here.
 */
declare module 'cordis' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface Context {
    [key: string]: any
    inject(names: string[], callback: (service: any) => void): void
    effect(callback: () => void, name?: string): void
  }
  export type Service<T = Record<string, unknown>> = T & Context
}

declare module '@deepseek-ai/cordis' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface Context {
    [key: string]: any
    inject(names: string[], callback: (service: any) => void): void
    effect(callback: () => void, name?: string): void
  }
  export type Service<T = Record<string, unknown>> = T & Context
}

declare module '@deepseek-ai/dsh-tools' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function defineTool(options: any): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ToolRunContext = any
}

declare module '@deepseek-ai/dsh-llm' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ContentBlock = any
}

declare module '@deepseek-ai/dsh-agent' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Agent = any
}

declare module '@deepseek-ai/dsh-settings' {
  export class SettingsConflictError extends Error {}
  export interface SettingsNamespace { readonly ns: string }
  export function settingsNamespace(ns: string): SettingsNamespace
}

declare module '@deepseek-ai/dsh-storage-domain' {
  export function defineDomain(spec: any): any
  export function domainTable(schema: any): any
}

declare module 'zod' {
  export const z: any
}

declare module 'ws' {
  export class WebSocket {
    constructor(url: string, protocols?: string | string[])
    send(data: unknown): void
    close(code?: number, reason?: string): void
    on(event: string, listener: (...args: any[]) => void): this
    readyState: number
    bufferedAmount: number
    static readonly CONNECTING: number
    static readonly OPEN: number
    static readonly CLOSING: number
    static readonly CLOSED: number
  }
  export class WebSocketServer {
    constructor(options: {
      port?: number
      server?: unknown
      host?: string
      noServer?: boolean
    })
    on(event: string, listener: (...args: any[]) => void): this
    close(callback?: () => void): void
    handleUpgrade(
      request: unknown,
      socket: unknown,
      head: unknown,
      callback: (ws: WebSocket) => void,
    ): void
  }
}
