import type { ReactElement } from 'react'
import { useData, usePublish, type PanelRef } from '@jaspers-ai/sdk'
import { display as d } from './format'
import { lineValue, type Frequency, type LineKind, type Statement } from './server/financials'
import { Bar, Empty, Loading, Section, SymbolField, usePanelStateValue, useStateWriter } from './shared'
import { list, record, text } from './values'
import { financialsOutput, readFinancialsState, type FinancialsState } from './views'
import './styles.css'

// One company's statement: line items down, periods across, latest first, the lines that matter in
// bold. The toggles write `statement` and `frequency`; a balance sheet has no trailing twelve months,
// so choosing one while TTM is on moves to annual.

const STATEMENTS: [Statement, string][] = [
  ['income', 'Income'],
  ['balance', 'Balance sheet'],
  ['cashflow', 'Cash flow'],
]

const FREQUENCIES: [Frequency, string][] = [
  ['annual', 'Annual'],
  ['quarterly', 'Quarterly'],
  ['trailing', 'TTM'],
]

export function FinancialsView({ panel }: { panel: PanelRef }): ReactElement {
  const state = usePanelStateValue(panel)
  const write = useStateWriter(panel)
  if (state === undefined) return <Loading />
  const read = readFinancialsState(state)
  return (
    <div className="yf-root">
      <Bar symbol={read.symbol || undefined}>
        <SymbolField symbol={read.symbol} onSymbol={(symbol) => write([['symbol', symbol]])} />
        <Toggle
          label="Statement"
          options={STATEMENTS}
          value={read.statement}
          onChange={(statement) => write(statement === 'balance' && read.frequency === 'trailing' ? [['frequency', 'annual'], ['statement', statement]] : [['statement', statement]])}
        />
        <Toggle
          label="Period"
          options={FREQUENCIES}
          value={read.frequency}
          disabled={read.statement === 'balance' ? ['trailing'] : []}
          onChange={(frequency) => write([['frequency', frequency]])}
        />
      </Bar>
      <div className="yf-body">
        {read.symbol ? (
          <Statement panel={panel} state={read} />
        ) : (
          <Empty panel={panel} output={financialsOutput(read, { data: [], meta: {}, error: null, loading: false })}>
            Enter a symbol: AAPL, MSFT, 7203.T.
          </Empty>
        )}
      </div>
    </div>
  )
}

function Toggle<T extends string>({
  label,
  options,
  value,
  disabled = [],
  onChange,
}: {
  label: string
  options: [T, string][]
  value: T
  disabled?: T[]
  onChange: (value: T) => void
}): ReactElement {
  return (
    <div className="yf-toggle" role="group" aria-label={label}>
      {options.map(([key, name]) => (
        <button
          key={key}
          type="button"
          className={key === value ? 'yf-tab yf-tab-on' : 'yf-tab'}
          aria-pressed={key === value}
          disabled={disabled.includes(key)}
          title={disabled.includes(key) ? 'A balance sheet is a point in time: there is no trailing twelve months.' : undefined}
          onClick={() => onChange(key)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

function Statement({ panel, state }: { panel: PanelRef; state: FinancialsState }): ReactElement {
  const run = useData('yfinance/financials', { symbol: state.symbol, statement: state.statement, frequency: state.frequency })
  usePublish(panel, financialsOutput(state, run))
  const periods = list(run.meta['periods']).map(text).filter((p): p is string => p !== null)
  const rows = run.data ?? []
  const currency = text(run.meta['currency'])
  const name = STATEMENTS.find(([key]) => key === state.statement)![1]
  const every = FREQUENCIES.find(([key]) => key === state.frequency)![1]
  return (
    <Section
      title={`${state.symbol} ${name.toLowerCase()}`}
      run={run}
      aside={[every, currency && `in ${currency}`].filter(Boolean).join(' · ')}
      empty={rows.length === 0}
    >
      <table className="yf-table yf-statement">
        <thead>
          <tr>
            <th>{state.frequency === 'trailing' ? 'Twelve months to' : 'Period ended'}</th>
            {periods.map((p) => (
              <th key={p} className="yf-num">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const values = record(row['values']) ?? {}
            const kind = (text(row['kind']) ?? 'money') as LineKind
            return (
              <tr key={text(row['key']) ?? ''} className={row['highlight'] === true ? 'yf-strong' : undefined}>
                <td>{text(row['label'])}</td>
                {periods.map((p) => {
                  const value = typeof values[p] === 'number' ? (values[p] as number) : null
                  return (
                    <td key={p} className={`yf-num${value !== null && value < 0 ? ' yf-negative' : ''}`}>
                      {lineValue(kind, value, d)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}
