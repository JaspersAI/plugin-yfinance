import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  analystsResult,
  earningsResult,
  fundResult,
  holdersResult,
  MODULES,
  profileResult,
  readAnalysts,
  readEarnings,
  readFund,
  readHolders,
  readProfile,
  readStatistics,
  statisticsResult,
} from './company.ts'
import { FREQUENCIES, financialsResult, readFinancials, STATEMENTS, timeseriesQuery } from './financials.ts'
import { historyResult, INTERVALS, isIntraday, RANGES, readHistory } from './history.ts'
import { expirationSeconds, nearestExpirations, optionsResult, readExpirations, readOptions, SIDES } from './options.ts'
import {
  marketSummaryResult,
  MOVER_LISTS,
  moversResult,
  newsResult,
  quotesResult,
  readMarketSummary,
  readNews,
  readQuotes,
  readScreen,
  readSearch,
  readTrending,
  searchResult,
  TRENDING_DESCRIPTION,
  TRENDING_TITLE,
  type MoverList,
  type Quote,
} from './quotes.ts'
import type { ToolResult } from './result.ts'
import { createYahoo, YahooError, type Query, type YahooOptions } from './yahoo.ts'

// Yahoo Finance as an MCP server: fourteen read-only tools for the plugin's connection,
// yfinance/server, and for anything else that speaks MCP. No key. Each tool answers text for the model
// and structuredContent with rows for the views.

export const VERSION = '1.0.0'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY_SECONDS = 86_400

const INSTRUCTIONS = [
  'Market data from Yahoo Finance, which has no official API: quotes (some exchanges delayed), price history, company profiles, key statistics, financial statements, earnings and estimates, analyst ratings, holders, option chains, news, a market summary, market movers, and fund holdings. No key is needed.',
  'Symbols are Yahoo’s: AAPL, BRK-B, SHOP.TO, 7203.T, ^GSPC (index), ES=F (future), EURUSD=X (currency), BTC-USD (crypto). search finds one from a name.',
  'In structured results, a field whose name ends in Percent is in percent (7.97 is 7.97%). Yahoo can be wrong or late and can limit requests; say where figures come from.',
].join(' ')

/** A refusal worded for the caller. */
class Refusal extends Error {}

const SYMBOL = /^[A-Z0-9.^=&-]{1,32}$/

function symbolOf(raw: string): string {
  const symbol = raw.trim().toUpperCase()
  if (!SYMBOL.test(symbol)) throw new Refusal(`"${raw.trim().slice(0, 40)}" is not a Yahoo Finance symbol. Find one with search.`)
  return symbol
}

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 1000
}

type Failure = { content: { type: 'text'; text: string }[]; isError: true }

/** Runs a tool, turning whatever it throws into an error result the caller can read. */
function answer<A>(run: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult | Failure> {
  return async (args) => {
    try {
      return await run(args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const text = err instanceof Refusal || err instanceof YahooError ? message : `Reading Yahoo Finance’s answer failed: ${message}`
      return { content: [{ type: 'text', text }], isError: true }
    }
  }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const

export interface ServerOptions extends YahooOptions {
  /** Milliseconds; what "today" is for date windows. */
  now?: () => number
}

export function createServer(options: ServerOptions = {}): McpServer {
  const now = options.now ?? Date.now
  const yahoo = createYahoo({ ...options, now })
  const server = new McpServer({ name: 'yfinance', version: VERSION }, { instructions: INSTRUCTIONS })

  const nextMidnight = (): number => Math.ceil(now() / 1000 / DAY_SECONDS) * DAY_SECONDS

  const summary = (symbol: string, modules: string, ttl: number, what: string): Promise<unknown> =>
    yahoo.get({ path: `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, query: { modules, formatted: false }, crumb: true, ttl, what })

  const quotes = async (symbols: string[]): Promise<Quote[]> =>
    readQuotes(
      await yahoo.get({
        path: '/v7/finance/quote',
        query: { symbols: symbols.join(','), formatted: false },
        crumb: true,
        ttl: 15 * SECOND,
        what: `the quote for ${symbols.join(', ')}`,
      }),
    )

  const Symbol = z
    .string()
    .min(1)
    .max(40)
    .describe('A Yahoo Finance symbol: AAPL, BRK-B, SHOP.TO, ^GSPC (index), ES=F (future), EURUSD=X (currency), BTC-USD (crypto).')
  const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

  server.registerTool(
    'search',
    {
      description:
        'Finds Yahoo Finance symbols by company name, ticker, or keyword: stocks, ETFs, funds, indices, futures, currencies, and crypto, with the exchange, sector, and industry. Use it when unsure of a symbol, or for a listing on another exchange (SHOP.TO, APC.DE).',
      inputSchema: {
        query: z.string().min(1).max(100).describe('A name, ticker, or keyword: "apple", "nvidia", "gold".'),
        limit: z.number().int().min(1).max(20).optional().describe('How many matches, 8 by default.'),
      },
      annotations: READ_ONLY,
    },
    answer(async ({ query, limit }: { query: string; limit?: number }) => {
      const q = query.trim()
      const json = await yahoo.get({
        path: '/v1/finance/search',
        query: { q, quotesCount: limit ?? 8, newsCount: 0, listsCount: 0, enableFuzzyQuery: false },
        ttl: HOUR,
        what: `a search for "${q}"`,
      })
      return searchResult(q, readSearch(json))
    }),
  )

  server.registerTool(
    'get_quote',
    {
      description:
        'Live quotes from Yahoo Finance for up to 50 symbols at once: price, change, day range, volume, market cap, P/E, EPS, dividend yield, 52-week range, market state, pre- or post-market price, and the average analyst rating. Some exchanges are delayed.',
      inputSchema: { symbols: z.array(Symbol).min(1).max(50).describe('The symbols, like ["AAPL", "MSFT", "^GSPC"].') },
      annotations: READ_ONLY,
    },
    answer(async ({ symbols }: { symbols: string[] }) => {
      const asked = [...new Set(symbols.map(symbolOf))]
      const found = await quotes(asked)
      if (!found.length) throw new Refusal(`Yahoo Finance has no quote for ${asked.join(', ')}. Check the symbol with search.`)
      return quotesResult(found, asked)
    }),
  )

  server.registerTool(
    'get_price_history',
    {
      description:
        'Price history from Yahoo Finance: open, high, low, close, adjusted close, and volume per bar, a summary of the period, and the dividends and splits in it. Give range (1y by default) or start and end dates, and interval (1d by default). Minute bars reach back 8 days for 1m and 60 days for other minute sizes; hourly bars 730 days. The text lists the latest 400 bars.',
      inputSchema: {
        symbol: Symbol,
        range: z.enum(RANGES).optional().describe('How far back, ending now: 1d, 5d, 1mo, 3mo, 6mo, ytd, 1y (default), 2y, 5y, 10y, max. Ignored when start is given.'),
        interval: z.enum(INTERVALS).optional().describe('Bar size: 1m to 90m, 1h, 1d (default), 5d, 1wk, 1mo, 3mo.'),
        start: Day.optional().describe('First day, YYYY-MM-DD, instead of range.'),
        end: Day.optional().describe('Last day, YYYY-MM-DD, with start; today when left out.'),
        prepost: z.boolean().optional().describe('Include pre- and post-market bars (intraday only).'),
      },
      annotations: READ_ONLY,
    },
    answer(
      async ({ symbol: raw, range, interval, start, end, prepost }: { symbol: string; range?: string; interval?: string; start?: string; end?: string; prepost?: boolean }) => {
        const symbol = symbolOf(raw)
        if (end && !start) throw new Refusal('Give start with end, or a range.')
        const every = interval ?? '1d'
        const query: Query = { interval: every, includePrePost: prepost ?? false, events: 'div,splits' }
        if (start) {
          const from = dayStart(start)
          const to = end ? dayStart(end) + DAY_SECONDS : nextMidnight()
          if (!(to > from)) throw new Refusal('end has to be on or after start.')
          query['period1'] = from
          query['period2'] = to
        } else {
          query['range'] = range ?? '1y'
        }
        const json = await yahoo.get({
          path: `/v8/finance/chart/${encodeURIComponent(symbol)}`,
          query,
          ttl: isIntraday(every) ? MINUTE : 15 * MINUTE,
          what: `${symbol} price history`,
        })
        const history = readHistory(json)
        return historyResult({ ...history, symbol: history.symbol || symbol })
      },
    ),
  )

  server.registerTool(
    'get_company_profile',
    {
      description:
        'A company’s profile from Yahoo Finance: sector, industry, employees, headquarters, phone, website, business summary, officers with their pay, and ISS governance risk scores. For a fund, its summary.',
      inputSchema: { symbol: Symbol },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw }: { symbol: string }) => {
      const symbol = symbolOf(raw)
      return profileResult(readProfile(symbol, await summary(symbol, MODULES.profile, 6 * HOUR, `the ${symbol} profile`)))
    }),
  )

  server.registerTool(
    'get_key_statistics',
    {
      description:
        'Key statistics from Yahoo Finance: valuation (market cap, enterprise value, trailing and forward P/E, PEG, price/sales, price/book, EV/revenue, EV/EBITDA), margins and returns, revenue and earnings growth, cash and debt, beta and moving averages, shares, float, short interest, dividends, and fiscal dates.',
      inputSchema: { symbol: Symbol },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw }: { symbol: string }) => {
      const symbol = symbolOf(raw)
      return statisticsResult(readStatistics(symbol, await summary(symbol, MODULES.statistics, 5 * MINUTE, `${symbol} key statistics`)))
    }),
  )

  server.registerTool(
    'get_financials',
    {
      description:
        'A company’s financial statements from Yahoo Finance: the income statement, balance sheet, or cash flow statement, annual (about four years), quarterly (about five quarters), or trailing twelve months (income and cash flow). Values are as reported, in the statement’s currency, one column per period, latest first.',
      inputSchema: {
        symbol: Symbol,
        statement: z.enum(STATEMENTS).optional().describe('income (default), balance, or cashflow.'),
        frequency: z.enum(FREQUENCIES).optional().describe('annual (default), quarterly, or trailing.'),
      },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw, statement, frequency }: { symbol: string; statement?: (typeof STATEMENTS)[number]; frequency?: (typeof FREQUENCIES)[number] }) => {
      const symbol = symbolOf(raw)
      const which = statement ?? 'income'
      const every = frequency ?? 'annual'
      if (which === 'balance' && every === 'trailing') return financialsResult(readFinancials(symbol, which, every, null))
      const json = await yahoo.get({
        path: `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`,
        query: timeseriesQuery(symbol, which, every, now()),
        ttl: 6 * HOUR,
        what: `the ${symbol} ${which} statement`,
      })
      return financialsResult(readFinancials(symbol, which, every, json))
    }),
  )

  server.registerTool(
    'get_earnings',
    {
      description:
        'Earnings from Yahoo Finance: the next report date with its EPS and revenue estimates, the last four quarters’ EPS against estimates, analyst estimates for this and next quarter and fiscal year (EPS, revenue, growth, trend, revisions), dividend dates, and annual revenue and earnings.',
      inputSchema: { symbol: Symbol },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw }: { symbol: string }) => {
      const symbol = symbolOf(raw)
      return earningsResult(readEarnings(symbol, await summary(symbol, MODULES.earnings, HOUR, `${symbol} earnings`)))
    }),
  )

  server.registerTool(
    'get_analyst_ratings',
    {
      description:
        'Analyst views from Yahoo Finance: price targets (low, mean, median, high), the consensus rating, the monthly count of strong buy to strong sell ratings, and the latest upgrades, downgrades, and target changes by firm.',
      inputSchema: {
        symbol: Symbol,
        limit: z.number().int().min(1).max(50).optional().describe('How many rating changes, newest first; 15 by default.'),
      },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw, limit }: { symbol: string; limit?: number }) => {
      const symbol = symbolOf(raw)
      return analystsResult(readAnalysts(symbol, await summary(symbol, MODULES.analysts, HOUR, `${symbol} analyst ratings`), limit ?? 15))
    }),
  )

  server.registerTool(
    'get_holders',
    {
      description:
        'Who owns a company, from Yahoo Finance: the insider and institutional share, the top institutions and funds with their stakes and changes, insiders and their holdings, recent insider purchases and sales, and six months of net insider buying.',
      inputSchema: {
        symbol: Symbol,
        limit: z.number().int().min(1).max(25).optional().describe('How many of each list; 10 by default.'),
      },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw, limit }: { symbol: string; limit?: number }) => {
      const symbol = symbolOf(raw)
      return holdersResult(readHolders(symbol, await summary(symbol, MODULES.holders, 6 * HOUR, `${symbol} holders`), limit ?? 10))
    }),
  )

  server.registerTool(
    'get_options_chain',
    {
      description:
        'An option chain from Yahoo Finance: the expiration dates, and for one expiration (the nearest by default) the calls and puts at the strikes nearest the price, with last, bid, ask, volume, open interest, implied volatility, and whether in the money; the expiration’s totals and put/call ratios; and the at-the-money strike. Prices can be delayed.',
      inputSchema: {
        symbol: Symbol,
        expiration: Day.optional().describe('The expiration day, YYYY-MM-DD, one of those listed; the nearest when left out.'),
        strikes: z.number().int().min(1).max(50).optional().describe('How many strikes on each side of the price; 10 by default.'),
        side: z.enum(SIDES).optional().describe('both (default), calls, or puts, for the text.'),
      },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw, expiration, strikes, side }: { symbol: string; expiration?: string; strikes?: number; side?: (typeof SIDES)[number] }) => {
      const symbol = symbolOf(raw)
      const path = `/v7/finance/options/${encodeURIComponent(symbol)}`
      const each = strikes ?? 10
      let json = await yahoo.get({ path, crumb: true, ttl: MINUTE, what: `${symbol} options` })
      if (expiration) {
        const listed = readExpirations(json, symbol)
        if (!listed.length) throw new Refusal(`Yahoo Finance lists no options for ${symbol}.`)
        if (!listed.includes(expiration)) {
          throw new Refusal(`${symbol} has no options expiring ${expiration}. The nearest expirations: ${nearestExpirations(listed, expiration).join(', ')}.`)
        }
        if (readOptions(json, each, symbol).expiration !== expiration) {
          json = await yahoo.get({ path, query: { date: expirationSeconds(expiration) }, crumb: true, ttl: MINUTE, what: `${symbol} options expiring ${expiration}` })
        }
      }
      return optionsResult(readOptions(json, each, symbol), side ?? 'both')
    }),
  )

  server.registerTool(
    'get_news',
    {
      description: 'Recent news from Yahoo Finance for a ticker or a topic, newest first: headline, publisher, time, link, and the tickers each story mentions.',
      inputSchema: {
        query: z.string().min(1).max(100).describe('A ticker (AAPL) or a topic ("rate cut").'),
        limit: z.number().int().min(1).max(20).optional().describe('How many stories; 10 by default.'),
      },
      annotations: READ_ONLY,
    },
    answer(async ({ query, limit }: { query: string; limit?: number }) => {
      const q = query.trim()
      const json = await yahoo.get({
        path: '/v1/finance/search',
        query: { q, quotesCount: 0, newsCount: limit ?? 10, listsCount: 0 },
        ttl: 5 * MINUTE,
        what: `news for "${q}"`,
      })
      return newsResult(q, readNews(json))
    }),
  )

  server.registerTool(
    'get_market_summary',
    {
      description:
        'A snapshot of the markets from Yahoo Finance: the main index futures or indices, oil, gold, silver, the 10-year Treasury yield, the VIX, major currencies, and crypto, each with price and change. region is a two-letter market: US by default, or GB, DE, FR, IN, HK, JP, AU, CA, and others.',
      inputSchema: { region: z.string().regex(/^[A-Za-z]{2}$/).optional().describe('Two letters, US by default.') },
      annotations: READ_ONLY,
    },
    answer(async ({ region }: { region?: string }) => {
      const where = (region ?? 'US').toUpperCase()
      const json = await yahoo.get({
        path: '/v6/finance/quote/marketSummary',
        query: { lang: 'en-US', region: where, formatted: false },
        ttl: 30 * SECOND,
        what: `the ${where} market summary`,
      })
      return marketSummaryResult(where, readMarketSummary(json))
    }),
  )

  const lists = Object.keys(MOVER_LISTS) as [MoverList, ...MoverList[]]

  server.registerTool(
    'get_market_movers',
    {
      description: `Lists of US stocks from Yahoo Finance, each with price, change, volume, and market cap: today's gainers, losers, and most active, the trending tickers, and saved screens (${lists
        .filter((l) => !['gainers', 'losers', 'most_active', 'trending'].includes(l))
        .join(', ')}).`,
      inputSchema: {
        list: z.enum(lists).optional().describe('gainers (default), losers, most_active, trending, or a saved screen.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many; 25 by default.'),
      },
      annotations: READ_ONLY,
    },
    answer(async ({ list, limit }: { list?: MoverList; limit?: number }) => {
      const which = list ?? 'gainers'
      const count = limit ?? 25
      const saved = MOVER_LISTS[which]
      if (saved) {
        const json = await yahoo.get({
          path: '/v1/finance/screener/predefined/saved',
          query: { scrIds: saved, count, formatted: false },
          ttl: MINUTE,
          what: `the ${which.replace(/_/g, ' ')} list`,
        })
        return moversResult(which, readScreen(json))
      }
      const trending = readTrending(await yahoo.get({ path: '/v1/finance/trending/US', query: { count }, ttl: MINUTE, what: 'trending tickers' })).slice(0, count)
      const found = trending.length ? await quotes(trending) : []
      const bySymbol = new Map(found.map((q) => [q.symbol, q]))
      const rows = trending.map((s) => bySymbol.get(s)).filter((q): q is Quote => q !== undefined)
      return moversResult(which, { title: TRENDING_TITLE, description: TRENDING_DESCRIPTION, total: trending.length, rows })
    }),
  )

  server.registerTool(
    'get_fund_holdings',
    {
      description:
        'An ETF’s or mutual fund’s profile from Yahoo Finance: family, category, net assets, expense ratio, turnover, yield, NAV, returns, asset mix, sector weights, and top holdings.',
      inputSchema: { symbol: Symbol },
      annotations: READ_ONLY,
    },
    answer(async ({ symbol: raw }: { symbol: string }) => {
      const symbol = symbolOf(raw)
      return fundResult(readFund(symbol, await summary(symbol, MODULES.fund, 6 * HOUR, `the ${symbol} fund profile`)))
    }),
  )

  return server
}
