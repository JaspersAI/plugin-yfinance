import { useState, type ReactElement } from 'react'
import { useBridge, useData, usePublish, type PanelRef, type SourceData } from '@jaspers-ai/sdk'
import { display as d } from './format'
import { Bar, Empty, Loading, marketState, RangeBar, Section, Signed, SymbolField, usePanelStateValue, useStateWriter } from './shared'
import { num, record, records, text, type Row } from './values'
import { cleanError, isFund, overviewOutput, overviewStats, ratingAction, ratingMix, readSymbol, smallPercent } from './views'
import './styles.css'

// One company or fund on a page: the quote, the 52-week range, key statistics, the analysts'
// targets and ratings, earnings, and the profile, and for a fund its holdings. A run per tool, each
// drawn as it lands; a section with nothing to show stays out.

export function OverviewView({ panel }: { panel: PanelRef }): ReactElement {
  const state = usePanelStateValue(panel)
  const write = useStateWriter(panel)
  if (state === undefined) return <Loading />
  const symbol = readSymbol(state)
  return (
    <div className="yf-root">
      <Bar symbol={symbol || undefined}>
        <SymbolField symbol={symbol} onSymbol={(next) => write([['symbol', next]])} />
        <span className="yf-muted">Company</span>
      </Bar>
      <div className="yf-body">
        {symbol ? (
          <Overview key={symbol} panel={panel} symbol={symbol} />
        ) : (
          <Empty panel={panel} output={{ symbol: '', errors: [] }}>
            Enter a symbol: AAPL, SHOP.TO, SPY.
          </Empty>
        )}
      </div>
    </div>
  )
}

function Overview({ panel, symbol }: { panel: PanelRef; symbol: string }): ReactElement {
  const quote = useData('yfinance/quote', { symbols: [symbol] })
  const statistics = useData('yfinance/statistics', { symbol })
  const analysts = useData('yfinance/analysts', { symbol, limit: 5 })
  const earnings = useData('yfinance/earnings', { symbol })
  const profile = useData('yfinance/profile', { symbol })
  const output = overviewOutput(symbol, { quote, statistics, analysts, earnings, profile })
  usePublish(panel, output)
  const q = quote.data?.[0] ?? {}
  const hint = num(q['priceHint'])
  return (
    <>
      <header className="yf-head">
        <div className="yf-title">
          <span className="yf-name">{output.name ?? symbol}</span>
          <span className="yf-muted">{[symbol, text(q['exchange']), output.currency].filter(Boolean).join(' · ')}</span>
        </div>
        {quote.error ? (
          <p className="yf-error">{cleanError(quote.error)}</p>
        ) : (
          <div className="yf-price-line">
            <span className="yf-price yf-num">{quote.loading && output.price === null ? '…' : d.price(output.price, hint)}</span>
            <Signed value={num(q['change'])} hint={hint} />
            <Signed value={output.changePercent} percent />
            <span className="yf-muted">{marketState(output.marketState)}</span>
            <Extended quote={q} />
          </div>
        )}
        <div className="yf-ranges">
          <RangeBar label="Day range" low={num(q['dayLow'])} high={num(q['dayHigh'])} value={output.price} hint={hint} />
          <RangeBar label="52-week range" low={output.fiftyTwoWeekLow} high={output.fiftyTwoWeekHigh} value={output.price} hint={hint} />
        </div>
      </header>
      <Statistics run={statistics} />
      {isFund(output.type) && <Fund symbol={symbol} />}
      <Analysts run={analysts} price={output.price} hint={hint} />
      <Earnings run={earnings} />
      <Profile run={profile} />
    </>
  )
}

function Extended({ quote }: { quote: Row }): ReactElement | null {
  const pre = num(quote['preMarketPrice'])
  const post = num(quote['postMarketPrice'])
  const price = pre ?? post
  if (price === null) return null
  return (
    <span className="yf-muted">
      {pre !== null ? 'Pre-market' : 'Post-market'} <span className="yf-num">{d.price(price, num(quote['priceHint']))}</span>{' '}
      <Signed value={num(quote[pre !== null ? 'preMarketChangePercent' : 'postMarketChangePercent'])} percent />
    </span>
  )
}

function Statistics({ run }: { run: SourceData }): ReactElement | null {
  const stats = overviewStats(run.data)
  if (!run.error && !run.loading && stats.length === 0) return null
  return (
    <Section title="Key statistics" run={run}>
      <dl className="yf-grid">
        {stats.map((s) => (
          <div key={s.key} className="yf-cell">
            <dt className="yf-muted">{s.label}</dt>
            <dd className="yf-num" title={s.value}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

/** A fund's figures, top holdings, and sector weights, from its own run. */
function Fund({ symbol }: { symbol: string }): ReactElement | null {
  const run = useData('yfinance/fund', { symbol })
  const m = run.meta
  const figure = (key: string): number | null => num(m[key])
  const cells: [string, string | null][] = [
    ['Net assets', figure('totalAssets') !== null ? d.big(figure('totalAssets')) : null],
    ['Expense ratio', figure('expenseRatioPercent') !== null ? smallPercent(figure('expenseRatioPercent')) : null],
    ['Yield', figure('yieldPercent') !== null ? d.percent(figure('yieldPercent')) : null],
    ['NAV', figure('nav') !== null ? d.price(figure('nav')) : null],
    ['Year to date', figure('ytdReturnPercent') !== null ? d.signedPercent(figure('ytdReturnPercent')) : null],
    ['3-year average', figure('threeYearReturnPercent') !== null ? d.signedPercent(figure('threeYearReturnPercent')) : null],
    ['5-year average', figure('fiveYearReturnPercent') !== null ? d.signedPercent(figure('fiveYearReturnPercent')) : null],
    ['Beta (3 years)', figure('beta3Year') !== null ? d.fixed(figure('beta3Year')) : null],
    ['Turnover', figure('turnoverPercent') !== null ? d.percent(figure('turnoverPercent')) : null],
    ['Category', text(m['category'])],
    ['Family', text(m['family'])],
    ['Inception', text(m['inception'])],
  ]
  const shown = cells.filter((cell): cell is [string, string] => cell[1] !== null)
  const holdings = run.data ?? []
  const sectors = records(m['sectors'])
  const widest = Math.max(0, ...sectors.map((s) => num(s['percent']) ?? 0))
  if (!run.error && !run.loading && shown.length === 0 && holdings.length === 0) return null
  return (
    <Section title="Fund" run={run} aside={text(m['legalType']) ?? undefined}>
      <dl className="yf-grid">
        {shown.map(([label, value]) => (
          <div key={label} className="yf-cell">
            <dt className="yf-muted">{label}</dt>
            <dd className="yf-num" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="yf-two">
        {holdings.length > 0 && (
          <table className="yf-table">
            <thead>
              <tr>
                <th colSpan={2}>Top holdings</th>
                <th className="yf-num">Weight</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => (
                <tr key={i}>
                  <td className="yf-strong">{text(h['symbol'])}</td>
                  <td className="yf-name-cell">{text(h['name'])}</td>
                  <td className="yf-num">{d.percent(num(h['percent']))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sectors.length > 0 && (
          <div className="yf-bars" aria-label="Sector weights">
            <div className="yf-muted yf-bars-title">Sectors</div>
            {sectors.map((s) => {
              const weight = num(s['percent']) ?? 0
              return (
                <div key={text(s['sector']) ?? ''} className="yf-bar-row">
                  <span className="yf-bar-label">{text(s['sector'])}</span>
                  <span className="yf-bar-track">
                    <span className="yf-bar-fill" style={{ width: `${widest ? (weight / widest) * 100 : 0}%` }} />
                  </span>
                  <span className="yf-num">{d.percent(weight)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Section>
  )
}

function Analysts({ run, price, hint }: { run: SourceData; price: number | null; hint: number | null }): ReactElement | null {
  const target = record(run.meta['target'])
  const recommendation = record(run.meta['recommendation'])
  const month = records(run.meta['trend'])[0]
  const mix = ratingMix(month)
  const changes = run.data ?? []
  const mean = num(target?.['mean'])
  if (!run.error && !run.loading && mean === null && mix.length === 0 && changes.length === 0) return null
  const key = text(recommendation?.['key'])
  const score = num(recommendation?.['mean'])
  const count = num(target?.['analysts'])
  const aside = [key && key.replace(/_/g, ' '), score !== null && `${d.fixed(score)} of 5`, count !== null && `${count} analysts`].filter(Boolean).join(' · ')
  const low = num(target?.['low'])
  const high = num(target?.['high'])
  const span = [low, high, price].filter((v): v is number => v !== null)
  return (
    <Section title="Analysts" run={run} aside={aside}>
      {mean !== null && low !== null && high !== null && (
        <>
          <RangeBar
            label={`Price target: low ${d.price(low, hint)}, mean ${d.price(mean, hint)}, high ${d.price(high, hint)}`}
            low={Math.min(...span)}
            high={Math.max(...span)}
            value={price}
            mark={{ value: mean, title: `Mean target ${d.price(mean, hint)}` }}
            hint={hint}
          />
          <p className="yf-legend yf-muted">
            <span className="yf-key yf-key-solid" /> price <span className="yf-key yf-key-hollow" /> mean target
          </p>
        </>
      )}
      {mix.length > 0 && (
        <>
          <div className="yf-mix" role="img" aria-label={mix.map((m) => `${m.label} ${m.count}`).join(', ')}>
            {mix.map((m) => (
              <span key={m.key} className={`yf-mix-${m.key}`} style={{ width: `${m.share * 100}%` }} title={`${m.label} ${m.count}`} />
            ))}
          </div>
          <p className="yf-legend yf-muted">
            {mix.map((m) => (
              <span key={m.key}>
                <span className={`yf-key yf-mix-${m.key}`} /> {m.label} {m.count}
              </span>
            ))}
          </p>
        </>
      )}
      {changes.length > 0 && (
        <table className="yf-table yf-fit">
          <tbody>
            {changes.map((c, i) => (
              <tr key={i}>
                <td className="yf-muted">{text(c['date'])}</td>
                <td>{text(c['firm'])}</td>
                <td>{ratingAction(text(c['action']), text(c['from']), text(c['to']))}</td>
                <td className="yf-num">
                  {num(c['target']) !== null ? d.price(num(c['target']), hint) : ''}
                  {num(c['priorTarget']) !== null && num(c['priorTarget']) !== num(c['target']) && (
                    <span className="yf-muted"> from {d.price(num(c['priorTarget']), hint)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

function Earnings({ run }: { run: SourceData }): ReactElement | null {
  const next = record(run.meta['next'])
  const quarters = run.data ?? []
  if (!run.error && !run.loading && !next && quarters.length === 0) return null
  const date = text(next?.['date'])
  const aside = date ? `next ${date}${next?.['estimated'] === true ? ' (estimated)' : ''}` : 'next date not announced'
  const eps = num(next?.['epsAverage'])
  const revenue = num(next?.['revenueAverage'])
  return (
    <Section title="Earnings" run={run} aside={aside}>
      {(eps !== null || revenue !== null) && (
        <p className="yf-line">
          Expected: {eps !== null && <>EPS <span className="yf-num">{d.fixed(eps)}</span></>}
          {eps !== null && revenue !== null && ', '}
          {revenue !== null && <>revenue <span className="yf-num">{d.big(revenue)}</span></>}
        </p>
      )}
      {quarters.length > 0 && (
        <table className="yf-table yf-fit">
          <thead>
            <tr>
              <th>Quarter</th>
              <th className="yf-num">EPS estimate</th>
              <th className="yf-num">Actual</th>
              <th className="yf-num">Surprise</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => (
              <tr key={text(q['quarter']) ?? ''}>
                <td>
                  {text(q['fiscalQuarter']) ?? text(q['quarter'])}
                  <span className="yf-muted"> {text(q['reported']) ? `reported ${text(q['reported'])}` : `ended ${text(q['quarter'])}`}</span>
                </td>
                <td className="yf-num">{d.fixed(num(q['epsEstimate']))}</td>
                <td className="yf-num">{d.fixed(num(q['epsActual']))}</td>
                <td className="yf-num">
                  <Signed value={num(q['surprisePercent'])} percent />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

function Profile({ run }: { run: SourceData }): ReactElement | null {
  const bridge = useBridge()
  const [open, setOpen] = useState(false)
  const meta = run.meta
  const summary = text(meta['summary'])
  const website = text(meta['website'])
  const employees = num(meta['employees'])
  const facts = [text(meta['sector']), text(meta['industry']), employees !== null && `${d.fixed(employees, 0)} employees`].filter(Boolean).join(' · ')
  const officers = (run.data ?? []).slice(0, 3)
  if (!run.error && !run.loading && !summary && !facts) return null
  return (
    <Section title="Profile" run={run}>
      {facts && <p className="yf-line">{facts}</p>}
      {(text(meta['address']) || website) && (
        <p className="yf-line yf-muted">
          {text(meta['address'])}
          {website?.startsWith('https://') && (
            <>
              {text(meta['address']) && ' · '}
              <button type="button" className="yf-link" onClick={() => void bridge.openLink(website)}>
                {website.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </button>
            </>
          )}
        </p>
      )}
      {officers.length > 0 && (
        <p className="yf-line yf-muted">{officers.map((o) => [text(o['name']), text(o['title'])].filter(Boolean).join(', ')).join(' · ')}</p>
      )}
      {summary && (
        <>
          <p className={open ? 'yf-summary' : 'yf-summary yf-clamp'}>{summary}</p>
          <button type="button" className="yf-link yf-more" onClick={() => setOpen(!open)}>
            {open ? 'Less' : 'More'}
          </button>
        </>
      )}
    </Section>
  )
}
