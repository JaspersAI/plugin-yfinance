import { plain as f } from '../format.ts'
import { list, num, record, records, text } from '../values.ts'
import { capped, toolResult, type ToolResult } from './result.ts'
import { YahooError } from './yahoo.ts'

// Price history from v8 chart: one bar per interval on the market's own clock (a daily bar is its
// day, an intraday bar its local time), with the dividends and splits Yahoo lists beside them.

export const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', 'ytd', '1y', '2y', '5y', '10y', 'max'] as const
export const INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'] as const

/** Bars the text lists at most; the rows keep every one. */
export const TEXT_BARS = 400

export type Bar = {
  /** YYYY-MM-DD, or YYYY-MM-DD HH:MM for an intraday bar, where the market is. */
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  /** Adjusted for splits and dividends; null for intraday bars. */
  adjClose: number | null
  volume: number | null
}

export type History = {
  symbol: string
  name: string | null
  currency: string | null
  exchange: string | null
  timezone: string | null
  interval: string
  /** The range asked for, or null when dates were. */
  range: string | null
  intraday: boolean
  price: number | null
  priceHint: number | null
  rows: Bar[]
  dividends: { date: string; amount: number }[]
  splits: { date: string; ratio: string }[]
}

const NAMES: Record<string, string> = {
  '1d': 'daily',
  '5d': '5-day',
  '1wk': 'weekly',
  '1mo': 'monthly',
  '3mo': 'quarterly',
  '1h': 'hourly',
  '60m': 'hourly',
}

/** Minutes or hours, as opposed to days and longer (1mo is a month). */
export function isIntraday(interval: string): boolean {
  return /^\d+[mh]$/.test(interval)
}

function rounder(hint: number | null): (value: number | null) => number | null {
  const scale = 10 ** (Math.max(hint ?? 2, 2) + 2)
  return (value) => (value === null ? null : Math.round(value * scale) / scale)
}

export function readHistory(json: unknown): History {
  const chart = records(record(record(json)?.['chart'])?.['result'])[0]
  if (!chart) throw new YahooError('Yahoo Finance answered with no price history.')
  const meta = record(chart['meta']) ?? {}
  const offset = num(meta['gmtoffset']) ?? 0
  const interval = text(meta['dataGranularity']) ?? '1d'
  const intraday = isIntraday(interval)
  const priceHint = num(meta['priceHint'])
  const round = rounder(priceHint)
  const indicators = record(chart['indicators'])
  const quote = records(indicators?.['quote'])[0] ?? {}
  const adjusted = list(records(indicators?.['adjclose'])[0]?.['adjclose'])
  const series = (key: string): unknown[] => list(quote[key])
  const [opens, highs, lows, closes, volumes] = ['open', 'high', 'low', 'close', 'volume'].map(series) as unknown[][]
  const day = (seconds: number): string => (intraday ? f.localTime(seconds, offset) : f.localDay(seconds, offset))
  const rows: Bar[] = []
  list(chart['timestamp']).forEach((stamp, i) => {
    const seconds = num(stamp)
    const close = round(num(closes![i]))
    if (seconds === null || close === null) return
    rows.push({
      date: day(seconds),
      open: round(num(opens![i])),
      high: round(num(highs![i])),
      low: round(num(lows![i])),
      close,
      adjClose: round(num(adjusted[i])),
      volume: num(volumes![i]),
    })
  })
  const events = record(chart['events'])
  const dividends = Object.values(record(events?.['dividends']) ?? {})
    .map((d) => ({ at: num(record(d)?.['date']), amount: num(record(d)?.['amount']) }))
    .filter((d): d is { at: number; amount: number } => d.at !== null && d.amount !== null)
    .sort((a, b) => a.at - b.at)
    .map((d) => ({ date: f.localDay(d.at, offset), amount: d.amount }))
  const splits = Object.values(record(events?.['splits']) ?? {})
    .map((s) => {
      const split = record(s)
      const ratio = text(split?.['splitRatio']) ?? (num(split?.['numerator']) !== null ? `${num(split?.['numerator'])}:${num(split?.['denominator'])}` : null)
      return { at: num(split?.['date']), ratio }
    })
    .filter((s): s is { at: number; ratio: string } => s.at !== null && s.ratio !== null)
    .sort((a, b) => a.at - b.at)
    .map((s) => ({ date: f.localDay(s.at, offset), ratio: s.ratio }))
  return {
    symbol: text(meta['symbol']) ?? '',
    name: text(meta['longName']) ?? text(meta['shortName']),
    currency: text(meta['currency']),
    exchange: text(meta['fullExchangeName']) ?? text(meta['exchangeName']),
    timezone: text(meta['exchangeTimezoneName']) ?? text(meta['timezone']),
    interval,
    range: text(meta['range']),
    intraday,
    price: num(meta['regularMarketPrice']),
    priceHint,
    rows,
    dividends,
    splits,
  }
}

function extreme(rows: Bar[], key: 'high' | 'low'): Bar | null {
  let best: Bar | null = null
  for (const bar of rows) {
    const value = bar[key]
    if (value === null) continue
    if (!best || (key === 'high' ? value > best.high! : value < best.low!)) best = bar
  }
  return best
}

export function historyResult(history: History, maxBars = TEXT_BARS): ToolResult {
  const { rows, symbol, interval } = history
  const structured = { ...history }
  if (!rows.length) {
    const over = history.range ? `over ${history.range}` : 'between the dates asked'
    return toolResult(`Yahoo Finance has no ${interval} bars for ${symbol} ${over}.`, structured)
  }
  const hint = history.priceHint
  const first = rows[0]!
  const last = rows.at(-1)!
  const where = [history.exchange, history.timezone].filter(Boolean).join(', ')
  const head = `${symbol}${history.name ? ` ${history.name}` : ''} price history from Yahoo Finance: ${rows.length} ${NAMES[interval] ?? `${interval}`} bar${
    rows.length === 1 ? '' : 's'
  } from ${first.date} to ${last.date}${history.currency ? `, in ${history.currency}` : ''}${where ? ` (${where})` : ''}.`
  const high = extreme(rows, 'high')
  const low = extreme(rows, 'low')
  const change = rows.length > 1 && first.close !== 0 ? ` (${f.signedPercent(((last.close - first.close) / first.close) * 100)})` : ''
  const summary = [
    `Close ${f.price(first.close, hint)} to ${f.price(last.close, hint)}${change}.`,
    high && low ? `High ${f.price(high.high, hint)} on ${high.date}, low ${f.price(low.low, hint)} on ${low.date}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const shown = rows.slice(-maxBars)
  const cell = (value: number | null): string => (value === null ? '' : f.price(value, hint).replaceAll(',', ''))
  const lines = shown.map((bar) => [bar.date, cell(bar.open), cell(bar.high), cell(bar.low), cell(bar.close), cell(bar.adjClose), bar.volume ?? ''].join(','))
  const tail: string[] = []
  if (shown.length < rows.length) {
    tail.push(`Only the latest ${shown.length} of ${rows.length} bars are listed; ask for a shorter range or a longer interval to see the rest.`)
  }
  if (history.dividends.length) tail.push(`Dividends per share: ${history.dividends.map((d) => `${d.date} ${d.amount}`).join(', ')}.`)
  if (history.splits.length) tail.push(`Splits: ${history.splits.map((s) => `${s.date} ${s.ratio}`).join(', ')}.`)
  const text = capped([head, summary, 'date,open,high,low,close,adj close,volume'], [...lines, ...tail], (n) => `(${n} more lines left out.)`)
  return toolResult(text, structured)
}
