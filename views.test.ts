import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { readAnalysts, readEarnings, readProfile, readStatistics } from './server/company.ts'
import { readFinancials } from './server/financials.ts'
import { readOptions } from './server/options.ts'
import { readMarketSummary, readQuotes, readScreen } from './server/quotes.ts'
import {
  addSymbol,
  cleanError,
  financialsOutput,
  financialsSummary,
  marketsOutput,
  marketsSummary,
  OUTPUT_MAX,
  overviewOutput,
  overviewStats,
  overviewSummary,
  optionsOutput,
  optionsSummary,
  position,
  ratingMix,
  readFinancialsState,
  readMarketList,
  readOptionsState,
  ratingAction,
  readSymbol,
  readWatchlist,
  removeSymbol,
  runOf,
  signedText,
  smallPercent,
  isFund,
  tone,
  watchlistOutput,
  watchlistSummary,
  WATCHLIST_MAX,
  yahooPage,
} from './views.ts'

// The views' pure half: state read the forgiving way, what each view publishes and says in the
// model's map, and the small reckonings its drawing needs. The runs are made here the way the app
// makes them: a tool's rows as data, the rest as meta.

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))

/** A source run as a view gets it: rows as data, everything else as meta. */
function run(structured: { rows: unknown[]; [key: string]: unknown }, error: string | null = null): { data: Record<string, unknown>[]; meta: Record<string, unknown>; error: string | null; loading: boolean } {
  const { rows, ...meta } = structured
  return { data: rows as Record<string, unknown>[], meta, error, loading: false }
}

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length

test('symbols are trimmed and upper-cased; anything else is no symbol', () => {
  assert.equal(readSymbol({ symbol: ' aapl ' }), 'AAPL')
  assert.equal(readSymbol({ symbol: 'brk-b' }), 'BRK-B')
  assert.equal(readSymbol({ symbol: 'drop table' }), '')
  assert.equal(readSymbol({}), '')
  assert.equal(readSymbol(null), '')
  assert.equal(yahooPage('^GSPC'), 'https://finance.yahoo.com/quote/%5EGSPC/')
})

test('a watchlist is up to thirty distinct symbols; adding and removing keep the order', () => {
  assert.deepEqual(readWatchlist({ symbols: ['aapl', 'MSFT', 'aapl', 'bad one', 7, 'spy'] }), ['AAPL', 'MSFT', 'SPY'])
  assert.deepEqual(readWatchlist({ symbols: 'AAPL' }), [])
  const many = Array.from({ length: 40 }, (_, i) => `S${i}`)
  assert.equal(readWatchlist({ symbols: many }).length, WATCHLIST_MAX)
  assert.deepEqual(addSymbol(['AAPL'], ' msft '), ['AAPL', 'MSFT'])
  assert.deepEqual(addSymbol(['AAPL'], 'aapl'), ['AAPL'])
  assert.deepEqual(addSymbol(['AAPL'], 'no good'), ['AAPL'])
  assert.equal(addSymbol(many.slice(0, 30), 'NEW').length, 30)
  assert.deepEqual(removeSymbol(['AAPL', 'MSFT', 'SPY'], 'MSFT'), ['AAPL', 'SPY'])
})

test('the other states read with their defaults', () => {
  assert.equal(readMarketList({}), 'gainers')
  assert.equal(readMarketList({ list: 'trending' }), 'trending')
  assert.equal(readMarketList({ list: 'nope' }), 'gainers')
  assert.deepEqual(readFinancialsState({ symbol: 'msft' }), { symbol: 'MSFT', statement: 'income', frequency: 'annual' })
  assert.deepEqual(readFinancialsState({ symbol: 'MSFT', statement: 'balance', frequency: 'trailing' }), { symbol: 'MSFT', statement: 'balance', frequency: 'annual' })
  assert.deepEqual(readFinancialsState({ symbol: 'MSFT', statement: 'cashflow', frequency: 'quarterly' }), { symbol: 'MSFT', statement: 'cashflow', frequency: 'quarterly' })
  assert.deepEqual(readOptionsState({ symbol: 'spy' }), { symbol: 'SPY', expiration: null, strikes: 10 })
  assert.deepEqual(readOptionsState({ symbol: 'SPY', expiration: '2026-09-18', strikes: 99 }), { symbol: 'SPY', expiration: '2026-09-18', strikes: 50 })
  assert.deepEqual(readOptionsState({ symbol: 'SPY', expiration: 'soon', strikes: 2.5 }), { symbol: 'SPY', expiration: null, strikes: 10 })
})

test('the overview publishes the headline figures from each run, and says what failed', () => {
  const runs = {
    quote: run({ missing: [], rows: readQuotes(fixture('quote')).slice(0, 1) }),
    statistics: run(readStatistics('AAPL', fixture('stats'))),
    analysts: run(readAnalysts('AAPL', fixture('analysts'), 5)),
    earnings: run(readEarnings('AAPL', fixture('earnings'))),
    profile: run({ rows: [] }, "Error invoking remote method 'source:run': Error: Yahoo Finance: Quote not found for symbol: AAPL"),
  }
  const output = overviewOutput('AAPL', runs)
  assert.deepEqual(output, {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    type: 'EQUITY',
    currency: 'USD',
    price: 332.41,
    changePercent: 0.322933,
    marketState: 'POSTPOST',
    marketCap: 4851251544064,
    pe: 38.033184,
    forwardPe: 34.688007,
    dividendYieldPercent: 0.33,
    fiftyTwoWeekLow: 236.65,
    fiftyTwoWeekHigh: 344.57,
    target: { low: 215, mean: 327.1964, high: 405, analysts: 39 },
    recommendation: 'buy',
    nextEarnings: '2026-10-29',
    sector: null,
    industry: null,
    errors: ['profile: Yahoo Finance: Quote not found for symbol: AAPL'],
  })
  assert.ok(bytes(output) < OUTPUT_MAX)
  assert.equal(overviewSummary({ symbol: 'AAPL' }, output), 'AAPL Apple Inc.: 332.41 +0.32%, market cap 4.85T, P/E 38.0, target 327.20 (buy), earnings 2026-10-29')
  assert.equal(overviewSummary({}, {}), 'Company: no symbol')
  assert.equal(overviewSummary({ symbol: 'AAPL' }, {}), 'AAPL company overview')
  const withProfile = overviewOutput('AAPL', { ...runs, profile: run(readProfile('AAPL', fixture('profile'))) })
  assert.equal(withProfile.sector, 'Technology')
  assert.deepEqual(withProfile.errors, [])
})

test('the overview’s statistics grid takes what there is, in its order, with a true minus', () => {
  const stats = overviewStats(run(readStatistics('AAPL', fixture('stats'))).data)
  assert.deepEqual(stats.slice(0, 3), [
    { key: 'marketCap', label: 'Market cap', value: '4.85T' },
    { key: 'enterpriseValue', label: 'Enterprise value', value: '4.87T' },
    { key: 'trailingPE', label: 'P/E', value: '38.03' },
  ])
  assert.ok(stats.some((s) => s.key === 'returnOnEquity' && s.value === '148.75%'))
  assert.deepEqual(overviewStats([{ key: 'freeCashflow', display: '-1.2B' }, { key: 'trailingPE', display: '-3.10' }]), [{ key: 'trailingPE', label: 'P/E', value: '−3.10' }])
  assert.deepEqual(overviewStats(undefined), [])
})

test('a fund is an ETF or a mutual fund, and its small rates keep three figures', () => {
  assert.equal(isFund('ETF'), true)
  assert.equal(isFund('MUTUALFUND'), true)
  assert.equal(isFund('EQUITY'), false)
  assert.equal(isFund(null), false)
  assert.equal(smallPercent(0.0945), '0.0945%')
  assert.equal(smallPercent(0.2), '0.2%')
  assert.equal(smallPercent(1.254), '1.25%')
  assert.equal(smallPercent(null), '—')
})

test('a rating change reads as what the firm did', () => {
  assert.equal(ratingAction('upgrade', 'Hold', 'Buy'), 'Upgraded to Buy from Hold')
  assert.equal(ratingAction('downgrade', null, 'Sell'), 'Downgraded to Sell')
  assert.equal(ratingAction('maintain', 'Neutral', 'Neutral'), 'Maintained Neutral')
  assert.equal(ratingAction('reiterate', 'Buy', 'Buy'), 'Reiterated Buy')
  assert.equal(ratingAction('initiate', null, 'Overweight'), 'Initiated at Overweight')
  assert.equal(ratingAction('resume', null, 'Buy'), 'resume Buy')
  assert.equal(ratingAction(null, null, null), '')
})

test('the analysts’ month becomes shares of a bar, and a range position stays inside it', () => {
  const trend = readAnalysts('AAPL', fixture('analysts'), 1).trend[0]!
  assert.deepEqual(ratingMix(trend), [
    { key: 'strongBuy', label: 'Strong buy', count: 6, share: 6 / 44 },
    { key: 'buy', label: 'Buy', count: 19, share: 19 / 44 },
    { key: 'hold', label: 'Hold', count: 13, share: 13 / 44 },
    { key: 'sell', label: 'Sell', count: 3, share: 3 / 44 },
    { key: 'strongSell', label: 'Strong sell', count: 3, share: 3 / 44 },
  ])
  assert.deepEqual(ratingMix({ strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }), [])
  assert.equal(position(236.65, 344.57, 332.41), (332.41 - 236.65) / (344.57 - 236.65))
  assert.equal(position(10, 20, 25), 1)
  assert.equal(position(10, 20, 5), 0)
  assert.equal(position(10, 10, 10), null)
  assert.equal(position(null, 20, 15), null)
  assert.equal(tone(0.3), 'up')
  assert.equal(tone(-0.3), 'down')
  assert.equal(tone(0), '')
  assert.equal(tone(null), '')
  assert.equal(signedText(-0.44, '%'), '−0.44%')
})

test('the watchlist publishes each symbol’s price and move, and names the missing', () => {
  const quotes = readQuotes(fixture('quote'))
  const output = watchlistOutput(['AAPL', 'SPY', 'NOPE123X'], quotes)
  assert.deepEqual(output, {
    count: 3,
    missing: ['NOPE123X'],
    rows: [
      { symbol: 'AAPL', price: 332.41, changePercent: 0.322933 },
      { symbol: 'SPY', price: 754.05, changePercent: -0.440992 },
    ],
  })
  assert.equal(watchlistSummary({}, output), 'Watchlist (3): AAPL 332.41 +0.32%, SPY 754.05 −0.44%')
  assert.equal(watchlistSummary({}, { count: 0, rows: [] }), 'Watchlist: empty')
  const many = watchlistOutput(
    Array.from({ length: 30 }, (_, i) => `SYMBOL${i}`),
    Array.from({ length: 30 }, (_, i) => ({ ...quotes[0]!, symbol: `SYMBOL${i}`, price: 123456.789, changePercent: -12.3456 })),
  )
  assert.ok(bytes(many) < OUTPUT_MAX)
  assert.match(watchlistSummary({}, many), /^Watchlist \(30\): SYMBOL0 .*, …$/)
})

test('the markets view publishes its tiles and the top of its list', () => {
  const tiles = readMarketSummary(fixture('market_summary'))
  const screen = readScreen(fixture('day_gainers'))
  const output = marketsOutput('gainers', tiles, { title: screen.title, total: screen.total, rows: screen.rows })
  assert.equal(output.list, 'gainers')
  assert.equal(output.title, 'Day Gainers')
  assert.deepEqual(output.tiles[0], { symbol: 'ES=F', name: 'S&P Futures', price: 7664.5, changePercent: 0.5444051 })
  assert.deepEqual(output.top[0], { symbol: 'AXTI', name: 'AXT, Inc.', price: 64.3, changePercent: 11.4385 })
  assert.ok(bytes(output) < OUTPUT_MAX)
  assert.equal(marketsSummary({}, output), 'Markets: S&P Futures +0.54%, Crude Oil −0.21%, EUR/USD −0.07%; Day Gainers: AXTI +11.44%, ARQT +11.19%, FPS +11.10%')
  assert.equal(marketsSummary({ list: 'losers' }, {}), 'Markets: losers')
})

test('the financials view publishes its periods and key lines', () => {
  const income = readFinancials('AAPL', 'income', 'annual', fixture('ts_income_annual'))
  const output = financialsOutput(readFinancialsState({ symbol: 'AAPL' }), run(income))
  assert.deepEqual(output, {
    symbol: 'AAPL',
    statement: 'income',
    frequency: 'annual',
    currency: 'USD',
    periods: ['2025-09-30', '2024-09-30', '2023-09-30', '2022-09-30'],
    lines: 8,
    highlights: {
      'Total revenue': [416161000000, 391035000000, 383285000000, 394328000000],
      'Gross profit': [195201000000, 180683000000, 169148000000, 170782000000],
      'Operating income': [133050000000, 123216000000, 114301000000, 119437000000],
      'Net income': [112010000000, 93736000000, 96995000000, 99803000000],
      'Diluted EPS': [7.46, 6.08, 6.13, 6.11],
    },
    error: null,
  })
  assert.equal(financialsSummary({ symbol: 'AAPL' }, output), 'AAPL income, annual (USD), 2025-09-30: Total revenue 416.16B, Gross profit 195.20B, Operating income 133.05B, Net income 112.01B, Diluted EPS 7.46')
  const failed = financialsOutput(readFinancialsState({ symbol: 'AAPL', statement: 'balance' }), { data: undefined, meta: {}, error: 'Yahoo Finance: nope', loading: false })
  assert.equal(failed.error, 'Yahoo Finance: nope')
  assert.deepEqual(failed.periods, [])
  assert.equal(financialsSummary({ symbol: 'AAPL', statement: 'balance' }, failed), 'AAPL balance, annual: Yahoo Finance: nope')
  assert.equal(financialsSummary({}, {}), 'Financials: no symbol')
})

test('the options view publishes the money, the ratios, and the dates', () => {
  const chain = readOptions(fixture('options'), 3)
  const output = optionsOutput(readOptionsState({ symbol: 'AAPL' }), run(chain))
  assert.deepEqual(output, {
    symbol: 'AAPL',
    expiration: '2026-09-18',
    expirations: ['2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25', '2026-10-02'],
    underlying: 332.41,
    strikes: 6,
    atm: { strike: 332.5, callMid: 2.945, putMid: 2.82, callIvPercent: 30.91, putIvPercent: 29.08 },
    putCallVolumeRatio: 0.4567,
    putCallOpenInterestRatio: 0.3797,
    error: null,
  })
  assert.equal(optionsSummary({ symbol: 'AAPL' }, output), 'AAPL options 2026-09-18: at 332.50 call 2.95 / put 2.82, IV 30.9%, put/call OI 0.38')
  const long = optionsOutput(readOptionsState({ symbol: 'AAPL' }), run({ ...chain, expirations: Array.from({ length: 400 }, () => '2026-09-18') }))
  assert.ok(bytes(long) < OUTPUT_MAX)
  assert.equal(optionsSummary({}, {}), 'Options: no symbol')
})

test('a run reads the same whether it is loading, failed, or in; errors lose the IPC wrapping', () => {
  assert.equal(cleanError("Error invoking remote method 'source:run': Error: Yahoo Finance: 429"), 'Yahoo Finance: 429')
  assert.deepEqual(runOf({ data: undefined, meta: {}, error: null, loading: true }), { rows: [], meta: {}, error: null, loading: true })
  assert.deepEqual(runOf({ data: [{ a: 1 }], meta: { b: 2 }, error: null, loading: false }), { rows: [{ a: 1 }], meta: { b: 2 }, error: null, loading: false })
})
