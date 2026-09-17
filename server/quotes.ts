import { plain as f } from '../format.ts'
import { num, record, records, text } from '../values.ts'
import { capped, parts, toolResult, type ToolResult } from './result.ts'
import { YahooError } from './yahoo.ts'

// Quotes and the lists made of them: v7 quote, the market summary, the saved screens, and trending,
// which all describe a listing the same way; and search, which finds symbols and news. Percentages
// here are in percent, as Yahoo writes them in these answers: changePercent 0.32 is 0.32%.

export type Quote = {
  symbol: string
  name: string | null
  /** EQUITY, ETF, MUTUALFUND, INDEX, FUTURE, CURRENCY, CRYPTOCURRENCY. */
  type: string | null
  exchange: string | null
  currency: string | null
  /** The decimals Yahoo shows the price with. */
  priceHint: number | null
  /** PRE, REGULAR, POST, POSTPOST, PREPRE, CLOSED. */
  marketState: string | null
  price: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  open: number | null
  dayLow: number | null
  dayHigh: number | null
  volume: number | null
  /** Three-month average daily volume. */
  averageVolume: number | null
  marketCap: number | null
  pe: number | null
  forwardPe: number | null
  eps: number | null
  /** In percent. */
  dividendYield: number | null
  fiftyTwoWeekLow: number | null
  fiftyTwoWeekHigh: number | null
  preMarketPrice: number | null
  preMarketChangePercent: number | null
  postMarketPrice: number | null
  postMarketChangePercent: number | null
  /** Yahoo's average analyst rating: "2.2 - Buy". */
  rating: string | null
  /** When the price was set, ISO. */
  time: string | null
}

export type Match = {
  symbol: string
  name: string | null
  type: string | null
  typeLabel: string | null
  exchange: string | null
  sector: string | null
  industry: string | null
}

export type Story = {
  title: string
  publisher: string | null
  /** ISO. */
  published: string | null
  url: string
  tickers: string[]
}

export type Screen = {
  title: string
  description: string | null
  total: number | null
  rows: Quote[]
}

/** The lists the movers tool offers: the name it takes, and Yahoo's saved screen (trending has none). */
export const MOVER_LISTS = {
  gainers: 'day_gainers',
  losers: 'day_losers',
  most_active: 'most_actives',
  trending: null,
  undervalued_growth: 'undervalued_growth_stocks',
  growth_technology: 'growth_technology_stocks',
  aggressive_small_caps: 'aggressive_small_caps',
  small_cap_gainers: 'small_cap_gainers',
  undervalued_large_caps: 'undervalued_large_caps',
} as const

export type MoverList = keyof typeof MOVER_LISTS

export const TRENDING_TITLE = 'Trending tickers'
export const TRENDING_DESCRIPTION = 'The tickers people are looking up most on Yahoo Finance right now.'

const STATES: Record<string, string> = {
  PRE: 'pre-market',
  REGULAR: 'market open',
  POST: 'after hours',
  POSTPOST: 'market closed',
  PREPRE: 'market closed',
  CLOSED: 'market closed',
}

function iso(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString()
}

/** One listing, as any of the quote answers describe it. Names are the long one first, or the short one. */
export function readQuote(raw: unknown, names: 'long' | 'short' = 'long'): Quote | null {
  const q = record(raw)
  const symbol = text(q?.['symbol'])
  if (!q || !symbol) return null
  const long = text(q['longName'])
  const short = text(q['shortName'])
  const trailingYield = num(q['trailingAnnualDividendYield'])
  return {
    symbol,
    name: (names === 'long' ? long ?? short : short ?? long) ?? text(q['displayName']),
    type: text(q['quoteType']),
    exchange: text(q['fullExchangeName']) ?? text(q['exchange']),
    currency: text(q['currency']),
    priceHint: num(q['priceHint']),
    marketState: text(q['marketState']),
    price: num(q['regularMarketPrice']),
    change: num(q['regularMarketChange']),
    changePercent: num(q['regularMarketChangePercent']),
    previousClose: num(q['regularMarketPreviousClose']),
    open: num(q['regularMarketOpen']),
    dayLow: num(q['regularMarketDayLow']),
    dayHigh: num(q['regularMarketDayHigh']),
    volume: num(q['regularMarketVolume']),
    averageVolume: num(q['averageDailyVolume3Month']),
    marketCap: num(q['marketCap']),
    pe: num(q['trailingPE']),
    forwardPe: num(q['forwardPE']),
    eps: num(q['epsTrailingTwelveMonths']),
    dividendYield: num(q['dividendYield']) ?? (trailingYield === null ? null : trailingYield * 100),
    fiftyTwoWeekLow: num(q['fiftyTwoWeekLow']),
    fiftyTwoWeekHigh: num(q['fiftyTwoWeekHigh']),
    preMarketPrice: num(q['preMarketPrice']),
    preMarketChangePercent: num(q['preMarketChangePercent']),
    postMarketPrice: num(q['postMarketPrice']),
    postMarketChangePercent: num(q['postMarketChangePercent']),
    rating: text(q['averageAnalystRating']),
    time: iso(num(q['regularMarketTime'])),
  }
}

function present<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null)
}

export function readQuotes(json: unknown): Quote[] {
  return present(records(record(record(json)?.['quoteResponse'])?.['result']).map((q) => readQuote(q)))
}

export function readMarketSummary(json: unknown): Quote[] {
  return present(records(record(record(json)?.['marketSummaryResponse'])?.['result']).map((q) => readQuote(q, 'short')))
}

export function readScreen(json: unknown): Screen {
  const screen = records(record(record(json)?.['finance'])?.['result'])[0]
  if (!screen) throw new YahooError('Yahoo Finance answered with no screen.')
  return {
    title: text(screen['title']) ?? 'Screen',
    description: text(screen['description']),
    total: num(screen['total']),
    rows: present(records(screen['quotes']).map((q) => readQuote(q))),
  }
}

export function readTrending(json: unknown): string[] {
  const result = records(record(record(json)?.['finance'])?.['result'])[0]
  return present(records(result?.['quotes']).map((q) => text(q['symbol'])))
}

export function readSearch(json: unknown): Match[] {
  return present(
    records(record(json)?.['quotes']).map((q) => {
      const symbol = text(q['symbol'])
      if (!symbol) return null
      return {
        symbol,
        name: text(q['longname']) ?? text(q['shortname']),
        type: text(q['quoteType']),
        typeLabel: text(q['typeDisp']),
        exchange: text(q['exchDisp']) ?? text(q['exchange']),
        sector: text(q['sectorDisp']) ?? text(q['sector']),
        industry: text(q['industryDisp']) ?? text(q['industry']),
      }
    }),
  )
}

export function readNews(json: unknown): Story[] {
  const stories = present(
    records(record(json)?.['news']).map((n) => {
      const title = text(n['title'])
      const url = text(n['link'])
      if (!title || !url?.startsWith('https://')) return null
      return {
        title,
        publisher: text(n['publisher']),
        published: iso(num(n['providerPublishTime'])),
        url,
        tickers: present((Array.isArray(n['relatedTickers']) ? n['relatedTickers'] : []).map(text)),
      }
    }),
  )
  return stories.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
}

// Text.

function when(isoTime: string | null): string | null {
  return isoTime ? `${isoTime.slice(0, 16).replace('T', ' ')} UTC` : null
}

function range(low: number | null, high: number | null, hint: number | null): string | null {
  return low !== null && high !== null ? `${f.price(low, hint)}-${f.price(high, hint)}` : null
}

function move(q: Quote): string | null {
  if (q.change === null && q.changePercent === null) return null
  if (q.change === null) return f.signedPercent(q.changePercent)
  return `${f.signed(q.change, q.priceHint ?? 2)} (${f.signedPercent(q.changePercent)})`
}

function state(q: Quote): string | null {
  return q.marketState ? (STATES[q.marketState] ?? q.marketState.toLowerCase()) : null
}

/** A sentence of what there is, capitalized, or nothing. */
function sentence(body: string | null | undefined | false): string | null {
  return body ? `${body.charAt(0).toUpperCase()}${body.slice(1)}.` : null
}

export function quoteLine(q: Quote): string {
  const hint = q.priceHint
  const about = parts(q.type, q.exchange, q.currency)
  const head = `${q.symbol}${q.name ? ` ${q.name}` : ''}${about ? ` (${about})` : ''}`
  const extended =
    q.preMarketPrice !== null
      ? `pre-market ${f.price(q.preMarketPrice, hint)} (${f.signedPercent(q.preMarketChangePercent)})`
      : q.postMarketPrice !== null
        ? `post-market ${f.price(q.postMarketPrice, hint)} (${f.signedPercent(q.postMarketChangePercent)})`
        : null
  const day = parts(
    range(q.dayLow, q.dayHigh, hint) && `Day ${range(q.dayLow, q.dayHigh, hint)}`,
    q.open !== null && `open ${f.price(q.open, hint)}`,
    q.previousClose !== null && `previous close ${f.price(q.previousClose, hint)}`,
  )
  const volume = parts(q.volume !== null && `Volume ${f.big(q.volume)}`, q.averageVolume !== null && `3-month average ${f.big(q.averageVolume)}`)
  const earnings = parts(q.pe !== null && `P/E ${f.fixed(q.pe)}`, q.forwardPe !== null && `forward P/E ${f.fixed(q.forwardPe)}`, q.eps !== null && `EPS ${f.fixed(q.eps)}`)
  return [
    `${head}: ${parts(f.price(q.price, hint), move(q), state(q), extended)}.`,
    sentence(day),
    sentence(volume),
    sentence(q.marketCap !== null && `Market cap ${f.big(q.marketCap)}`),
    sentence(earnings),
    sentence(q.dividendYield !== null && `Dividend yield ${f.percent(q.dividendYield)}`),
    sentence(range(q.fiftyTwoWeekLow, q.fiftyTwoWeekHigh, hint) && `52-week range ${range(q.fiftyTwoWeekLow, q.fiftyTwoWeekHigh, hint)}`),
    sentence(q.rating && `Analysts: ${q.rating}`),
    sentence(when(q.time) && `As of ${when(q.time)}`),
  ]
    .filter((s): s is string => s !== null)
    .join(' ')
}

/** A listing in a list: price, move, volume, and size. */
export function shortLine(q: Quote): string {
  const rest = parts(q.volume !== null && `volume ${f.big(q.volume)}`, q.marketCap !== null && `market cap ${f.big(q.marketCap)}`, q.exchange)
  return `${q.symbol}${q.name ? ` ${q.name}` : ''}: ${f.price(q.price, q.priceHint)} ${f.signedPercent(q.changePercent)}${rest ? `, ${rest}` : ''}`
}

export function quotesResult(quotes: Quote[], asked: string[]): ToolResult {
  const found = new Set(quotes.map((q) => q.symbol.toUpperCase()))
  const missing = asked.filter((symbol) => !found.has(symbol.toUpperCase()))
  const lines = quotes.map(quoteLine)
  const tail = missing.length ? [`No quote for ${missing.join(', ')}. Check the symbol with the search tool.`] : []
  return toolResult(
    capped(['Quotes from Yahoo Finance (some exchanges are delayed):'], [...lines, ...tail], (n) => `(${n} more lines left out.)`),
    { missing, rows: quotes },
  )
}

export function searchResult(query: string, matches: Match[]): ToolResult {
  if (!matches.length) return toolResult(`No Yahoo Finance symbols match "${query}".`, { query, rows: [] })
  const lines = matches.map((m) => {
    const field = m.sector && m.industry ? `${m.sector} / ${m.industry}` : (m.sector ?? m.industry)
    const about = parts(m.typeLabel ?? m.type, m.exchange, field)
    return `${m.symbol}: ${m.name ?? m.symbol}${about ? ` (${about})` : ''}`
  })
  return toolResult([`Yahoo Finance symbols matching "${query}":`, ...lines].join('\n'), { query, rows: matches })
}

export function newsResult(query: string, stories: Story[]): ToolResult {
  if (!stories.length) return toolResult(`Yahoo Finance has no news for "${query}".`, { query, rows: [] })
  const lines = stories.map((s) => {
    const head = parts(when(s.published), s.publisher)
    return `${head ? `${head}: ` : ''}${s.title} ${s.url}${s.tickers.length ? ` (${s.tickers.join(', ')})` : ''}`
  })
  return toolResult([`Yahoo Finance news for "${query}", newest first:`, ...lines].join('\n'), { query, rows: stories })
}

export function marketSummaryResult(region: string, rows: Quote[]): ToolResult {
  const lines = rows.map((q) => `${q.name ?? q.symbol} (${parts(q.symbol, q.type)}): ${parts(f.price(q.price, q.priceHint), move(q), state(q))}`)
  return toolResult([`Markets from Yahoo Finance (region ${region}):`, ...lines].join('\n'), { region, rows })
}

export function moversResult(list: MoverList, screen: Screen): ToolResult {
  const count = screen.total !== null ? `${screen.rows.length} of ${f.fixed(screen.total, 0)}` : `${screen.rows.length}`
  const head = `${screen.title} (Yahoo Finance): ${screen.description ? `${screen.description} ` : ''}${count}.`
  return toolResult(capped([head], screen.rows.map(shortLine), (n) => `(${n} more left out.)`), {
    list,
    title: screen.title,
    description: screen.description,
    total: screen.total,
    rows: screen.rows,
  })
}
