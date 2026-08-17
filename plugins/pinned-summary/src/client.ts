/** Layout-reserving pinned summary derived from the active DSH session. */

import type { LocaleService, Translate } from '@oh-dsh/shared/i18n'
import { localeTag } from '@oh-dsh/shared/i18n'
import themeCss from '@oh-dsh/shared/theme.css'
import type { DesktopPanels } from '@oh-dsh/panel-controls/client'
import {
  PINNED_SUMMARY_MESSAGES,
  type PinnedSummaryMessage,
} from './i18n.ts'

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionListSummary {
  id: string
  displayTitle: string
  cwd?: string
  running: boolean
  pendingInteraction?: unknown
  completed?: boolean
  blank: boolean
  updatedAt: number
}

interface SessionListState {
  current?: string
  byId: Record<string, SessionListSummary>
}

interface SessionBinding {
  session: ObservableSnapshot<unknown>
}

interface SessionsService {
  list: ObservableSnapshot<SessionListState>
  binding(id: string): SessionBinding | undefined
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): () => Promise<void> | void
  }
}

/** Public toggle face consumed by the unified desktop client. */
export interface PinnedSummary {
  isOpen(): boolean
  setOpen(open: boolean): void
  subscribe(listener: () => void): () => void
  toggle(): void
}

export const inject = ['desktopPanels', 'locale', 'sessions']

const OPEN_KEY = 'oh-dsh-desktop.pinned-summary.open'

const SUMMARY_CSS = `
html {
  --oh-dsh-pinned-summary-width: 288px;
}

[data-oh-dsh-pinned-summary] {
  position: fixed;
  z-index: 9000;
  top: calc(var(--oh-dsh-titlebar-height, 40px) + 12px);
  right: 12px;
  height: calc((100vh - var(--oh-dsh-titlebar-height, 40px) - 24px) / 2);
  width: var(--oh-dsh-pinned-summary-width);
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 22px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 14px 42px rgb(0 0 0 / 9%);
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(100% + 24px));
  visibility: hidden;
  transition:
    opacity 140ms var(--ds-ease-in-out, ease),
    transform 180ms var(--ds-ease-in-out, ease),
    visibility 0s linear 180ms;
  -webkit-app-region: no-drag;
}

[data-oh-dsh-pinned-summary][data-open='true'] {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
  visibility: visible;
  transition-delay: 0s;
}

[data-oh-dsh-summary-header] {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 10px 0 15px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  box-sizing: border-box;
  font-size: 13px;
  font-weight: 600;
}

[data-oh-dsh-summary-close] {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 18px;
}

[data-oh-dsh-summary-close]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

[data-oh-dsh-summary-body] {
  height: calc(100% - 48px);
  padding: 14px 15px 16px;
  box-sizing: border-box;
  overflow: auto;
}

[data-oh-dsh-summary-title] {
  margin: 0;
  font-size: 14px;
  line-height: 1.35;
}

[data-oh-dsh-summary-meta] {
  margin: 6px 0 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

[data-oh-dsh-summary-source] {
  display: inline-flex;
  margin-bottom: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 600;
}

[data-oh-dsh-summary-text] {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  [data-oh-dsh-pinned-summary] { box-shadow: -20px 0 48px rgb(0 0 0 / 14%); }
}

@media (prefers-reduced-motion: reduce) {
  [data-oh-dsh-pinned-summary] { transition: none; }
}
`

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open))
  } catch {
    // Preferences are best-effort in restricted browser storage modes.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function conversationNodes(snapshot: unknown): unknown[] {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes)) return []
  return snapshot.nodes
}

function latestSummary(nodes: readonly unknown[]): { kind: 'context' | 'assistant'; text: string } | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (!isRecord(node)) continue
    if (node.kind === 'compaction' && typeof node.summary === 'string' && node.summary.trim() !== '') {
      return { kind: 'context', text: node.summary.trim() }
    }
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (!isRecord(node) || node.kind !== 'assistant' || !Array.isArray(node.blocks)) continue
    const text = node.blocks.flatMap((block) => {
      return isRecord(block) && block.kind === 'text' && typeof block.text === 'string' ? [block.text] : []
    }).join('\n').trim()
    if (text !== '') return { kind: 'assistant', text: text.slice(0, 5000) }
  }
  return undefined
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`pinned-summary: missing ${selector}`)
  return element
}

class PinnedSummaryService implements PinnedSummary {
  readonly #sessions: SessionsService
  readonly #locale: LocaleService
  readonly #t: Translate<PinnedSummaryMessage>
  readonly #panels: DesktopPanels
  readonly #listeners = new Set<() => void>()
  #open = readOpen()
  #panel: HTMLElement | undefined
  #style: HTMLStyleElement | undefined
  #title: HTMLElement | undefined
  #headerTitle: HTMLElement | undefined
  #close: HTMLButtonElement | undefined
  #meta: HTMLElement | undefined
  #source: HTMLElement | undefined
  #text: HTMLElement | undefined
  #currentId: string | undefined
  #unsubscribeList: (() => void) | undefined
  #unsubscribeSession: (() => void) | undefined
  #unsubscribeLocale: (() => void) | undefined
  readonly #narrowViewport = window.matchMedia('(max-width: 900px)')
  readonly #handleViewportChange = (): void => { this.applyState() }

  constructor(
    sessions: SessionsService,
    locale: LocaleService,
    t: Translate<PinnedSummaryMessage>,
    panels: DesktopPanels,
  ) {
    this.#sessions = sessions
    this.#locale = locale
    this.#t = t
    this.#panels = panels
  }

  mount(): void {
    this.#style = document.createElement('style')
    this.#style.dataset.ohDshPinnedSummaryStyles = 'true'
    this.#style.textContent = `${themeCss}\n${SUMMARY_CSS}`
    document.head.append(this.#style)

    const panel = document.createElement('aside')
    panel.dataset.ohDshPinnedSummary = 'true'
    panel.setAttribute('aria-label', this.#t('summary.label'))
    panel.innerHTML = `
      <header data-oh-dsh-summary-header>
        <span></span>
        <button data-oh-dsh-summary-close type="button" aria-label="Close"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M14.1168 13.197L13.197 14.1167L1.8833 2.80303L2.80309 1.88324L14.1168 13.197Z" fill="currentColor"/><path d="M13.197 1.88326L14.1168 2.80305L2.80309 14.1168L1.8833 13.197L13.197 1.88326Z" fill="currentColor"/></svg></button>
      </header>
      <div data-oh-dsh-summary-body>
        <h2 data-oh-dsh-summary-title></h2>
        <div data-oh-dsh-summary-meta></div>
        <span data-oh-dsh-summary-source></span>
        <p data-oh-dsh-summary-text></p>
      </div>
    `
    document.body.append(panel)
    this.#panel = panel
    this.#title = required(panel, '[data-oh-dsh-summary-title]')
    this.#headerTitle = required(panel, '[data-oh-dsh-summary-header] span')
    this.#close = required(panel, '[data-oh-dsh-summary-close]')
    this.#meta = required(panel, '[data-oh-dsh-summary-meta]')
    this.#source = required(panel, '[data-oh-dsh-summary-source]')
    this.#text = required(panel, '[data-oh-dsh-summary-text]')
    this.#close.addEventListener('click', () => { this.setOpen(false) })
    this.#narrowViewport.addEventListener('change', this.#handleViewportChange)
    this.#unsubscribeList = this.#sessions.list.subscribe(() => { this.bindAndRender() })
    this.#unsubscribeLocale = this.#locale.subscribe(() => {
      this.renderChrome()
      this.render()
    })
    this.renderChrome()
    this.applyState()
    this.bindAndRender()
  }

  dispose(): void {
    this.#unsubscribeList?.()
    this.#unsubscribeSession?.()
    this.#unsubscribeLocale?.()
    this.#narrowViewport.removeEventListener('change', this.#handleViewportChange)
    this.#panel?.remove()
    this.#style?.remove()
    delete document.documentElement.dataset.ohDshSummaryPinned
    this.#panels.releaseRightPanel('pinned-summary')
  }

  isOpen(): boolean {
    return this.#open
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  toggle(): void {
    this.setOpen(!this.#open)
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return
    this.#open = open
    writeOpen(open)
    this.applyState()
    for (const listener of this.#listeners) listener()
  }

  private applyState(): void {
    const html = document.documentElement
    if (this.#panel !== undefined) {
      this.#panel.dataset.open = String(this.#open)
      this.#panel.setAttribute('aria-hidden', String(!this.#open))
    }
    if (this.#open) {
      html.dataset.ohDshSummaryPinned = 'true'
      // The #root squeeze is owned by the desktopPanels right-panel
      // coordinator — claim the footprint instead of writing global state.
      this.#panels.claimRightPanel('pinned-summary', {
        paddingRight: this.#narrowViewport.matches
          ? '0px'
          : 'calc(var(--oh-dsh-pinned-summary-width) + 24px)',
      })
    } else {
      delete html.dataset.ohDshSummaryPinned
      this.#panels.releaseRightPanel('pinned-summary')
    }
  }

  private bindAndRender(): void {
    const list = this.#sessions.list.getSnapshot()
    const currentId = list.current
    if (currentId !== this.#currentId) {
      this.#unsubscribeSession?.()
      this.#unsubscribeSession = undefined
      this.#currentId = currentId
      if (currentId !== undefined) {
        this.#unsubscribeSession = this.#sessions.binding(currentId)?.session.subscribe(() => { this.render() })
      }
    }
    this.render()
  }

  private renderChrome(): void {
    this.#panel?.setAttribute('aria-label', this.#t('summary.label'))
    if (this.#headerTitle !== undefined) this.#headerTitle.textContent = this.#t('summary.title')
    if (this.#close !== undefined) {
      const label = this.#t('summary.close')
      this.#close.setAttribute('aria-label', label)
      this.#close.title = label
    }
  }

  private render(): void {
    if (this.#title === undefined || this.#meta === undefined || this.#source === undefined || this.#text === undefined) return
    const list = this.#sessions.list.getSnapshot()
    const id = list.current
    const summary = id === undefined ? undefined : list.byId[id]
    if (id === undefined || summary === undefined) {
      this.#title.textContent = this.#t('summary.no-active')
      this.#meta.textContent = this.#t('summary.select-session')
      this.#source.textContent = this.#t('summary.session')
      this.#text.textContent = this.#t('summary.empty-placeholder')
      return
    }
    const binding = this.#sessions.binding(id)
    const derived = latestSummary(conversationNodes(binding?.session.getSnapshot()))
    const status = summary.running
      ? this.#t('summary.status.running')
      : summary.pendingInteraction !== undefined
        ? this.#t('summary.status.waiting')
        : this.#t('summary.status.ready')
    this.#title.textContent = summary.displayTitle
    this.#meta.textContent = [
      status,
      summary.cwd,
      this.#t('summary.updated', {
        time: new Date(summary.updatedAt).toLocaleString(localeTag(this.#locale)),
      }),
    ].filter((part): part is string => typeof part === 'string' && part !== '').join(' · ')
    this.#source.textContent = derived === undefined
      ? this.#t('summary.source.overview')
      : derived.kind === 'context'
        ? this.#t('summary.source.context')
        : this.#t('summary.source.assistant')
    this.#text.textContent = derived?.text
      ?? (summary.blank
        ? this.#t('summary.blank')
        : this.#t('summary.unavailable'))
  }
}

/** Provide the pinned-summary service and its layout-reserving DOM surface. */
export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<PinnedSummaryMessage> = locale.bind('oh-dsh.pinned-summary')
  ctx.effect(
    () => locale.register('oh-dsh.pinned-summary', PINNED_SUMMARY_MESSAGES),
    'oh-dsh-desktop: pinned summary dictionaries',
  )
  const service = new PinnedSummaryService(
    ctx.get('sessions') as SessionsService,
    locale,
    t,
    ctx.get('desktopPanels') as DesktopPanels,
  )
  ctx.effect(() => {
    service.mount()
    const disposeService = ctx.reflect.provide('pinnedSummary', service, undefined)
    return () => {
      service.dispose()
      void disposeService()
    }
  }, 'oh-dsh-desktop: pinned summary')
}
