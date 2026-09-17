import { Fragment, type ReactElement } from 'react'
import { useData, usePublish, type PanelRef } from '@jaspers-ai/sdk'
import { display as d } from './format'
import { Bar, Empty, Loading, Section, Signed, SymbolField, useEvery, usePanelStateValue, useStateWriter } from './shared'
import { list, num, record, text, type Row } from './values'
import { optionsOutput, readOptionsState, REFRESH_MS, STRIKE_CHOICES, type OptionsState } from './views'
import './styles.css'

// One symbol's option chain for one expiration: calls on the left, puts on the right, the strike
// between them, the in-the-money side shaded, and a rule where the price falls. The chain is asked
// again every minute. A new symbol clears the expiration, since its dates are the old symbol's.

const COLUMNS = ['Last', 'Bid', 'Ask', 'Volume', 'Open int.', 'IV'] as const

export function OptionsView({ panel }: { panel: PanelRef }): ReactElement {
  const state = usePanelStateValue(panel)
  const write = useStateWriter(panel)
  if (state === undefined) return <Loading />
  const read = readOptionsState(state)
  return (
    <div className="yf-root">
      <Bar symbol={read.symbol || undefined}>
        <SymbolField
          symbol={read.symbol}
          onSymbol={(symbol) => symbol !== read.symbol && write([['expiration', null], ['symbol', symbol]])}
        />
        <label className="yf-muted yf-label">
          Strikes each side{' '}
          <select className="yf-select" value={read.strikes} onChange={(event) => write([['strikes', Number(event.target.value)]])}>
            {[...new Set([...STRIKE_CHOICES, read.strikes])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
        </label>
      </Bar>
      <div className="yf-body">
        {read.symbol ? (
          <Chain panel={panel} state={read} onExpiration={(expiration) => write([['expiration', expiration]])} />
        ) : (
          <Empty panel={panel} output={optionsOutput(read, { data: [], meta: {}, error: null, loading: false })}>
            Enter a symbol with listed options: AAPL, SPY, TSLA.
          </Empty>
        )}
      </div>
    </div>
  )
}

function Chain({ panel, state, onExpiration }: { panel: PanelRef; state: OptionsState; onExpiration: (expiration: string) => void }): ReactElement {
  const args: Record<string, unknown> = { symbol: state.symbol, strikes: state.strikes }
  if (state.expiration) args['expiration'] = state.expiration
  const run = useData('yfinance/options', args)
  useEvery(run.refetch, REFRESH_MS)
  usePublish(panel, optionsOutput(state, run))
  const meta = run.meta
  const hint = num(meta['priceHint'])
  const underlying = record(meta['underlying']) ?? {}
  const price = num(underlying['price'])
  const totals = record(meta['totals']) ?? {}
  const atm = record(meta['atm'])
  const expirations = list(meta['expirations']).map(text).filter((e): e is string => e !== null)
  const expiration = text(meta['expiration'])
  const rows = run.data ?? []
  // The price rule goes before the first strike above the price.
  const above = price === null ? -1 : rows.findIndex((row) => (num(row['strike']) ?? 0) >= price)
  return (
    <Section
      title={`${state.symbol} options`}
      run={run}
      aside={
        expirations.length ? (
          <label>
            Expires{' '}
            <select className="yf-select" value={expiration ?? ''} onChange={(event) => onExpiration(event.target.value)}>
              {expirations.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      empty={rows.length === 0}
    >
      <p className="yf-line">
        <span className="yf-num yf-strong">{d.price(price, hint)}</span> <Signed value={num(underlying['change'])} hint={hint} />{' '}
        <Signed value={num(underlying['changePercent'])} percent />
        <span className="yf-muted">
          {' · '}
          {num(totals['calls'])} calls, {num(totals['puts'])} puts · put/call {d.fixed(num(totals['putCallVolumeRatio']))} by volume,{' '}
          {d.fixed(num(totals['putCallOpenInterestRatio']))} by open interest
          {atm && ` · at ${d.price(num(atm['strike']), hint)}: call IV ${d.percent(num(atm['callIvPercent']), 1)}, put IV ${d.percent(num(atm['putIvPercent']), 1)}`}
        </span>
      </p>
      <table className="yf-table yf-chain">
        <thead>
          <tr>
            <th colSpan={COLUMNS.length} className="yf-side">
              Calls
            </th>
            <th className="yf-strike-head" />
            <th colSpan={COLUMNS.length} className="yf-side">
              Puts
            </th>
          </tr>
          <tr>
            {COLUMNS.map((c) => (
              <th key={`c${c}`} className="yf-num">
                {c}
              </th>
            ))}
            <th className="yf-num yf-strike-head">Strike</th>
            {COLUMNS.map((c) => (
              <th key={`p${c}`} className="yf-num">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={num(row['strike'])}>
              {index === above && <PriceRule price={price} hint={hint} />}
              <tr>
                <Side contract={record(row['call'])} hint={hint} />
                <td className="yf-num yf-strike">{d.price(num(row['strike']), hint)}</td>
                <Side contract={record(row['put'])} hint={hint} />
              </tr>
            </Fragment>
          ))}
          {above === -1 && rows.length > 0 && price !== null && <PriceRule price={price} hint={hint} />}
        </tbody>
      </table>
    </Section>
  )
}

function PriceRule({ price, hint }: { price: number | null; hint: number | null }): ReactElement {
  return (
    <tr className="yf-price-rule">
      <td colSpan={COLUMNS.length * 2 + 1}>
        <span>price {d.price(price, hint)}</span>
      </td>
    </tr>
  )
}

function Side({ contract, hint }: { contract: Row | null; hint: number | null }): ReactElement {
  if (!contract) {
    return (
      <>
        {COLUMNS.map((c) => (
          <td key={c} className="yf-num yf-muted">
            —
          </td>
        ))}
      </>
    )
  }
  const itm = contract['inTheMoney'] === true ? ' yf-itm' : ''
  const cells = [
    d.price(num(contract['last']), hint),
    d.price(num(contract['bid']), hint),
    d.price(num(contract['ask']), hint),
    d.fixed(num(contract['volume']), 0),
    d.fixed(num(contract['openInterest']), 0),
    d.percent(num(contract['ivPercent']), 1),
  ]
  return (
    <>
      {cells.map((cell, i) => (
        <td key={COLUMNS[i]} className={`yf-num${itm}`} title={i === 0 ? (text(contract['contract']) ?? undefined) : undefined}>
          {cell}
        </td>
      ))}
    </>
  )
}
