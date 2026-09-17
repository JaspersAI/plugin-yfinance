import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  marketSummaryResult,
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
} from './quotes.ts'

// Quotes, search, news, the market summary, and the movers, read from Yahoo's own answers (trimmed
// copies in fixtures/, taken 2026-09-16).

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

test('a quote reads its price, change, and figures, in percent where Yahoo writes percent', () => {
  const quotes = readQuotes(fixture('quote'))
  assert.deepEqual(
    quotes.map((q) => q.symbol),
    ['AAPL', 'SPY', '^GSPC', 'BTC-USD', 'EURUSD=X'],
  )
  const apple = quotes[0]!
  assert.deepEqual(apple, {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    type: 'EQUITY',
    exchange: 'NasdaqGS',
    currency: 'USD',
    priceHint: 2,
    marketState: 'POSTPOST',
    price: 332.41,
    change: 1.07001,
    changePercent: 0.322933,
    previousClose: 331.34,
    open: 332.42,
    dayLow: 330.7,
    dayHigh: 335.48,
    volume: 35923957,
    averageVolume: 53536934,
    marketCap: 4851251544064,
    pe: 38.033184,
    forwardPe: 34.688007,
    eps: 8.74,
    dividendYield: 0.33,
    fiftyTwoWeekLow: 236.65,
    fiftyTwoWeekHigh: 344.57,
    preMarketPrice: null,
    preMarketChangePercent: null,
    postMarketPrice: 333.43,
    postMarketChangePercent: 0.30684668,
    rating: '2.2 - Buy',
    time: '2026-09-16T20:00:01.000Z',
  })
  const euro = quotes[4]!
  assert.equal(euro.priceHint, 4)
  assert.equal(euro.dividendYield, null)
  assert.equal(readQuotes(fixture('quote_none')).length, 0)
  assert.deepEqual(readQuotes({ nope: true }), [])
})

test('the quotes answer names what Yahoo did not find, and writes each quote on a line', () => {
  const quotes = readQuotes(fixture('quote'))
  const result = quotesResult(quotes, ['AAPL', 'SPY', '^GSPC', 'BTC-USD', 'EURUSD=X', 'NOPE123X'])
  assert.deepEqual(result.structuredContent.missing, ['NOPE123X'])
  assert.equal(result.structuredContent.rows.length, 5)
  const text = result.content[0]!.text
  const lines = text.split('\n')
  assert.equal(lines[0], 'Quotes from Yahoo Finance (some exchanges are delayed):')
  assert.equal(
    lines[1],
    'AAPL Apple Inc. (EQUITY, NasdaqGS, USD): 332.41, +1.07 (+0.32%), market closed, post-market 333.43 (+0.31%). Day 330.70-335.48, open 332.42, previous close 331.34. Volume 35.92M, 3-month average 53.54M. Market cap 4.85T. P/E 38.03, forward P/E 34.69, EPS 8.74. Dividend yield 0.33%. 52-week range 236.65-344.57. Analysts: 2.2 - Buy. As of 2026-09-16 20:00 UTC.',
  )
  assert.match(text, /^EURUSD=X EUR\/USD \(CURRENCY, CCY, USD\): 1\.1461, -0\.0008 \(-0\.07%\), market open\./m)
  assert.match(text, /No quote for NOPE123X\. Check the symbol with the search tool\.$/)
})

test('search reads its matches, and an empty search is an answer, not a failure', () => {
  const matches = readSearch(fixture('search'))
  assert.equal(matches.length, 7)
  assert.deepEqual(matches[0], { symbol: 'AAPL', name: 'Apple Inc.', type: 'EQUITY', typeLabel: 'Equity', exchange: 'NASDAQ', sector: 'Technology', industry: 'Consumer Electronics' })
  assert.deepEqual(matches[2], { symbol: 'XAAPL=F', name: 'Micro Apple Inc Stock Futures,S', type: 'FUTURE', typeLabel: 'Futures', exchange: 'Chicago Mercantile Exchange', sector: null, industry: null })
  const result = searchResult('apple', matches)
  assert.equal(result.structuredContent.query, 'apple')
  assert.equal(result.content[0]!.text.split('\n')[1], 'AAPL: Apple Inc. (Equity, NASDAQ, Technology / Consumer Electronics)')
  const empty = searchResult('zzqqxx', readSearch(fixture('search_empty')))
  assert.equal(empty.content[0]!.text, 'No Yahoo Finance symbols match "zzqqxx".')
  assert.deepEqual(empty.structuredContent.rows, [])
})

test('news reads each story, newest first, with its link and tickers', () => {
  const stories = readNews(fixture('news'))
  assert.equal(stories.length, 3)
  assert.deepEqual(stories[0], {
    title: 'Did AI Servers Really Quadruple Dell Stock?',
    publisher: 'Trefis',
    published: '2026-09-17T01:01:09.000Z',
    url: 'https://finance.yahoo.com/markets/stocks/articles/did-ai-servers-really-quadruple-010109395.html',
    tickers: ['DELL', 'HPE', '^GSPC', 'CSCO', 'HPQ', 'IBM', 'AAPL'],
  })
  const text = newsResult('AAPL', stories).content[0]!.text
  assert.equal(text.split('\n')[0], 'Yahoo Finance news for "AAPL", newest first:')
  assert.equal(
    text.split('\n')[1],
    '2026-09-17 01:01 UTC, Trefis: Did AI Servers Really Quadruple Dell Stock? https://finance.yahoo.com/markets/stocks/articles/did-ai-servers-really-quadruple-010109395.html (DELL, HPE, ^GSPC, CSCO, HPQ, IBM, AAPL)',
  )
  assert.equal(newsResult('zz', []).content[0]!.text, 'Yahoo Finance has no news for "zz".')
})

test('the market summary reads wrapped figures and short names', () => {
  const rows = readMarketSummary(fixture('market_summary'))
  assert.deepEqual(
    rows.map((r) => [r.symbol, r.name, r.type, r.price, r.changePercent]),
    [
      ['ES=F', 'S&P Futures', 'FUTURE', 7664.5, 0.5444051],
      ['CL=F', 'Crude Oil', 'FUTURE', 102.22, -0.20501716],
      ['EURUSD=X', 'EUR/USD', 'CURRENCY', 1.1461318, -0.068773545],
      ['^TNX', '10-Yr Bond', 'INDEX', 5.006, 0.20016472],
      ['^VIX', 'VIX', 'INDEX', 17.71, 2.9651065],
      ['BTC-USD', 'Bitcoin USD', 'CRYPTOCURRENCY', 76450.1, 1.3462098],
    ],
  )
  assert.equal(rows[0]!.time, '2026-09-17T01:31:53.000Z')
  const text = marketSummaryResult('US', rows).content[0]!.text
  assert.equal(text.split('\n')[0], 'Markets from Yahoo Finance (region US):')
  assert.equal(text.split('\n')[1], 'S&P Futures (ES=F, FUTURE): 7,664.50, +41.50 (+0.54%), market open')
  assert.equal(text.split('\n')[3], 'EUR/USD (EURUSD=X, CURRENCY): 1.1461, -0.0008 (-0.07%), market open')
})

test('a saved screen reads its title and quotes; trending reads its symbols', () => {
  const screen = readScreen(fixture('day_gainers'))
  assert.equal(screen.title, 'Day Gainers')
  assert.equal(screen.description, 'Discover the equities with the greatest gains in the trading day.')
  assert.equal(screen.total, 91)
  assert.deepEqual(
    screen.rows.map((q) => [q.symbol, q.name, q.changePercent, q.dividendYield]),
    [
      ['AXTI', 'AXT, Inc.', 11.4385, 0],
      ['ARQT', 'Arcutis Biotherapeutics, Inc.', 11.1867, 0],
      ['FPS', 'Forgent Power Solutions, Inc.', 11.0969, 0],
    ],
  )
  const result = moversResult('gainers', screen)
  assert.equal(result.structuredContent.list, 'gainers')
  assert.equal(result.structuredContent.title, 'Day Gainers')
  const lines = result.content[0]!.text.split('\n')
  assert.equal(lines[0], 'Day Gainers (Yahoo Finance): Discover the equities with the greatest gains in the trading day. 3 of 91.')
  assert.equal(lines[1], 'AXTI AXT, Inc.: 64.30 +11.44%, volume 12.00M, market cap 4.22B, NasdaqGS')
  assert.deepEqual(readTrending(fixture('trending')), ['NBIS', 'MEDS', 'BA', 'GNRC', 'ON', 'DLXY', 'SNYR', 'BE', 'FLNC', 'INTC'])
  assert.throws(() => readScreen({ finance: { result: [] } }), /no screen/)
})
