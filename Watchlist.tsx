import { useEffect, useState, type ReactElement } from 'react'
import { useBridge, useData, usePublish, type PanelRef } from '@jaspers-ai/sdk'
import { display as d } from './format'
import { Bar, Empty, Loading, Section, Signed, SymbolField, useEvery, usePanelStateValue, useStateWriter } from './shared'
import { num, text } from './values'
import { addSymbol, readWatchlist, REFRESH_MS, removeSymbol, watchlistOutput, WATCHLIST_MAX, yahooPage } from './views'
import './styles.css'

// A list of symbols with their quotes, asked again every minute. The field adds a symbol and the
// cross removes one; both write the whole list to state, which is also how the orchestrator sets it.

export function WatchlistView({ panel }: { panel: PanelRef }): ReactElement {
  const state = usePanelStateValue(panel)
  const write = useStateWriter(panel)
  if (state === undefined) return <Loading />
  const symbols = readWatchlist(state)
  const set = (next: string[]): void => write([['symbols', next]])
  return (
    <div className="yf-root">
      <Bar>
        <SymbolField symbol="" placeholder="Add symbol" clear onSymbol={(symbol) => set(addSymbol(symbols, symbol))} />
        <span className="yf-muted">
          Watchlist · {symbols.length} of {WATCHLIST_MAX}
        </span>
      </Bar>
      <div className="yf-body">
        {symbols.length ? (
          <Quotes panel={panel} symbols={symbols} onRemove={(symbol) => set(removeSymbol(symbols, symbol))} />
        ) : (
          <Empty panel={panel} output={watchlistOutput([], [])}>
            Add a symbol: AAPL, ^GSPC, BTC-USD, EURUSD=X.
          </Empty>
        )}
      </div>
    </div>
  )
}

function Quotes({ panel, symbols, onRemove }: { panel: PanelRef; symbols: string[]; onRemove: (symbol: string) => void }): ReactElement {
  const bridge = useBridge()
  const run = useData('yfinance/quote', { symbols })
  useEvery(run.refetch, REFRESH_MS)
  const [updated, setUpdated] = useState<string | null>(null)
  useEffect(() => {
    if (run.data) setUpdated(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }))
  }, [run.data])
  const quotes = run.data ?? []
  usePublish(panel, watchlistOutput(symbols, quotes))
  const bySymbol = new Map(quotes.map((q) => [text(q['symbol']) ?? '', q]))
  return (
    <Section title="Quotes" run={run} aside={updated ? `updated ${updated}, every minute` : undefined}>
      <table className="yf-table yf-quotes">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Name</th>
            <th className="yf-num">Last</th>
            <th className="yf-num">Change</th>
            <th className="yf-num">%</th>
            <th className="yf-num">Volume</th>
            <th className="yf-num">Market cap</th>
            <th className="yf-num">Day range</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol) => {
            const q = bySymbol.get(symbol)
            const hint = num(q?.['priceHint'])
            const low = num(q?.['dayLow'])
            const high = num(q?.['dayHigh'])
            return (
              <tr key={symbol}>
                <td>
                  <button type="button" className="yf-link yf-strong" title={yahooPage(symbol)} onClick={() => void bridge.openLink(yahooPage(symbol))}>
                    {symbol}
                  </button>
                </td>
                <td className="yf-name-cell">{q ? text(q['name']) : <span className="yf-muted">{run.loading ? '…' : 'not found'}</span>}</td>
                <td className="yf-num">{q ? d.price(num(q['price']), hint) : ''}</td>
                <td className="yf-num">{q && <Signed value={num(q['change'])} hint={hint} />}</td>
                <td className="yf-num">{q && <Signed value={num(q['changePercent'])} percent />}</td>
                <td className="yf-num">{q ? d.big(num(q['volume'])) : ''}</td>
                <td className="yf-num">{q ? d.big(num(q['marketCap'])) : ''}</td>
                <td className="yf-num yf-muted">{low !== null && high !== null ? `${d.price(low, hint)}–${d.price(high, hint)}` : ''}</td>
                <td>
                  <button type="button" className="yf-x" aria-label={`Remove ${symbol}`} title={`Remove ${symbol}`} onClick={() => onRemove(symbol)}>
                    ×
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}
