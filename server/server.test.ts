import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from './server.ts'

// The server end to end: a real MCP client talks to it in memory, and only Yahoo is a stand-in,
// answering by path with the answers Yahoo gave (fixtures/).

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const SUMMARY: Record<string, string> = {
  'assetProfile,summaryProfile,quoteType,price': 'profile',
  'summaryDetail,defaultKeyStatistics,financialData,price': 'stats',
  'earningsHistory,earningsTrend,calendarEvents,earnings,price': 'earnings',
  'financialData,recommendationTrend,upgradeDowngradeHistory,price': 'analysts',
  'majorHoldersBreakdown,institutionOwnership,fundOwnership,insiderHolders,insiderTransactions,netSharePurchaseActivity,price': 'holders',
  'topHoldings,fundProfile,defaultKeyStatistics,summaryDetail,quoteType,price': 'fund',
}

const TIMESERIES: Record<string, string> = {
  annualTotalRevenue: 'ts_income_annual',
  quarterlyTotalRevenue: 'ts_income_quarterly',
  trailingTotalRevenue: 'ts_income_trailing',
  annualTotalAssets: 'ts_balance_annual',
  annualOperatingCashFlow: 'ts_cash_annual',
}

/** Yahoo's stand-in, answering like Yahoo did; `answers` replaces a path's answer. Every URL is kept. */
function yahoo(answers: Record<string, (url: URL) => Response> = {}): { asked: URL[]; fetch: typeof fetch } {
  const asked: URL[] = []
  const stand = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input))
    asked.push(url)
    const { pathname: path, searchParams: q } = url
    if (answers[path]) return answers[path](url)
    if (url.host === 'fc.yahoo.com') return new Response('', { status: 404, headers: { 'set-cookie': 'A3=d=test; Path=/' } })
    if (path === '/v1/test/getcrumb') return new Response('crumb1')
    if (path === '/v1/finance/search') return json(fixture(q.get('quotesCount') === '0' ? 'news' : q.get('q') === 'zzqqxx' ? 'search_empty' : 'search'))
    if (path === '/v7/finance/quote') return json(fixture(q.get('symbols') === 'NOPE123X' ? 'quote_none' : 'quote'))
    if (path === '/v8/finance/chart/AAPL') return json(fixture('chart_daily'))
    if (path === '/v8/finance/chart/NVDA') return json(fixture('chart_events'))
    if (path === '/v8/finance/chart/NOPE123X') return json(fixture('chart_bad'), 404)
    if (path.startsWith('/v10/finance/quoteSummary/')) {
      const symbol = path.split('/').at(-1)
      if (symbol === 'NOPE123X') return json(fixture('qs_bad'), 404)
      const name = SUMMARY[q.get('modules') ?? '']
      if (!name) return json({ quoteSummary: { result: null, error: { description: `unexpected modules ${q.get('modules')}` } } }, 400)
      if (name === 'fund' && symbol === 'AAPL') return json(fixture('fund_stock'))
      return json(fixture(name))
    }
    if (path === '/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL') return json(fixture(TIMESERIES[q.get('type')!.split(',')[0]!]!))
    if (path === '/v7/finance/options/AAPL') return json(fixture(q.get('date') === '1789948800' ? 'options_date' : 'options'))
    if (path === '/v6/finance/quote/marketSummary') return json(fixture('market_summary'))
    if (path === '/v1/finance/screener/predefined/saved') return json(fixture('day_gainers'))
    if (path === '/v1/finance/trending/US') return json(fixture('trending'))
    return new Response('Not Found', { status: 404 })
  }
  return { asked, fetch: stand as typeof fetch }
}

async function connect(fetch: typeof globalThis.fetch): Promise<Client> {
  const server = createServer({ fetch, sleep: async () => {}, now: () => Date.UTC(2026, 8, 16, 22) })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  return client
}

interface Result {
  isError?: boolean
  content: { type: string; text?: string }[]
  structuredContent?: { rows: unknown[] } & Record<string, unknown>
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Result> {
  return (await client.callTool({ name, arguments: args })) as Result
}

const textOf = (result: Result): string => result.content.map((block) => block.text ?? '').join('\n')

const TOOLS = [
  'get_analyst_ratings',
  'get_company_profile',
  'get_earnings',
  'get_financials',
  'get_fund_holdings',
  'get_holders',
  'get_key_statistics',
  'get_market_movers',
  'get_market_summary',
  'get_news',
  'get_options_chain',
  'get_price_history',
  'get_quote',
  'search',
]

test('the server offers its fourteen read-only tools, each described, and says what it is', async () => {
  const client = await connect(yahoo().fetch)
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((tool) => tool.name).sort(), TOOLS)
  for (const tool of tools) {
    assert.ok((tool.description ?? '').length > 60, tool.name)
    assert.equal(tool.annotations?.readOnlyHint, true)
  }
  assert.match(client.getInstructions() ?? '', /Yahoo Finance/)
  const history = tools.find((tool) => tool.name === 'get_price_history')!
  assert.deepEqual(history.inputSchema.required, ['symbol'])
})

test('every tool answers text and rows from Yahoo’s answers', async () => {
  const client = await connect(yahoo().fetch)
  const calls: [string, Record<string, unknown>, number][] = [
    ['search', { query: 'apple' }, 7],
    ['get_quote', { symbols: ['aapl', 'SPY', 'SPY'] }, 5],
    ['get_price_history', { symbol: 'AAPL' }, 5],
    ['get_company_profile', { symbol: 'AAPL' }, 3],
    ['get_key_statistics', { symbol: 'AAPL' }, 64],
    ['get_financials', { symbol: 'AAPL', statement: 'cashflow' }, 4],
    ['get_earnings', { symbol: 'AAPL' }, 4],
    ['get_analyst_ratings', { symbol: 'AAPL', limit: 2 }, 2],
    ['get_holders', { symbol: 'AAPL' }, 3],
    ['get_options_chain', { symbol: 'AAPL', strikes: 2 }, 4],
    ['get_news', { query: 'AAPL' }, 3],
    ['get_market_summary', {}, 6],
    ['get_market_movers', {}, 3],
    ['get_fund_holdings', { symbol: 'SPY' }, 4],
  ]
  for (const [name, args, rows] of calls) {
    const result = await call(client, name, args)
    assert.equal(result.isError, undefined, `${name}: ${textOf(result)}`)
    assert.ok(textOf(result).includes('Yahoo Finance'), name)
    assert.equal(result.structuredContent?.rows.length, rows, name)
  }
})

test('the session opens once, only for the tools that need a crumb', async () => {
  const stand = yahoo()
  const client = await connect(stand.fetch)
  await call(client, 'get_price_history', { symbol: 'AAPL' })
  await call(client, 'search', { query: 'apple' })
  assert.ok(stand.asked.every((url) => url.host !== 'fc.yahoo.com'))
  await call(client, 'get_quote', { symbols: ['AAPL'] })
  await call(client, 'get_key_statistics', { symbol: 'AAPL' })
  assert.equal(stand.asked.filter((url) => url.host === 'fc.yahoo.com').length, 1)
  const quote = stand.asked.find((url) => url.pathname === '/v7/finance/quote')!
  assert.equal(quote.searchParams.get('crumb'), 'crumb1')
  assert.equal(quote.searchParams.get('symbols'), 'AAPL')
})

test('symbols: case and repeats are forgiven, a malformed one is refused, and a missing one is named', async () => {
  const stand = yahoo()
  const client = await connect(stand.fetch)
  const mixed = await call(client, 'get_quote', { symbols: ['aapl', 'NOPE123X'] })
  assert.deepEqual(mixed.structuredContent?.['missing'], ['NOPE123X'])
  assert.equal(stand.asked.at(-1)!.searchParams.get('symbols'), 'AAPL,NOPE123X')
  const none = await call(client, 'get_quote', { symbols: ['NOPE123X'] })
  assert.equal(none.isError, true)
  assert.equal(textOf(none), 'Yahoo Finance has no quote for NOPE123X. Check the symbol with search.')
  const bad = await call(client, 'get_key_statistics', { symbol: 'AAPL; drop' })
  assert.equal(textOf(bad), '"AAPL; drop" is not a Yahoo Finance symbol. Find one with search.')
  const unknown = await call(client, 'get_company_profile', { symbol: 'nope123x' })
  assert.equal(textOf(unknown), 'Yahoo Finance: Quote not found for symbol: NOPE123X')
  const delisted = await call(client, 'get_price_history', { symbol: 'NOPE123X' })
  assert.equal(textOf(delisted), 'Yahoo Finance: No data found, symbol may be delisted')
})

test('price history takes a range or dates, and asks Yahoo for dividends and splits', async () => {
  const stand = yahoo()
  const client = await connect(stand.fetch)
  await call(client, 'get_price_history', { symbol: 'AAPL', interval: '1wk' })
  let url = stand.asked.at(-1)!
  assert.equal(url.searchParams.get('range'), '1y')
  assert.equal(url.searchParams.get('interval'), '1wk')
  assert.equal(url.searchParams.get('events'), 'div,splits')
  await call(client, 'get_price_history', { symbol: 'AAPL', start: '2026-01-02', end: '2026-01-31' })
  url = stand.asked.at(-1)!
  assert.equal(url.searchParams.get('range'), null)
  assert.equal(url.searchParams.get('period1'), String(Date.UTC(2026, 0, 2) / 1000))
  assert.equal(url.searchParams.get('period2'), String(Date.UTC(2026, 1, 1) / 1000))
  await call(client, 'get_price_history', { symbol: 'AAPL', start: '2026-09-01' })
  assert.equal(stand.asked.at(-1)!.searchParams.get('period2'), String(Date.UTC(2026, 8, 17) / 1000))
  assert.equal(textOf(await call(client, 'get_price_history', { symbol: 'AAPL', end: '2026-01-31' })), 'Give start with end, or a range.')
  const nvda = await call(client, 'get_price_history', { symbol: 'NVDA', range: '5y', interval: '3mo' })
  assert.match(textOf(nvda), /Splits: 2024-06-10 10:1\.$/)
})

test('financials ask for the statement’s lines; a trailing balance sheet never reaches Yahoo', async () => {
  const stand = yahoo()
  const client = await connect(stand.fetch)
  const income = await call(client, 'get_financials', { symbol: 'AAPL' })
  assert.match(textOf(income), /^AAPL income statement, annual/)
  const url = stand.asked.at(-1)!
  assert.ok(url.searchParams.get('type')!.startsWith('annualTotalRevenue,annualOperatingRevenue,'))
  assert.equal(url.searchParams.get('period2'), String(Date.UTC(2026, 8, 17) / 1000))
  const before = stand.asked.length
  const refused = await call(client, 'get_financials', { symbol: 'AAPL', statement: 'balance', frequency: 'trailing' })
  assert.equal(refused.isError, true)
  assert.equal(stand.asked.length, before)
})

test('an option expiration is checked against the list, and a later one is asked for by its day', async () => {
  const stand = yahoo()
  const client = await connect(stand.fetch)
  const missing = await call(client, 'get_options_chain', { symbol: 'AAPL', expiration: '2026-09-22' })
  assert.equal(textOf(missing), 'AAPL has no options expiring 2026-09-22. The nearest expirations: 2026-09-21, 2026-09-23, 2026-09-25, 2026-09-18, 2026-10-02.')
  const later = await call(client, 'get_options_chain', { symbol: 'AAPL', expiration: '2026-09-21', strikes: 1 })
  assert.equal(later.structuredContent?.['expiration'], '2026-09-21')
  assert.equal(stand.asked.at(-1)!.searchParams.get('date'), '1789948800')
  const nearest = await call(client, 'get_options_chain', { symbol: 'AAPL', expiration: '2026-09-18', side: 'calls' })
  assert.equal(nearest.structuredContent?.['expiration'], '2026-09-18')
  assert.ok(!textOf(nearest).includes('put last'))
})

test('trending tickers keep Yahoo’s order, priced by one quote call', async () => {
  const stand = yahoo({
    '/v7/finance/quote': (url) =>
      json({
        quoteResponse: {
          result: url.searchParams
            .get('symbols')!
            .split(',')
            .filter((s) => s === 'BA' || s === 'NBIS')
            .reverse()
            .map((symbol) => ({ symbol, regularMarketPrice: 100, regularMarketChangePercent: 1 })),
          error: null,
        },
      }),
  })
  const client = await connect(stand.fetch)
  const result = await call(client, 'get_market_movers', { list: 'trending', limit: 3 })
  assert.deepEqual(
    (result.structuredContent?.rows as { symbol: string }[]).map((q) => q.symbol),
    ['NBIS', 'BA'],
  )
  assert.equal(stand.asked.find((url) => url.pathname === '/v7/finance/quote')!.searchParams.get('symbols'), 'NBIS,MEDS,BA')
  assert.match(textOf(result), /^Trending tickers \(Yahoo Finance\): .* 2 of 3\.$/m)
  await call(client, 'get_market_movers', { list: 'undervalued_large_caps', limit: 5 })
  const screen = stand.asked.at(-1)!
  assert.equal(screen.searchParams.get('scrIds'), 'undervalued_large_caps')
  assert.equal(screen.searchParams.get('count'), '5')
})

test('a stock is not a fund, and Yahoo limiting requests is said plainly', async () => {
  const client = await connect(yahoo().fetch)
  assert.equal(textOf(await call(client, 'get_fund_holdings', { symbol: 'AAPL' })), 'AAPL is not a fund (EQUITY): fund holdings are for ETFs and mutual funds.')
  const limited = await connect(yahoo({ '/v1/finance/search': () => new Response('Too Many Requests', { status: 429 }) }).fetch)
  const refused = await call(limited, 'get_news', { query: 'AAPL' })
  assert.equal(refused.isError, true)
  assert.equal(textOf(refused), 'Yahoo Finance is limiting requests from this network (429). Try again in a minute.')
})
