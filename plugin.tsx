import { defineConnection, definePlugin, defineSource, defineView } from '@jaspers-ai/sdk'
import { z } from 'zod'
import { FinancialsView } from './Financials'
import {
  FINANCIALS_INSTRUCTIONS,
  MARKETS_INSTRUCTIONS,
  OPTIONS_INSTRUCTIONS,
  OVERVIEW_INSTRUCTIONS,
  WATCHLIST_INSTRUCTIONS,
} from './instructions'
import { MarketsView } from './Markets'
import { OptionsView } from './Options'
import { OverviewView } from './Overview'
import { FREQUENCIES, STATEMENTS } from './server/financials'
import { MOVER_LISTS, type MoverList } from './server/quotes'
import {
  financialsSummary,
  marketsSummary,
  optionsSummary,
  overviewSummary,
  watchlistSummary,
  WATCHLIST_MAX,
} from './views'
import { WatchlistView } from './Watchlist'

// Yahoo Finance over the plugin's own connection, yfinance/server: a small MCP server in server/ that
// asks Yahoo's own endpoints, with no key. One source per tool the connection offers, borrowing the
// server's descriptions, each kept as long as its data lasts; and five views that run them. The
// orchestrator gets yfinance__search, yfinance__quote, and the rest, and places a view for what one
// shows. Research analysts can name the connection too.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const tool = (name: string, ttlMs: number) => defineSource({ mcp: 'server', tool: name, ttlMs })

const search = tool('search', HOUR)
const quote = tool('get_quote', 15 * SECOND)
const history = tool('get_price_history', MINUTE)
const profile = tool('get_company_profile', 6 * HOUR)
const statistics = tool('get_key_statistics', 5 * MINUTE)
const financials = tool('get_financials', 6 * HOUR)
const earnings = tool('get_earnings', HOUR)
const analysts = tool('get_analyst_ratings', HOUR)
const holders = tool('get_holders', 6 * HOUR)
const options = tool('get_options_chain', MINUTE)
const news = tool('get_news', 5 * MINUTE)
const marketSummary = tool('get_market_summary', 30 * SECOND)
const movers = tool('get_market_movers', MINUTE)
const fund = tool('get_fund_holdings', 6 * HOUR)

const Symbol = z.string().max(32).default('').describe('A Yahoo Finance symbol: AAPL, BRK-B, SHOP.TO, ^GSPC, ES=F, EURUSD=X, BTC-USD.')
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Amount = z.number().nullable()
const Errors = z.string().nullable()
const LISTS = Object.keys(MOVER_LISTS) as [MoverList, ...MoverList[]]

const Listing = z.object({ symbol: z.string(), name: z.string().nullable(), price: Amount, changePercent: Amount })

const OverviewState = z.object({ symbol: Symbol })
const OverviewOutput = z.object({
  symbol: z.string(),
  name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  price: Amount.optional(),
  changePercent: Amount.optional(),
  marketState: z.string().nullable().optional(),
  marketCap: Amount.optional(),
  pe: Amount.optional(),
  forwardPe: Amount.optional(),
  dividendYieldPercent: Amount.optional(),
  fiftyTwoWeekLow: Amount.optional(),
  fiftyTwoWeekHigh: Amount.optional(),
  target: z.object({ low: Amount, mean: Amount, high: Amount, analysts: Amount }).nullable().optional(),
  recommendation: z.string().nullable().optional(),
  nextEarnings: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  errors: z.array(z.string()),
})

const WatchlistState = z.object({
  symbols: z.array(z.string().max(32)).max(WATCHLIST_MAX).default([]).describe('The symbols in order, up to 30.'),
})
const WatchlistOutput = z.object({
  count: z.number(),
  missing: z.array(z.string()),
  rows: z.array(z.object({ symbol: z.string(), price: Amount, changePercent: Amount })),
})

const MarketsState = z.object({ list: z.enum(LISTS).default('gainers') })
const MarketsOutput = z.object({
  list: z.enum(LISTS),
  title: z.string().nullable(),
  total: Amount,
  tiles: z.array(Listing),
  top: z.array(Listing),
})

const FinancialsState = z.object({
  symbol: Symbol,
  statement: z.enum(STATEMENTS).default('income'),
  frequency: z.enum(FREQUENCIES).default('annual').describe('trailing is twelve months, for income and cashflow only.'),
})
const FinancialsOutput = z.object({
  symbol: z.string(),
  statement: z.enum(STATEMENTS),
  frequency: z.enum(FREQUENCIES),
  currency: z.string().nullable(),
  periods: z.array(z.string()),
  lines: z.number(),
  highlights: z.record(z.string(), z.array(Amount)),
  error: Errors,
})

const OptionsState = z.object({
  symbol: Symbol,
  expiration: Day.nullable().optional().describe('An expiration the chain lists, YYYY-MM-DD; null or left out for the nearest.'),
  strikes: z.number().int().min(1).max(50).optional().describe('Strikes on each side of the price, 10 by default.'),
})
const OptionsOutput = z.object({
  symbol: z.string(),
  expiration: z.string().nullable(),
  expirations: z.array(z.string()),
  underlying: Amount,
  strikes: z.number(),
  atm: z.object({ strike: Amount, callMid: Amount, putMid: Amount, callIvPercent: Amount, putIvPercent: Amount }).nullable(),
  putCallVolumeRatio: Amount,
  putCallOpenInterestRatio: Amount,
  error: Errors,
})

export default definePlugin({
  id: 'yfinance',
  connections: {
    // Yahoo Finance has no MCP server, so this runs the small one in server/, on the Node the app
    // runs on, which strips the types. No key: Yahoo asks for none.
    server: defineConnection({
      command: ['node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'server/main.ts'],
      tools: [
        'search',
        'get_quote',
        'get_price_history',
        'get_company_profile',
        'get_key_statistics',
        'get_financials',
        'get_earnings',
        'get_analyst_ratings',
        'get_holders',
        'get_options_chain',
        'get_news',
        'get_market_summary',
        'get_market_movers',
        'get_fund_holdings',
      ],
    }),
  },
  sources: {
    search,
    quote,
    history,
    profile,
    statistics,
    financials,
    earnings,
    analysts,
    holders,
    options,
    news,
    'market-summary': marketSummary,
    movers,
    fund,
  },
  views: {
    overview: defineView(OverviewView, {
      title: 'Company',
      state: OverviewState,
      output: OverviewOutput,
      instructions: OVERVIEW_INSTRUCTIONS,
      renders: [quote, statistics, analysts, earnings, profile, fund],
      summarize: overviewSummary,
    }),
    watchlist: defineView(WatchlistView, {
      title: 'Watchlist',
      state: WatchlistState,
      output: WatchlistOutput,
      instructions: WATCHLIST_INSTRUCTIONS,
      renders: [quote],
      summarize: watchlistSummary,
    }),
    markets: defineView(MarketsView, {
      title: 'Markets',
      state: MarketsState,
      output: MarketsOutput,
      instructions: MARKETS_INSTRUCTIONS,
      renders: [marketSummary, movers],
      summarize: marketsSummary,
    }),
    financials: defineView(FinancialsView, {
      title: 'Financials',
      state: FinancialsState,
      output: FinancialsOutput,
      instructions: FINANCIALS_INSTRUCTIONS,
      renders: [financials],
      summarize: financialsSummary,
    }),
    options: defineView(OptionsView, {
      title: 'Options',
      state: OptionsState,
      output: OptionsOutput,
      instructions: OPTIONS_INSTRUCTIONS,
      renders: [options],
      summarize: optionsSummary,
    }),
  },
})
