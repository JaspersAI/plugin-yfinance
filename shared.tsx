import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { useBridge, useData, usePublish, type PanelRef } from '@jaspers-ai/sdk'
import { display as d } from './format'
import { cleanError, position, tone, yahooPage, type Run } from './views'

// What the five views share: the panel's state as one value, writes to it, the bar and its symbol
// field, a section that shows its run's state before its content, figures with their sign, a range
// bar, and the minute timer the quote views ask again on.

/** The panel's whole state, a round trip after the frame mounts; undefined until then. */
export function usePanelStateValue(panel: PanelRef): unknown {
  return useData(`workspaces/${panel.workspaceId}/panels/${panel.id}/state`)
}

/** Writes keys of the panel's state in order; main checks each write against the view's schema. */
export function useStateWriter(panel: PanelRef): (changes: [string, unknown][]) => void {
  const bridge = useBridge()
  return (changes) => {
    void (async () => {
      for (const [key, value] of changes) await bridge.setState(panel, [key], value)
    })()
  }
}

/** Runs `refetch` every `ms` while the view is mounted. */
export function useEvery(refetch: () => void, ms: number): void {
  useEffect(() => {
    const timer = setInterval(refetch, ms)
    return () => clearInterval(timer)
  }, [refetch, ms])
}

export function Loading(): ReactElement {
  return (
    <div className="yf-root">
      <div className="yf-bar">
        <span className="yf-muted">Loading…</span>
      </div>
    </div>
  )
}

export function Bar({ children, symbol }: { children: ReactNode; symbol?: string }): ReactElement {
  const bridge = useBridge()
  const page = symbol ? yahooPage(symbol) : 'https://finance.yahoo.com/'
  return (
    <div className="yf-bar">
      {children}
      <button type="button" className="yf-credit" title={page} onClick={() => void bridge.openLink(page)}>
        Yahoo Finance ↗
      </button>
    </div>
  )
}

/**
 * The symbol field. Enter hands the typed symbol over; a symbol the orchestrator sets shows here.
 * Enter is read off the key: the frame is sandboxed without allow-forms, so a form never submits.
 */
export function SymbolField({
  symbol,
  onSymbol,
  placeholder = 'Symbol',
  clear = false,
}: {
  symbol: string
  onSymbol: (symbol: string) => void
  placeholder?: string
  /** Empty the field after Enter, for a field that adds rather than sets. */
  clear?: boolean
}): ReactElement {
  const [draft, setDraft] = useState(symbol)
  useEffect(() => setDraft(symbol), [symbol])
  return (
    <input
      className="yf-input yf-symbol"
      name="symbol"
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
        event.preventDefault()
        const next = draft.trim().toUpperCase()
        if (next) onSymbol(next)
        if (clear) setDraft('')
      }}
    />
  )
}

/** A view with nothing to show yet says so, and publishes that. */
export function Empty({ panel, output, children }: { panel: PanelRef; output: Record<string, unknown>; children: ReactNode }): ReactElement {
  usePublish(panel, output)
  return <p className="yf-empty">{children}</p>
}

/** A titled block: its run's error (Yahoo's own words) or loading line first, then its content. */
export function Section({
  title,
  run,
  aside,
  empty,
  children,
}: {
  title: string
  run?: Pick<Run, 'loading' | 'error'>
  aside?: ReactNode
  empty?: boolean
  children?: ReactNode
}): ReactElement {
  return (
    <section className="yf-section">
      <h2 className="yf-h">
        <span>{title}</span>
        {aside && <span className="yf-muted yf-aside">{aside}</span>}
        {run?.loading && <span className="yf-muted yf-aside">loading…</span>}
      </h2>
      {run?.error ? <p className="yf-error">{cleanError(run.error)}</p> : empty && !run?.loading ? <p className="yf-muted">Nothing from Yahoo Finance.</p> : children}
    </section>
  )
}

/** A signed figure, green up and red down. */
export function Signed({ value, percent = false, hint }: { value: number | null | undefined; percent?: boolean; hint?: number | null }): ReactElement {
  const shown = percent ? d.signedPercent(value) : d.signed(value, typeof hint === 'number' ? hint : 2)
  return <span className={`yf-num yf-${tone(value) || 'flat'}`}>{shown}</span>
}

/** A track from low to high with a mark where the value is, and the ends written under it. */
export function RangeBar({
  label,
  low,
  high,
  value,
  mark,
  hint,
}: {
  label: string
  low: number | null
  high: number | null
  value: number | null
  /** A second, hollow mark, like the mean target. */
  mark?: { value: number | null; title: string }
  hint?: number | null
}): ReactElement | null {
  const at = position(low, high, value)
  if (at === null) return null
  const second = mark ? position(low, high, mark.value) : null
  return (
    <div className="yf-range">
      <div className="yf-range-label yf-muted">{label}</div>
      <div className="yf-track">
        {second !== null && <span className="yf-mark yf-mark-hollow" style={{ left: `${second * 100}%` }} title={mark!.title} />}
        <span className="yf-mark" style={{ left: `${at * 100}%` }} title={d.price(value, hint)} />
      </div>
      <div className="yf-range-ends yf-num yf-muted">
        <span>{d.price(low, hint)}</span>
        <span>{d.price(high, hint)}</span>
      </div>
    </div>
  )
}

/** Market state in words. */
export function marketState(state: string | null): string {
  switch (state) {
    case 'PRE':
      return 'Pre-market'
    case 'REGULAR':
      return 'Market open'
    case 'POST':
      return 'After hours'
    case null:
      return ''
    default:
      return 'Market closed'
  }
}
