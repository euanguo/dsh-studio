/**
 * Pinned summary service: imperative-DOM surface (no React) that renders a
 * layout-reserving floating summary of the active session, reserving its
 * footprint through the workbench LayoutService right-panel region so the
 * center column never overlaps.
 *
 * Split out of client.ts (single-file plugin) so the entry keeps only the
 * service wire-up; the stylesheet lives in summary.css and mounts through
 * the shared style injector.
 *
 * State convention (ADR, B7): the consumer-facing face exposes only the
 * toggle surface (setOpen/toggle); open state is a single private field
 * mirrored to the ui-chrome flags. Subtle state stores stay small hand-written
 * hold-ons (see plugins/shared/toast.tsx for the rationale); heavier stores
 * use zustand or the official client-runtime defineStore.
 */
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { localeTag } from '@dsh-studio/shared/i18n'
import themeCss from '@dsh-studio/shared/theme.css'
import type {
  LayoutService,
  WorkspaceEventsService,
} from '@dsh-studio/shared/workbench-contracts'
import { ensureLayoutDom } from '@dsh-studio/shared/layout-dom'
import { ensureStyle } from '@dsh-studio/shared/style-injector'
import {
  PINNED_SUMMARY_MESSAGES,
  type PinnedSummaryMessage,
} from './i18n.ts'
import summaryCss from './summary.css'
import { loadUiChromeFlags, setUiChromeFlag } from '@dsh-studio/shared/ui-chrome-flags'

/**
 * Footprint reserved from the center column while the summary is pinned on
 * a wide viewport: the card width (`--dsh-studio-pinned-summary-width`,
 * 288px) plus its window-edge gap.
 */
export const PINNED_SUMMARY_RESERVE_PX = 288 + 24

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

export interface SessionsService {
  list: ObservableSnapshot<SessionListState>
  binding(id: string): SessionBinding | undefined
}

/** Public toggle face consumed by the unified desktop client. */
export interface PinnedSummary {
  setOpen(open: boolean): void
  toggle(): void
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
  readonly #dom: ReturnType<typeof ensureLayoutDom>
  readonly #events: WorkspaceEventsService
  #open = false
  #panel: HTMLElement | undefined
  #overlay: (() => void) | undefined
  #stopStyle: (() => void) | undefined
  #title: HTMLElement | undefined
  #headerTitle: HTMLElement | undefined
  #close: HTMLButtonElement | undefined
  #meta: HTMLElement | undefined
  #source: HTMLElement | undefined
  #text: HTMLElement | undefined
  #currentId: string | undefined
  #unsubscribeIdentity: (() => void) | undefined
  #unsubscribeWorkspace: (() => void) | undefined
  #unsubscribeSession: (() => void) | undefined
  #unsubscribeLocale: (() => void) | undefined
  readonly #narrowViewport = window.matchMedia('(max-width: 900px)')
  readonly #handleViewportChange = (): void => { this.applyState() }

  constructor(
    sessions: SessionsService,
    locale: LocaleService,
    t: Translate<PinnedSummaryMessage>,
    layout: LayoutService,
    events: WorkspaceEventsService,
  ) {
    this.#sessions = sessions
    this.#locale = locale
    this.#t = t
    this.#dom = ensureLayoutDom(layout)
    this.#events = events
  }

  async hydrate(): Promise<void> {
    const flags = await loadUiChromeFlags()
    if (this.#open === flags.pinnedSummaryOpen) return
    this.#open = flags.pinnedSummaryOpen
    this.applyState()
  }

  mount(): void {
    // The stylesheet mounts through the shared injector (head-owned) — the
    // overlay region protocol is for body-level elements only.
    this.#stopStyle = ensureStyle('dsh-studio-pinned-summary', `${themeCss}\n${summaryCss}`)

    const panel = document.createElement('aside')
    panel.dataset.dshStudioPinnedSummary = 'true'
    panel.setAttribute('aria-label', this.#t('summary.label'))
    panel.innerHTML = `
      <header data-dsh-studio-summary-header>
        <span></span>
        <button data-dsh-studio-summary-close type="button" aria-label="Close"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M14.1168 13.197L13.197 14.1167L1.8833 2.80303L2.80309 1.88324L14.1168 13.197Z" fill="currentColor"/><path d="M13.197 1.88326L14.1168 2.80305L2.80309 14.1168L1.8833 13.197L13.197 1.88326Z" fill="currentColor"/></svg></button>
      </header>
      <div data-dsh-studio-summary-body>
        <h2 data-dsh-studio-summary-title></h2>
        <div data-dsh-studio-summary-meta></div>
        <span data-dsh-studio-summary-source></span>
        <p data-dsh-studio-summary-text></p>
      </div>
    `
    // Body-level mounting goes through the overlay region protocol: the
    // host claims the overlay stacking layer and owns element removal.
    this.#overlay = this.#dom.mountOverlay('pinned-summary', panel).release
    this.#panel = panel
    this.#title = required(panel, '[data-dsh-studio-summary-title]')
    this.#headerTitle = required(panel, '[data-dsh-studio-summary-header] span')
    this.#close = required(panel, '[data-dsh-studio-summary-close]')
    this.#meta = required(panel, '[data-dsh-studio-summary-meta]')
    this.#source = required(panel, '[data-dsh-studio-summary-source]')
    this.#text = required(panel, '[data-dsh-studio-summary-text]')
    this.#close.addEventListener('click', () => { this.setOpen(false) })
    this.#narrowViewport.addEventListener('change', this.#handleViewportChange)
    // Switching awareness rides the kernel identity events (leaf-1.7): a
    // session or workspace switch re-binds the rendered conversation. Content
    // refreshes still come from the bound conversation snapshot below.
    this.#unsubscribeIdentity = this.#events.onSessionChanged(() => { this.bindAndRender() })
    this.#unsubscribeWorkspace = this.#events.onWorkspaceChanged(() => { this.bindAndRender() })
    this.#unsubscribeLocale = this.#locale.subscribe(() => {
      this.renderChrome()
      this.render()
    })
    this.renderChrome()
    this.applyState()
    this.bindAndRender()
  }

  dispose(): void {
    this.#unsubscribeIdentity?.()
    this.#unsubscribeWorkspace?.()
    this.#unsubscribeSession?.()
    this.#unsubscribeLocale?.()
    this.#narrowViewport.removeEventListener('change', this.#handleViewportChange)
    this.#overlay?.()
    this.#overlay = undefined
    this.#stopStyle?.()
    this.#stopStyle = undefined
    this.#dom.applyDocumentStyles({ flags: { dshStudioSummaryPinned: null } })
    this.#dom.releasePanel('pinned-summary')
  }

  toggle(): void {
    this.setOpen(!this.#open)
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return
    this.#open = open
    setUiChromeFlag('pinnedSummaryOpen', open)
    this.applyState()
  }

  private applyState(): void {
    if (this.#panel !== undefined) {
      this.#panel.dataset.open = String(this.#open)
      this.#panel.setAttribute('aria-hidden', String(!this.#open))
    }
    if (this.#open) {
      // The center-column reservation is negotiated through the LayoutService
      // right-panel region; the pinned flag is set through the same region
      // host's document-style channel (single write point).
      this.#dom.applyDocumentStyles({ flags: { dshStudioSummaryPinned: 'true' } })
      this.#dom.reservePanel(
        'pinned-summary',
        this.#narrowViewport.matches ? 0 : PINNED_SUMMARY_RESERVE_PX,
      )
    } else {
      this.#dom.applyDocumentStyles({ flags: { dshStudioSummaryPinned: null } })
      this.#dom.releasePanel('pinned-summary')
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

export { PinnedSummaryService }