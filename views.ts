import { display as d } from './format.ts'

export { smallPercent } from './format.ts'
import { FREQUENCIES, LINES, lineValue, STATEMENTS, type Frequency, type Statement } from './server/financials.ts'
import { MOVER_LISTS, type MoverList } from './server/quotes.ts'
import { clamp, int, list, num, record, records, text, type Row } from './values.ts'

// The views' pure half: each view's state read the forgiving way (main stores state as written),
// what each publishes (under the 4,096 bytes a publish may take) and says in the model's map, and
// the small reckonings the drawing needs. A run arrives as the app hands it over: the tool's rows as
// data, the rest of its structured answer as meta. No React and no bridge here.

export const OUTPUT_MAX = 4096
export const WATCHLIST_MAX = 30
/** How often the quote views ask again. */
export const REFRESH_MS = 60_000
export const STRIKE_CHOICES = [5, 10, 15, 20, 30] as const

const SYMBOL = /^[A-Z0-9.^=&-]{1,32}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A run as a view has it. */
export interface Run {
  data: Record<string, unknown>[] | undefined
  meta: Record<string, unknown>
  error: string | null
  loading: boolean
}

export function runOf(run: Run): { rows: Row[]; meta: Row; error: string | null; loading: boolean } {
  return { rows: run.data ?? [], meta: run.meta, error: run.error, loading: run.loading }
}

/** The message as the server or main wrote it, without the wrapping the IPC adds. */
export function cleanError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

export function cleanSymbol(raw: unknown): string {
  const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return SYMBOL.test(symbol) ? symbol : ''
}

export function readSymbol(state: unknown): string {
  return cleanSymbol(record(state)?.['symbol'])
}

export function yahooPage(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`
}

export function tone(value: number | null | undefined): 'up' | 'down' | '' {
  return typeof value === 'number' && value > 0 ? 'up' : typeof value === 'number' && value < 0 ? 'down' : ''
}

export function signedText(value: number | null | undefined, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${d.signed(value)}${suffix}` : '—'
}

/** Where a value sits between low and high, 0 to 1; null when the range says nothing. */
export function position(low: number | null | undefined, high: number | null | undefined, value: number | null | undefined): number | null {
  if (typeof low !== 'number' || typeof high !== 'number' || typeof value !== 'number' || !(high > low)) return null
  return clamp((value - low) / (high - low), 0, 1)
}

const FUNDS = new Set(['ETF', 'MUTUALFUND'])

/** Whether a quote type is a fund, whose holdings the overview shows. */
export function isFund(type: string | null | undefined): boolean {
  return typeof type === 'string' && FUNDS.has(type)
}


/** Yahoo's display with a true minus. */
function shown(value: unknown): string {
  return (text(value) ?? '—').replace(/^-/, '−')
}

function short(message: string | null): string | null {
  if (!message) return null
  const clean = cleanError(message)
  return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean
}

// Company overview.

export const OVERVIEW_STATS: [string, string][] = [
  ['marketCap', 'Market cap'],
  ['enterpriseValue', 'Enterprise value'],
  ['trailingPE', 'P/E'],
  ['forwardPE', 'Forward P/E'],
  ['pegRatio', 'PEG'],
  ['priceToSales', 'Price/sales'],
  ['priceToBook', 'Price/book'],
  ['enterpriseToEbitda', 'EV/EBITDA'],
  ['trailingEps', 'EPS'],
  ['revenue', 'Revenue'],
  ['profitMargin', 'Profit margin'],
  ['operatingMargin', 'Operating margin'],
  ['returnOnEquity', 'ROE'],
  ['debtToEquity', 'Debt/equity'],
  ['dividendYield', 'Dividend yield'],
  ['payoutRatio', 'Payout ratio'],
  ['beta', 'Beta'],
  ['shortPercentOfFloat', 'Short % of float'],
  ['averageVolume', 'Avg volume'],
]

const GRID = new Map(OVERVIEW_STATS)

/** The statistics the overview's grid shows, in its order, from the statistics run's rows. */
export function overviewStats(rows: Row[] | undefined): { key: string; label: string; value: string }[] {
  const byKey = new Map((rows ?? []).map((row) => [text(row['key']) ?? '', row]))
  return [...GRID].flatMap(([key, label]) => {
    const row = byKey.get(key)
    return row ? [{ key, label, value: shown(row['display']) }] : []
  })
}

/** A rating change in words: "Upgraded to Buy from Hold". */
export function ratingAction(action: string | null, from: string | null, to: string | null): string {
  const was = from && from !== to ? ` from ${from}` : ''
  switch (action) {
    case 'upgrade':
      return `Upgraded to ${to ?? '?'}${was}`
    case 'downgrade':
      return `Downgraded to ${to ?? '?'}${was}`
    case 'maintain':
      return `Maintained ${to ?? '?'}`
    case 'reiterate':
      return `Reiterated ${to ?? '?'}`
    case 'initiate':
      return `Initiated at ${to ?? '?'}`
    default:
      return [action, to].filter(Boolean).join(' ')
  }
}

const RATINGS: [string, string][] = [
  ['strongBuy', 'Strong buy'],
  ['buy', 'Buy'],
  ['hold', 'Hold'],
  ['sell', 'Sell'],
  ['strongSell', 'Strong sell'],
]

/** One month's ratings as shares of a bar; nothing when nobody rated. */
export function ratingMix(month: Row | null | undefined): { key: string; label: string; count: number; share: number }[] {
  const counts = RATINGS.map(([key, label]) => ({ key, label, count: num(month?.[key]) ?? 0 }))
  const total = counts.reduce((sum, c) => sum + c.count, 0)
  return total > 0 ? counts.map((c) => ({ ...c, share: c.count / total })) : []
}

export type OverviewRuns = { quote: Run; statistics: Run; analysts: Run; earnings: Run; profile: Run }

export type OverviewOutput = {
  symbol: string
  name: string | null
  type: string | null
  currency: string | null
  price: number | null
  changePercent: number | null
  marketState: string | null
  marketCap: number | null
  pe: number | null
  forwardPe: number | null
  dividendYieldPercent: number | null
  fiftyTwoWeekLow: number | null
  fiftyTwoWeekHigh: number | null
  target: { low: number | null; mean: number | null; high: number | null; analysts: number | null } | null
  recommendation: string | null
  nextEarnings: string | null
  sector: string | null
  industry: string | null
  errors: string[]
}

export function overviewOutput(symbol: string, runs: OverviewRuns): OverviewOutput {
  const quote = runs.quote.data?.[0] ?? {}
  const stats = record(runs.statistics.meta['stats']) ?? {}
  const target = record(runs.analysts.meta['target'])
  const recommendation = record(runs.analysts.meta['recommendation'])
  const next = record(runs.earnings.meta['next'])
  const profile = runs.profile.meta
  const pick = (a: unknown, b: unknown): number | null => num(a) ?? num(b)
  const errors = (Object.entries(runs) as [string, Run][]).flatMap(([name, run]) => (run.error ? [`${name}: ${short(run.error)}`] : []))
  return {
    symbol,
    name: text(quote['name']) ?? text(runs.statistics.meta['name']) ?? text(profile['name']),
    type: text(quote['type']) ?? text(profile['type']),
    currency: text(quote['currency']) ?? text(runs.statistics.meta['currency']),
    price: pick(quote['price'], stats['price']),
    changePercent: num(quote['changePercent']),
    marketState: text(quote['marketState']),
    marketCap: pick(quote['marketCap'], stats['marketCap']),
    pe: pick(quote['pe'], stats['trailingPE']),
    forwardPe: pick(quote['forwardPe'], stats['forwardPE']),
    dividendYieldPercent: pick(quote['dividendYield'], stats['dividendYield']),
    fiftyTwoWeekLow: pick(quote['fiftyTwoWeekLow'], stats['fiftyTwoWeekLow']),
    fiftyTwoWeekHigh: pick(quote['fiftyTwoWeekHigh'], stats['fiftyTwoWeekHigh']),
    target:
      target && num(target['mean']) !== null
        ? { low: num(target['low']), mean: num(target['mean']), high: num(target['high']), analysts: num(target['analysts']) }
        : null,
    recommendation: text(recommendation?.['key']),
    nextEarnings: text(next?.['date']),
    sector: text(profile['sector']),
    industry: text(profile['industry']),
    errors,
  }
}

export function overviewSummary(state: unknown, output: unknown): string {
  const symbol = readSymbol(state)
  if (!symbol) return 'Company: no symbol'
  const out = record(output)
  const price = num(out?.['price'])
  if (!out || price === null) return `${symbol} company overview`
  const target = record(out['target'])
  const parts = [
    `${d.price(price)} ${d.signedPercent(num(out['changePercent']))}`,
    num(out['marketCap']) !== null && `market cap ${d.big(num(out['marketCap']))}`,
    num(out['pe']) !== null && `P/E ${d.fixed(num(out['pe']), 1)}`,
    num(target?.['mean']) !== null && `target ${d.price(num(target?.['mean']))}${text(out['recommendation']) ? ` (${text(out['recommendation'])!.replace(/_/g, ' ')})` : ''}`,
    text(out['nextEarnings']) && `earnings ${text(out['nextEarnings'])}`,
  ].filter(Boolean)
  const name = text(out['name'])
  return `${symbol}${name ? ` ${name}` : ''}: ${parts.join(', ')}`
}

// Watchlist.

export function readWatchlist(state: unknown): string[] {
  const symbols: string[] = []
  for (const raw of list(record(state)?.['symbols'])) {
    const symbol = cleanSymbol(raw)
    if (symbol && !symbols.includes(symbol)) symbols.push(symbol)
    if (symbols.length === WATCHLIST_MAX) break
  }
  return symbols
}

export function addSymbol(symbols: string[], raw: string): string[] {
  const symbol = cleanSymbol(raw)
  if (!symbol || symbols.includes(symbol) || symbols.length >= WATCHLIST_MAX) return symbols
  return [...symbols, symbol]
}

export function removeSymbol(symbols: string[], symbol: string): string[] {
  return symbols.filter((s) => s !== symbol)
}

export type WatchlistOutput = {
  count: number
  missing: string[]
  rows: { symbol: string; price: number | null; changePercent: number | null }[]
}

export function watchlistOutput(symbols: string[], quotes: Row[]): WatchlistOutput {
  const bySymbol = new Map(quotes.map((q) => [text(q['symbol']) ?? '', q]))
  const rows: WatchlistOutput['rows'] = []
  const missing: string[] = []
  for (const symbol of symbols) {
    const q = bySymbol.get(symbol)
    if (q) rows.push({ symbol, price: num(q['price']), changePercent: num(q['changePercent']) })
    else missing.push(symbol)
  }
  return { count: symbols.length, missing, rows }
}

export function watchlistSummary(_state: unknown, output: unknown): string {
  const out = record(output)
  const rows = records(out?.['rows'])
  const count = num(out?.['count']) ?? rows.length
  if (!count) return 'Watchlist: empty'
  const shown = rows.slice(0, 5).map((r) => `${text(r['symbol'])} ${d.price(num(r['price']))} ${d.signedPercent(num(r['changePercent']))}`)
  return `Watchlist (${count}): ${shown.join(', ')}${rows.length > 5 ? ', …' : ''}`
}

// Markets.

export const MARKET_TABS: { list: MoverList; label: string }[] = [
  { list: 'gainers', label: 'Gainers' },
  { list: 'losers', label: 'Losers' },
  { list: 'most_active', label: 'Most active' },
  { list: 'trending', label: 'Trending' },
]

export const MARKET_SCREENS: { list: MoverList; label: string }[] = [
  { list: 'undervalued_growth', label: 'Undervalued growth' },
  { list: 'growth_technology', label: 'Growth technology' },
  { list: 'aggressive_small_caps', label: 'Aggressive small caps' },
  { list: 'small_cap_gainers', label: 'Small cap gainers' },
  { list: 'undervalued_large_caps', label: 'Undervalued large caps' },
]

export function readMarketList(state: unknown): MoverList {
  const listed = record(state)?.['list']
  return typeof listed === 'string' && listed in MOVER_LISTS ? (listed as MoverList) : 'gainers'
}

type Listing = { symbol: string; name: string | null; price: number | null; changePercent: number | null }

function listing(q: Row): Listing {
  return { symbol: text(q['symbol']) ?? '', name: text(q['name']), price: num(q['price']), changePercent: num(q['changePercent']) }
}

export type MarketsOutput = {
  list: MoverList
  title: string | null
  total: number | null
  tiles: Listing[]
  top: Listing[]
}

export function marketsOutput(list: MoverList, tiles: Row[], screen: { title: unknown; total: unknown; rows: Row[] }): MarketsOutput {
  return {
    list,
    title: text(screen.title),
    total: num(screen.total),
    tiles: tiles.slice(0, 16).map(listing),
    top: screen.rows.slice(0, 10).map(listing),
  }
}

export function marketsSummary(state: unknown, output: unknown): string {
  const out = record(output)
  const tiles = records(out?.['tiles'])
  const top = records(out?.['top'])
  if (!tiles.length && !top.length) return `Markets: ${readMarketList(state).replace(/_/g, ' ')}`
  const move = (r: Row, name: unknown): string => `${text(name) ?? text(r['symbol'])} ${d.signedPercent(num(r['changePercent']))}`
  const head = tiles.slice(0, 3).map((r) => move(r, r['name']))
  const list = top.slice(0, 3).map((r) => move(r, r['symbol']))
  const title = text(out?.['title']) ?? readMarketList(state)
  return `Markets: ${[head.join(', '), list.length ? `${title}: ${list.join(', ')}` : ''].filter(Boolean).join('; ')}`
}

// Financials.

export type FinancialsState = { symbol: string; statement: Statement; frequency: Frequency }

export function readFinancialsState(state: unknown): FinancialsState {
  const raw = record(state) ?? {}
  const statement = STATEMENTS.find((s) => s === raw['statement']) ?? 'income'
  let frequency = FREQUENCIES.find((f) => f === raw['frequency']) ?? 'annual'
  // A balance sheet has no trailing twelve months.
  if (statement === 'balance' && frequency === 'trailing') frequency = 'annual'
  return { symbol: readSymbol(raw), statement, frequency }
}

export type FinancialsOutput = FinancialsState & {
  currency: string | null
  periods: string[]
  lines: number
  highlights: Record<string, (number | null)[]>
  error: string | null
}

export function financialsOutput(state: FinancialsState, run: Run): FinancialsOutput {
  const periods = list(run.meta['periods']).map(text).filter((p): p is string => p !== null)
  const rows = run.data ?? []
  const highlights: Record<string, (number | null)[]> = {}
  for (const row of rows) {
    if (row['highlight'] !== true) continue
    const values = record(row['values']) ?? {}
    highlights[text(row['label']) ?? ''] = periods.slice(0, 8).map((p) => num(values[p]))
  }
  return {
    ...state,
    currency: text(run.meta['currency']),
    periods: periods.slice(0, 8),
    lines: rows.length,
    highlights,
    error: short(run.error),
  }
}

export function financialsSummary(state: unknown, output: unknown): string {
  const read = readFinancialsState(state)
  if (!read.symbol) return 'Financials: no symbol'
  const out = record(output)
  const head = `${read.symbol} ${read.statement}, ${read.frequency}`
  const error = text(out?.['error'])
  if (error) return `${head}: ${error}`
  const periods = list(out?.['periods']).map(text)
  const highlights = record(out?.['highlights'])
  if (!periods[0] || !highlights) return `${head} statement`
  const kinds = new Map(LINES[read.statement].map((l) => [l.label, l.kind]))
  const values = Object.entries(highlights).map(
    ([label, series]) => `${label} ${lineValue(kinds.get(label) ?? 'money', num(list(series)[0]), d)}`,
  )
  const currency = text(out?.['currency'])
  return `${head}${currency ? ` (${currency})` : ''}, ${periods[0]}: ${values.join(', ')}`
}

// Options.

export type OptionsState = { symbol: string; expiration: string | null; strikes: number }

export function readOptionsState(state: unknown): OptionsState {
  const raw = record(state) ?? {}
  const expiration = text(raw['expiration'])
  const strikes = int(raw['strikes'])
  return {
    symbol: readSymbol(raw),
    expiration: expiration && DAY.test(expiration) ? expiration : null,
    strikes: strikes === undefined ? 10 : clamp(strikes, 1, 50),
  }
}

export type OptionsOutput = {
  symbol: string
  expiration: string | null
  expirations: string[]
  underlying: number | null
  strikes: number
  atm: { strike: number | null; callMid: number | null; putMid: number | null; callIvPercent: number | null; putIvPercent: number | null } | null
  putCallVolumeRatio: number | null
  putCallOpenInterestRatio: number | null
  error: string | null
}

export function optionsOutput(state: OptionsState, run: Run): OptionsOutput {
  const meta = run.meta
  const atm = record(meta['atm'])
  const totals = record(meta['totals'])
  return {
    symbol: text(meta['symbol']) ?? state.symbol,
    expiration: text(meta['expiration']) ?? state.expiration,
    expirations: list(meta['expirations'])
      .map(text)
      .filter((e): e is string => e !== null)
      .slice(0, 60),
    underlying: num(record(meta['underlying'])?.['price']),
    strikes: (run.data ?? []).length,
    atm: atm
      ? {
          strike: num(atm['strike']),
          callMid: num(atm['callMid']),
          putMid: num(atm['putMid']),
          callIvPercent: num(atm['callIvPercent']),
          putIvPercent: num(atm['putIvPercent']),
        }
      : null,
    putCallVolumeRatio: num(totals?.['putCallVolumeRatio']),
    putCallOpenInterestRatio: num(totals?.['putCallOpenInterestRatio']),
    error: short(run.error),
  }
}

export function optionsSummary(state: unknown, output: unknown): string {
  const read = readOptionsState(state)
  if (!read.symbol) return 'Options: no symbol'
  const out = record(output)
  const expiration = text(out?.['expiration'])
  const error = text(out?.['error'])
  if (error) return `${read.symbol} options: ${error}`
  const atm = record(out?.['atm'])
  if (!expiration || !atm) return `${read.symbol} options`
  const iv = num(atm['callIvPercent']) ?? num(atm['putIvPercent'])
  const ratio = num(out?.['putCallOpenInterestRatio'])
  return [
    `${read.symbol} options ${expiration}: at ${d.price(num(atm['strike']))} call ${d.price(num(atm['callMid']))} / put ${d.price(num(atm['putMid']))}`,
    iv !== null && `IV ${d.percent(iv, 1)}`,
    ratio !== null && `put/call OI ${d.fixed(ratio)}`,
  ]
    .filter(Boolean)
    .join(', ')
}
