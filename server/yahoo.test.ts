import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildUrl, cookieHeader, createYahoo, isCrumb, RATE_LIMITED, USER_AGENT, yahooError, YahooError } from './yahoo.ts'

// The client against a stand-in Yahoo: the session (cookie, then crumb), the one more try a refusal
// can earn, Yahoo's own words for what it refused, the answers it keeps, and how many go out at once.

interface Call {
  url: URL
  headers: Record<string, string>
  redirect: string | undefined
}

type Handler = (url: URL, n: number) => Response | Promise<Response>

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function cookieResponse(value = 'A3=d=one'): Response {
  const headers = new Headers()
  headers.append('set-cookie', `${value}; Expires=Fri, 17 Sep 2027 03:00:00 GMT; Domain=.yahoo.com; Path=/; SameSite=None; Secure; HttpOnly`)
  headers.append('set-cookie', 'B=x; Path=/')
  return new Response('', { status: 404, headers })
}

/** Yahoo's stand-in: answers by host and path, counting each; every call is kept. */
function yahoo(routes: Record<string, Handler>): { calls: Call[]; count: (path: string) => number; fetch: typeof fetch } {
  const calls: Call[] = []
  const seen = new Map<string, number>()
  const stand = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) }, redirect: init?.redirect })
    const key = url.host === 'fc.yahoo.com' ? 'cookie' : url.pathname
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    const handler = routes[key]
    if (!handler) return new Response('Not Found', { status: 404 })
    return handler(url, n)
  }
  return { calls, count: (key) => seen.get(key) ?? 0, fetch: stand as typeof fetch }
}

const SESSION: Record<string, Handler> = {
  cookie: () => cookieResponse(),
  '/v1/test/getcrumb': (_url, n) => new Response(`crumb${n}`, { headers: { 'content-type': 'text/plain' } }),
}

const noSleep = { sleep: async () => {} }
const QUOTE = { path: '/v7/finance/quote', query: { symbols: 'AAPL' }, crumb: true, ttl: 15_000, what: 'the AAPL quote' }
const CHART = { path: '/v8/finance/chart/AAPL', query: { range: '1mo', interval: '1d' }, ttl: 60_000, what: 'AAPL price history' }

test('the pure helpers: urls, cookies, crumbs, and the words in a Yahoo error body', () => {
  assert.equal(
    buildUrl('/v7/finance/quote', { symbols: '^GSPC,BRK-B', formatted: false, skip: undefined }, 'a/b'),
    'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EGSPC%2CBRK-B&formatted=false&crumb=a%2Fb',
  )
  assert.equal(buildUrl('/v1/finance/trending/US', {}), 'https://query1.finance.yahoo.com/v1/finance/trending/US')
  assert.equal(cookieHeader(['A3=d=1; Path=/; Secure', ' B=2 ', '']), 'A3=d=1; B=2')
  assert.equal(isCrumb('hHMPBlz4oJT'), true)
  assert.equal(isCrumb('Too Many Requests'), false)
  assert.equal(isCrumb('<html>'), false)
  assert.equal(isCrumb(''), false)
  assert.equal(yahooError({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }), 'No data found, symbol may be delisted')
  assert.equal(yahooError({ finance: { result: null, error: { code: 'Unauthorized' } } }), 'Unauthorized')
  assert.equal(yahooError({ timeseries: { result: [], error: null } }), null)
  assert.equal(yahooError('nope'), null)
})

test('a crumb request opens the session first, with the plain agent everywhere, and carries crumb and cookie', async () => {
  const stand = yahoo({ ...SESSION, '/v7/finance/quote': () => json({ quoteResponse: { result: [{ symbol: 'AAPL' }], error: null } }) })
  const client = createYahoo({ fetch: stand.fetch, ...noSleep })
  const body = await client.get(QUOTE)
  assert.deepEqual(body, { quoteResponse: { result: [{ symbol: 'AAPL' }], error: null } })
  assert.deepEqual(
    stand.calls.map((c) => c.url.host + c.url.pathname),
    ['fc.yahoo.com/', 'query1.finance.yahoo.com/v1/test/getcrumb', 'query1.finance.yahoo.com/v7/finance/quote'],
  )
  assert.ok(stand.calls.every((c) => c.headers['user-agent'] === USER_AGENT))
  assert.equal(stand.calls[0]!.redirect, 'manual')
  // The crumb is text: asking for JSON gets a 406.
  assert.equal(stand.calls[1]!.headers['accept'], '*/*')
  assert.equal(stand.calls[1]!.headers['cookie'], 'A3=d=one; B=x')
  assert.equal(stand.calls[2]!.url.searchParams.get('crumb'), 'crumb1')
  assert.equal(stand.calls[2]!.headers['cookie'], 'A3=d=one; B=x')
})

test('askers at once share one session; a request without the crumb never waits for one', async () => {
  const stand = yahoo({
    ...SESSION,
    '/v7/finance/quote': (url) => json({ quoteResponse: { result: [{ symbol: url.searchParams.get('symbols') }], error: null } }),
    '/v8/finance/chart/AAPL': () => json({ chart: { result: [{}], error: null } }),
  })
  const client = createYahoo({ fetch: stand.fetch, ...noSleep })
  await Promise.all(['A', 'B', 'C'].map((s) => client.get({ ...QUOTE, query: { symbols: s } })))
  assert.equal(stand.count('cookie'), 1)
  assert.equal(stand.count('/v1/test/getcrumb'), 1)
  const fresh = createYahoo({ fetch: stand.fetch, ...noSleep })
  await fresh.get(CHART)
  const chart = stand.calls.at(-1)!
  assert.equal(chart.url.pathname, '/v8/finance/chart/AAPL')
  assert.equal(chart.headers['cookie'], undefined)
  assert.equal(chart.url.searchParams.has('crumb'), false)
  assert.equal(stand.count('cookie'), 1)
})

test('a 401 opens a new session and asks once more with its crumb', async () => {
  const stand = yahoo({
    ...SESSION,
    '/v7/finance/quote': (url) =>
      url.searchParams.get('crumb') === 'crumb1'
        ? json({ finance: { result: null, error: { code: 'Unauthorized', description: 'Invalid Crumb' } } }, 401)
        : json({ quoteResponse: { result: [], error: null } }),
  })
  const client = createYahoo({ fetch: stand.fetch, ...noSleep })
  assert.deepEqual(await client.get(QUOTE), { quoteResponse: { result: [], error: null } })
  assert.equal(stand.count('/v1/test/getcrumb'), 2)
  assert.equal(stand.calls.at(-1)!.url.searchParams.get('crumb'), 'crumb2')
})

test('a 401 on a request that went without a session gets one; a second 401 is a refusal in words', async () => {
  const stand = yahoo({
    ...SESSION,
    '/v8/finance/chart/AAPL': (url) =>
      url.searchParams.has('crumb') ? json({ chart: { result: [], error: null } }) : json({ chart: { result: null, error: { description: 'Unauthorized' } } }, 401),
    '/v7/finance/quote': () => json({ finance: { result: null, error: { code: 'Unauthorized', description: 'User is unable to access this feature' } } }, 401),
  })
  const client = createYahoo({ fetch: stand.fetch, ...noSleep })
  assert.deepEqual(await client.get(CHART), { chart: { result: [], error: null } })
  await assert.rejects(client.get(QUOTE), (err: Error) => {
    assert.ok(err instanceof YahooError)
    assert.equal(err.message, 'Yahoo Finance refused the AAPL quote: User is unable to access this feature.')
    return true
  })
})

test('a 429 is tried once more after a pause, then reported as a limit', async () => {
  let pauses = 0
  const sleep = async (ms: number): Promise<void> => {
    assert.equal(ms, 800)
    pauses++
  }
  const limited = yahoo({ ...SESSION, '/v8/finance/chart/AAPL': () => new Response('Too Many Requests', { status: 429 }) })
  await assert.rejects(createYahoo({ fetch: limited.fetch, sleep }).get(CHART), { message: RATE_LIMITED })
  assert.equal(limited.count('/v8/finance/chart/AAPL'), 2)
  assert.equal(pauses, 1)
  const once = yahoo({
    ...SESSION,
    '/v8/finance/chart/AAPL': (_url, n) => (n === 1 ? new Response('Too Many Requests', { status: 429 }) : json({ chart: { result: [], error: null } })),
  })
  assert.deepEqual(await createYahoo({ fetch: once.fetch, sleep }).get(CHART), { chart: { result: [], error: null } })
})

test('a server error and a network failure get one more try; Yahoo’s own words are kept', async () => {
  const down = yahoo({ '/v8/finance/chart/AAPL': () => json({ chart: { result: null, error: { code: 'Internal Server Error', description: 'Service busy' } } }, 503) })
  await assert.rejects(createYahoo({ fetch: down.fetch, ...noSleep }).get(CHART), { message: 'Yahoo Finance answered 503 for AAPL price history: Service busy' })
  assert.equal(down.count('/v8/finance/chart/AAPL'), 2)
  let tries = 0
  const offline = (async () => {
    tries++
    throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND query1.finance.yahoo.com') })
  }) as typeof fetch
  await assert.rejects(createYahoo({ fetch: offline, ...noSleep }).get(CHART), {
    message: 'Yahoo Finance could not be reached for AAPL price history: getaddrinfo ENOTFOUND query1.finance.yahoo.com',
  })
  assert.equal(tries, 2)
})

test('a refusal Yahoo explains is not tried again: a 404, a 422, or an error in a 200', async () => {
  const stand = yahoo({
    '/v8/finance/chart/NOPE': () => json({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }, 404),
    '/v8/finance/chart/AAPL': () => json({ chart: { result: null, error: { code: 'Unprocessable Entity', description: '1m data not available' } } }, 422),
    '/v1/finance/screener/predefined/saved': () => json({ finance: { result: null, error: { code: 'Bad Request', description: 'Invalid scrIds' } } }),
    '/v1/finance/trending/US': () => new Response('<html>oops</html>'),
  })
  const client = createYahoo({ fetch: stand.fetch, ...noSleep })
  await assert.rejects(client.get({ ...CHART, path: '/v8/finance/chart/NOPE' }), { message: 'Yahoo Finance: No data found, symbol may be delisted' })
  await assert.rejects(client.get(CHART), { message: 'Yahoo Finance: 1m data not available' })
  await assert.rejects(client.get({ path: '/v1/finance/screener/predefined/saved', ttl: 1, what: 'the day gainers' }), { message: 'Yahoo Finance: Invalid scrIds' })
  await assert.rejects(client.get({ path: '/v1/finance/trending/US', ttl: 1, what: 'trending tickers' }), {
    message: 'Yahoo Finance answered trending tickers with something that is not JSON.',
  })
  assert.equal(stand.count('/v8/finance/chart/NOPE'), 1)
  assert.equal(stand.count('/v8/finance/chart/AAPL'), 1)
})

test('a session Yahoo will not open is reported, and the next ask tries again', async () => {
  let refuse = true
  const stand = yahoo({
    cookie: () => cookieResponse(),
    '/v1/test/getcrumb': () => (refuse ? new Response('Too Many Requests', { status: 429 }) : new Response('good1')),
    '/v7/finance/quote': () => json({ quoteResponse: { result: [], error: null } }),
  })
  const client = createYahoo({ fetch: stand.fetch, ...noSleep })
  await assert.rejects(client.get(QUOTE), { message: RATE_LIMITED })
  refuse = false
  await client.get({ ...QUOTE, query: { symbols: 'MSFT' } })
  assert.equal(stand.calls.at(-1)!.url.searchParams.get('crumb'), 'good1')
  const cookieless = yahoo({ cookie: () => new Response('', { status: 404 }) })
  await assert.rejects(createYahoo({ fetch: cookieless.fetch, ...noSleep }).get(QUOTE), { message: 'Yahoo Finance did not open a session (no cookie).' })
})

test('an answer is kept for its time, whatever the crumb, and a failure is not', async () => {
  let clock = 0
  let fail = true
  const stand = yahoo({
    ...SESSION,
    '/v7/finance/quote': () => json({ quoteResponse: { result: [], error: null } }),
    '/v8/finance/chart/AAPL': () => (fail ? json({ chart: { result: null, error: { description: 'nope' } } }, 404) : json({ chart: { result: [] } })),
  })
  const client = createYahoo({ fetch: stand.fetch, now: () => clock, ...noSleep })
  await client.get(QUOTE)
  clock = 14_999
  client.reset()
  await client.get(QUOTE)
  assert.equal(stand.count('/v7/finance/quote'), 1)
  clock = 15_000
  await client.get(QUOTE)
  assert.equal(stand.count('/v7/finance/quote'), 2)
  await assert.rejects(client.get(CHART))
  fail = false
  assert.deepEqual(await client.get(CHART), { chart: { result: [] } })
})

test('at most four requests are out at once', async () => {
  let out = 0
  let most = 0
  const stand = yahoo({
    '/v8/finance/chart/AAPL': async () => {
      out++
      most = Math.max(most, out)
      await new Promise((resolve) => setTimeout(resolve, 5))
      out--
      return json({ chart: { result: [] } })
    },
  })
  const client = createYahoo({ fetch: stand.fetch, ...noSleep })
  await Promise.all(Array.from({ length: 10 }, (_, i) => client.get({ ...CHART, query: { range: `${i}d` } })))
  assert.equal(stand.count('/v8/finance/chart/AAPL'), 10)
  assert.equal(most, 4)
})
