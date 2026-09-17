import type { ReactElement } from 'react'
import { useBridge, useData, usePublish, type PanelRef } from '@jaspers-ai/sdk'
import { display as d } from './format'
import type { MoverList } from './server/quotes'
import { Bar, Loading, Section, Signed, useEvery, usePanelStateValue, useStateWriter } from './shared'
import { num, text } from './values'
import { MARKET_SCREENS, MARKET_TABS, marketsOutput, readMarketList, REFRESH_MS, tone, yahooPage } from './views'
import './styles.css'

// The market at a glance: Yahoo's summary strip (index futures, commodities, rates, currencies,
// crypto) as tiles, then one of Yahoo's lists of stocks. Both are asked again every minute. A tab or
// the screens menu writes `list`.

const LIMIT = 25

export function MarketsView({ panel }: { panel: PanelRef }): ReactElement {
  const state = usePanelStateValue(panel)
  const write = useStateWriter(panel)
  if (state === undefined) return <Loading />
  const list = readMarketList(state)
  const screen = MARKET_SCREENS.some((s) => s.list === list)
  return (
    <div className="yf-root">
      <Bar>
        <nav className="yf-tabs" aria-label="Lists">
          {MARKET_TABS.map((tab) => (
            <button
              key={tab.list}
              type="button"
              className={tab.list === list ? 'yf-tab yf-tab-on' : 'yf-tab'}
              aria-pressed={tab.list === list}
              onClick={() => write([['list', tab.list]])}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <select
          className={screen ? 'yf-select yf-tab-on' : 'yf-select'}
          aria-label="Screens"
          value={screen ? list : ''}
          onChange={(event) => event.target.value && write([['list', event.target.value]])}
        >
          <option value="">Screens…</option>
          {MARKET_SCREENS.map((s) => (
            <option key={s.list} value={s.list}>
              {s.label}
            </option>
          ))}
        </select>
      </Bar>
      <div className="yf-body">
        <Markets panel={panel} list={list} />
      </div>
    </div>
  )
}

function Markets({ panel, list }: { panel: PanelRef; list: MoverList }): ReactElement {
  const bridge = useBridge()
  const summary = useData('yfinance/market-summary', {})
  const movers = useData('yfinance/movers', { list, limit: LIMIT })
  useEvery(summary.refetch, REFRESH_MS)
  useEvery(movers.refetch, REFRESH_MS)
  const tiles = summary.data ?? []
  const rows = movers.data ?? []
  const title = text(movers.meta['title'])
  const total = num(movers.meta['total'])
  usePublish(panel, marketsOutput(list, tiles, { title, total, rows }))
  const open = (symbol: string): void => void bridge.openLink(yahooPage(symbol))
  return (
    <>
      <Section title="Markets" run={summary}>
        <div className="yf-tiles">
          {tiles.map((t) => {
            const symbol = text(t['symbol']) ?? ''
            const hint = num(t['priceHint'])
            return (
              <button key={symbol} type="button" className={`yf-tile yf-tile-${tone(num(t['changePercent'])) || 'flat'}`} title={symbol} onClick={() => open(symbol)}>
                <span className="yf-tile-name">{text(t['name']) ?? symbol}</span>
                <span className="yf-tile-price yf-num">{d.price(num(t['price']), hint)}</span>
                <span className="yf-tile-move">
                  <Signed value={num(t['change'])} hint={hint} /> <Signed value={num(t['changePercent'])} percent />
                </span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section
        title={title ?? MARKET_TABS.find((t) => t.list === list)?.label ?? list}
        run={movers}
        aside={rows.length ? `${rows.length}${total !== null ? ` of ${d.fixed(total, 0)}` : ''}` : undefined}
        empty={rows.length === 0}
      >
        {text(movers.meta['description']) && <p className="yf-line yf-muted">{text(movers.meta['description'])}</p>}
        <table className="yf-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th className="yf-num">Price</th>
              <th className="yf-num">Change</th>
              <th className="yf-num">%</th>
              <th className="yf-num">Volume</th>
              <th className="yf-num">Avg volume</th>
              <th className="yf-num">Market cap</th>
              <th className="yf-num">P/E</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => {
              const symbol = text(q['symbol']) ?? ''
              const hint = num(q['priceHint'])
              return (
                <tr key={symbol}>
                  <td>
                    <button type="button" className="yf-link yf-strong" title={yahooPage(symbol)} onClick={() => open(symbol)}>
                      {symbol}
                    </button>
                  </td>
                  <td className="yf-name-cell">{text(q['name'])}</td>
                  <td className="yf-num">{d.price(num(q['price']), hint)}</td>
                  <td className="yf-num">
                    <Signed value={num(q['change'])} hint={hint} />
                  </td>
                  <td className="yf-num">
                    <Signed value={num(q['changePercent'])} percent />
                  </td>
                  <td className="yf-num">{d.big(num(q['volume']))}</td>
                  <td className="yf-num">{d.big(num(q['averageVolume']))}</td>
                  <td className="yf-num">{d.big(num(q['marketCap']))}</td>
                  <td className="yf-num">{d.fixed(num(q['pe']))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>
    </>
  )
}
