import {
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { TerminalView } from './TerminalView.tsx'
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  MAX_PANEL_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_PANEL_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  nextTabId,
  tabLabelFromCwd,
  type DockStore,
} from './panel-store.ts'
import { DEFAULT_TAB_LABEL } from './panel-store.ts'
import type { LocaleService, Translate } from '@oh-dsh/shared/i18n'
import { useTranslate } from '@oh-dsh/shared/use-i18n'
import {
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconPlus,
} from '@oh-dsh/shared/icons'
import type { TerminalMessage } from './i18n.ts'

export interface TerminalPanelProps {
  locale: LocaleService
  t: Translate<TerminalMessage>
  store: DockStore
  scopeKey: string
  cwd: string | null
  active: boolean
}

export function openOrToggleTerminal(store: DockStore): void {
  const state = store.getState()
  if (state.tabs.length === 0) {
    store.dispatch({ type: 'set-collapsed', collapsed: false })
    store.dispatch({ type: 'add-tab', id: nextTabId() })
    return
  }
  store.dispatch({ type: 'toggle-collapsed' })
}

/** Bottom dock adapted from dsh-web-panel and owned by Oh-DSH-Desktop. */
export function TerminalPanel({ locale, t: translate, store, scopeKey, cwd, active }: TerminalPanelProps): JSX.Element {
  const t = useTranslate(locale, translate)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [resizing, setResizing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fontFamilyDraft, setFontFamilyDraft] = useState(state.fontFamily)
  const fontPresetListId = `oh-dsh-terminal-fonts-${encodeURIComponent(scopeKey)}`

  useEffect(() => { setFontFamilyDraft(state.fontFamily) }, [state.fontFamily])
  useEffect(() => {
    if (!active) return
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.key !== '`') return
      event.preventDefault()
      openOrToggleTerminal(store)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => { window.removeEventListener('keydown', handleShortcut) }
  }, [active, store])

  const addTab = (): void => {
    store.dispatch({ type: 'set-collapsed', collapsed: false })
    store.dispatch({ type: 'add-tab', id: nextTabId() })
  }
  const commitFontFamily = (): void => {
    store.dispatch({ type: 'set-font-family', fontFamily: fontFamilyDraft })
  }
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startY = event.clientY
    const startSize = state.size
    setResizing(true)
    const move = (next: PointerEvent): void => {
      const available = Math.max(MIN_PANEL_SIZE, window.innerHeight - 190)
      store.dispatch({ type: 'set-size', size: Math.min(available, startSize + startY - next.clientY) })
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setResizing(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    store.dispatch({ type: 'set-size', size: state.size + (event.key === 'ArrowUp' ? 24 : -24) })
  }

  return (
    <section
      className="oh-dsh-terminal-dock"
      data-oh-dsh-terminal-dock=""
      data-collapsed={state.collapsed || undefined}
      aria-label={t('terminal')}
    >
      {!state.collapsed && (
        <div
          className="oh-dsh-terminal-resize"
          role="separator"
          aria-label={t('terminal.resize')}
          aria-orientation="horizontal"
          aria-valuemin={MIN_PANEL_SIZE}
          aria-valuemax={MAX_PANEL_SIZE}
          aria-valuenow={state.size}
          tabIndex={0}
          onPointerDown={beginResize}
          onKeyDown={resizeWithKeyboard}
        />
      )}
      <div className="oh-dsh-terminal-bar">
        <div className="oh-dsh-terminal-tabs" role="tablist" aria-label={t('terminal.tabs')}>
          {state.tabs.map(tab => (
            <span
              key={tab.id}
              role="tab"
              aria-selected={tab.id === state.activeTabId}
              className={`oh-dsh-terminal-tab${tab.id === state.activeTabId ? ' is-active' : ''}`}
              onClick={() => { store.dispatch({ type: 'activate-tab', id: tab.id }) }}
            >
              <span className={`oh-dsh-terminal-status is-${tab.status}`} aria-hidden="true" />
              <span className="oh-dsh-terminal-tab-label">
                {tab.label === DEFAULT_TAB_LABEL ? t('terminal.shell') : tab.label}
                {tab.status === 'exited'
                  ? ` · ${t('terminal.status.exited')}`
                  : tab.status === 'error' ? ` · ${t('terminal.status.error')}` : ''}
              </span>
              <button
                type="button"
                className="oh-dsh-terminal-tab-close"
                aria-label={t('terminal.close-tab', { tab: tab.label })}
                onClick={(event) => {
                  event.stopPropagation()
                  store.dispatch({ type: 'remove-tab', id: tab.id })
                }}
              ><IconClose size={10} /></button>
            </span>
          ))}
          <button
            type="button"
            className="oh-dsh-terminal-add"
            onClick={addTab}
            title={t('terminal.new-shell')}
            aria-label={t('terminal.new-shell')}
          ><IconPlus size={13} /></button>
          {state.tabs.length === 0 && <span className="oh-dsh-terminal-hint">{t('terminal')}</span>}
        </div>
        <div className="oh-dsh-terminal-actions">
          <button
            type="button"
            className="oh-dsh-terminal-action"
            onClick={() => { setSettingsOpen(open => !open) }}
            title={t('terminal.font')}
            aria-label={t('terminal.font-settings')}
            aria-expanded={settingsOpen}
          >Aa</button>
          <button
            type="button"
            className="oh-dsh-terminal-action"
            onClick={() => { store.dispatch({ type: 'toggle-collapsed' }) }}
            title={state.collapsed ? t('terminal.expand') : t('terminal.collapse')}
            aria-label={state.collapsed ? t('terminal.expand') : t('terminal.collapse')}
          >{state.collapsed ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}</button>
        </div>
      </div>
      {settingsOpen && (
        <div className="oh-dsh-terminal-settings" role="dialog" aria-label={t('terminal.font-settings')}>
          <div className="oh-dsh-terminal-settings-header">
            <strong>{t('terminal.font')}</strong>
            <button type="button" onClick={() => { setSettingsOpen(false) }} aria-label={t('terminal.close-settings')}>×</button>
          </div>
          <label>
            <span>{t('terminal.font-family')}</span>
            <input
              type="text"
              list={fontPresetListId}
              value={fontFamilyDraft}
              onChange={event => { setFontFamilyDraft(event.currentTarget.value) }}
              onBlur={commitFontFamily}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                commitFontFamily()
                event.currentTarget.blur()
              }}
            />
            <datalist id={fontPresetListId}>
              <option value={DEFAULT_TERMINAL_FONT_FAMILY} />
              <option value="'JetBrains Mono', ui-monospace, monospace" />
              <option value="'Maple Mono', ui-monospace, monospace" />
              <option value="'Fira Code', ui-monospace, monospace" />
            </datalist>
          </label>
          <label>
            <span>{t('terminal.font-size')}</span>
            <input
              type="number"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              value={state.fontSize}
              onChange={event => { store.dispatch({ type: 'set-font-size', fontSize: event.currentTarget.valueAsNumber }) }}
            />
          </label>
          <div className="oh-dsh-terminal-settings-footer">
            <span>{MIN_TERMINAL_FONT_SIZE}–{MAX_TERMINAL_FONT_SIZE}px</span>
            <button type="button" onClick={() => { store.dispatch({ type: 'reset-font' }) }}>{t('terminal.reset')}</button>
          </div>
        </div>
      )}
      <div
        className={`oh-dsh-terminal-body${resizing ? ' is-resizing' : ''}`}
        style={{ height: state.collapsed ? 0 : state.size }}
        aria-hidden={state.collapsed}
      >
        {state.tabs.map(tab => (
          <div
            key={tab.id}
            className="oh-dsh-terminal-surface"
            style={{ display: tab.id === state.activeTabId ? 'flex' : 'none' }}
            aria-hidden={tab.id !== state.activeTabId}
          >
            <TerminalView
              sessionId={scopeKey}
              tabId={tab.id}
              cwd={cwd}
              fontFamily={state.fontFamily}
              fontSize={state.fontSize}
              onReady={readyCwd => {
                store.dispatch({ type: 'rename-tab', id: tab.id, label: tabLabelFromCwd(readyCwd) })
              }}
              onStatus={(status, exitCode) => {
                store.dispatch({
                  type: 'update-tab',
                  id: tab.id,
                  status,
                  ...(exitCode === undefined ? {} : { exitCode }),
                })
              }}
              t={t}
            />
          </div>
        ))}
        {state.tabs.length === 0 && (
          <div className="oh-dsh-terminal-empty">
            <span>{t('terminal.empty')}</span>
            <button type="button" onClick={addTab}>{t('terminal.new-shell')}</button>
          </div>
        )}
      </div>
    </section>
  )
}
