import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../server/server.ts'

// Every tool once against the real Yahoo Finance, then the stdio server the connection runs: `npm run
// smoke`. Run it on the app's own Node to check what the app will see:
// ELECTRON_RUN_AS_NODE=1 <path to Electron> scripts/smoke.ts
// One line per call; exits 1 when anything failed. Not part of the tests: it needs the network.

const CALLS: [string, Record<string, unknown>][] = [
  ['search', { query: 'nvidia' }],
  ['get_quote', { symbols: ['AAPL', 'SPY', '^GSPC', 'EURUSD=X', 'BTC-USD', 'SHOP.TO'] }],
  ['get_price_history', { symbol: 'MSFT', range: '1mo' }],
  ['get_price_history', { symbol: 'AAPL', range: '5d', interval: '15m' }],
  ['get_price_history', { symbol: 'KO', start: '2025-01-01', end: '2025-12-31', interval: '1mo' }],
  ['get_company_profile', { symbol: 'NVDA' }],
  ['get_key_statistics', { symbol: 'JPM' }],
  ['get_financials', { symbol: 'AAPL', statement: 'income', frequency: 'annual' }],
  ['get_financials', { symbol: 'MSFT', statement: 'balance', frequency: 'quarterly' }],
  ['get_financials', { symbol: 'AMZN', statement: 'cashflow', frequency: 'trailing' }],
  ['get_earnings', { symbol: 'AAPL' }],
  ['get_analyst_ratings', { symbol: 'TSLA', limit: 5 }],
  ['get_holders', { symbol: 'AAPL', limit: 5 }],
  ['get_options_chain', { symbol: 'SPY', strikes: 3 }],
  ['get_news', { query: 'NVDA', limit: 5 }],
  ['get_market_summary', {}],
  ['get_market_movers', { list: 'gainers', limit: 5 }],
  ['get_market_movers', { list: 'trending', limit: 5 }],
  ['get_market_movers', { list: 'undervalued_growth', limit: 5 }],
  ['get_fund_holdings', { symbol: 'QQQ' }],
]

interface Result {
  isError?: boolean
  content: { type: string; text?: string }[]
  structuredContent?: { rows?: unknown[] }
}

let failed = 0

const server = createServer()
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
await server.connect(serverSide)
const client = new Client({ name: 'smoke', version: '0.0.0' })
await client.connect(clientSide)

for (const [name, args] of CALLS) {
  const started = Date.now()
  const result = (await client.callTool({ name, arguments: args })) as Result
  const text = result.content.map((block) => block.text ?? '').join('\n')
  const rows = result.structuredContent?.rows?.length ?? 0
  if (result.isError || rows === 0) failed++
  const mark = result.isError ? 'FAIL' : rows === 0 ? 'EMPTY' : 'ok'
  console.log(`${mark.padEnd(5)} ${name.padEnd(20)} ${JSON.stringify(args).padEnd(70)} ${String(rows).padStart(4)} rows ${String(Date.now() - started).padStart(5)} ms  ${text.split('\n')[0]!.slice(0, 110)}`)
  if (process.env['SMOKE_VERBOSE']) console.log(text, '\n')
}
await client.close()

// The connection's own way in: the server over stdio, on this same Node.
const stdio = new Client({ name: 'smoke-stdio', version: '0.0.0' })
await stdio.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', new URL('../server/main.ts', import.meta.url).pathname],
    env: { ...(process.env as Record<string, string>) },
  }),
)
const { tools } = await stdio.listTools()
const quote = (await stdio.callTool({ name: 'get_quote', arguments: { symbols: ['AAPL'] } })) as Result
console.log(`${quote.isError || tools.length !== 14 ? 'FAIL' : 'ok'}    stdio: ${tools.length} tools; ${quote.content[0]?.text?.split('\n')[1]?.slice(0, 100)}`)
if (quote.isError || tools.length !== 14) failed++
await stdio.close()

console.log(failed ? `${failed} failed` : 'all good')
process.exit(failed ? 1 : 0)
