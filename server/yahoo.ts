// Yahoo Finance over HTTP. Yahoo has no public API: these are the endpoints its own pages call, and
// what they need was found by asking (2026-09-16, from Electron's Node).
//
// - The agent is a plain `Mozilla/5.0 (compatible; …)`. A browser's full agent from Node gets 429 on
//   everything, since Yahoo checks it against the TLS handshake; Node's default agent, curl's, and
//   python-requests' get 429 from getcrumb.
// - quote, quoteSummary, and options need a session: the cookie fc.yahoo.com sets (with a 404), and
//   the crumb getcrumb answers with it, as text (asking for JSON gets a 406). Everything else answers
//   without one, and a 401 there asks again with a session.
// - One session per process, shared; a 401 opens a new one and asks once more. A 429, a 5xx, or a
//   network failure is asked once more after a pause. Four requests at a time. Answers are kept for as
//   long as the caller says, without the crumb in the key, and a failure is not kept.

export const USER_AGENT = 'Mozilla/5.0 (compatible; JaspersTerminal-yfinance/1.0)'
export const API = 'https://query1.finance.yahoo.com'
const COOKIE_URL = 'https://fc.yahoo.com/'
const CRUMB_PATH = '/v1/test/getcrumb'
const TIMEOUT_MS = 20_000
const RETRY_MS = 800
const AT_ONCE = 4
const KEPT = 300

export const RATE_LIMITED = 'Yahoo Finance is limiting requests from this network (429). Try again in a minute.'

/** A refusal worded for the caller. */
export class YahooError extends Error {}

export type Query = Record<string, string | number | boolean | undefined>

export interface YahooRequest {
  path: string
  query?: Query
  /** Whether the endpoint needs the session's crumb. */
  crumb?: boolean
  /** How long the answer is kept, in ms. */
  ttl: number
  /** What was asked, for the error: "the AAPL quote". */
  what: string
}

export interface Yahoo {
  /** Yahoo's JSON, or a YahooError in words. */
  get(request: YahooRequest): Promise<unknown>
  /** Forgets the session; the next request that needs one opens another. */
  reset(): void
}

export interface YahooOptions {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Milliseconds, for what is kept. */
  now?: () => number
}

interface Session {
  cookie: string
  crumb: string
}

interface Answer {
  status: number
  body: string
}

export function buildUrl(path: string, query: Query = {}, crumb?: string): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  if (crumb) params.set('crumb', crumb)
  const search = params.toString()
  return `${API}${path}${search ? `?${search}` : ''}`
}

/** The Cookie header for what Set-Cookie said: each cookie's name and value. */
export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((line) => line.split(';')[0]!.trim())
    .filter((pair) => pair.includes('='))
    .join('; ')
}

/** A crumb is a short token: no markup, no spaces. */
export function isCrumb(text: string): boolean {
  return /^[^\s<>]{1,64}$/.test(text)
}

/** What a Yahoo error body says: `{ <anything>: { result: null, error: { code, description } } }`. */
export function yahooError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  for (const value of Object.values(body)) {
    const error = typeof value === 'object' && value !== null ? (value as { error?: unknown }).error : null
    if (typeof error !== 'object' || error === null) continue
    const { description, code } = error as { description?: unknown; code?: unknown }
    if (typeof description === 'string' && description.trim()) return description.trim()
    if (typeof code === 'string' && code.trim()) return code.trim()
  }
  return null
}

function setCookiesOf(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const joined = headers.get('set-cookie')
  return joined ? joined.split(/,(?=\s*[^;,=\s]+=)/) : []
}

function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  if (err.name === 'TimeoutError') return 'no answer in 20 seconds'
  return err.cause instanceof Error ? err.cause.message : err.message
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/** Runs tasks at most `max` at a time; a finishing task hands its place to the next in line. */
function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []
  return async (task) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

export function createYahoo({ fetch: send = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }: YahooOptions = {}): Yahoo {
  const slot = limiter(AT_ONCE)
  const kept = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>()
  let active: { promise: Promise<Session>; value: Session | null } | null = null

  async function openSession(): Promise<Session> {
    let cookie: string
    let answer: Response
    try {
      const home = await send(COOKIE_URL, {
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      cookie = cookieHeader(setCookiesOf(home.headers))
      await home.arrayBuffer().catch(() => undefined)
      if (!cookie) throw new YahooError('Yahoo Finance did not open a session (no cookie).')
      answer = await send(`${API}${CRUMB_PATH}`, {
        headers: { 'user-agent': USER_AGENT, accept: '*/*', cookie },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      if (err instanceof YahooError) throw err
      throw new YahooError(`Yahoo Finance could not be reached for a session: ${reason(err)}`)
    }
    const crumb = (await answer.text()).trim()
    if (answer.status === 429) throw new YahooError(RATE_LIMITED)
    if (!answer.ok || !isCrumb(crumb)) throw new YahooError(`Yahoo Finance did not open a session (${answer.status}).`)
    return { cookie, crumb }
  }

  function session(): Promise<Session> {
    if (!active) {
      const opening: { promise: Promise<Session>; value: Session | null } = { promise: openSession(), value: null }
      opening.promise.then(
        (value) => {
          opening.value = value
        },
        () => {
          if (active === opening) active = null
        },
      )
      active = opening
    }
    return active.promise
  }

  /** A new session in place of the one Yahoo refused, unless another asker has already replaced it. */
  function renew(stale: Session | null): Promise<Session> {
    if (stale && active?.value === stale) active = null
    return session()
  }

  async function ask(url: string, cookie: string | null): Promise<Answer> {
    return slot(async () => {
      const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/json' }
      if (cookie) headers['cookie'] = cookie
      const response = await send(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      return { status: response.status, body: await response.text() }
    })
  }

  async function load(request: YahooRequest): Promise<unknown> {
    let current = request.crumb ? await session() : null
    let renewed = false
    let retried = false
    for (;;) {
      let answer: Answer
      try {
        answer = await ask(buildUrl(request.path, request.query, current?.crumb), current?.cookie ?? null)
      } catch (err) {
        if (!retried) {
          retried = true
          await sleep(RETRY_MS)
          continue
        }
        throw new YahooError(`Yahoo Finance could not be reached for ${request.what}: ${reason(err)}`)
      }
      const { status } = answer
      if (status === 401 && !renewed) {
        renewed = true
        current = await renew(current)
        continue
      }
      if ((status === 429 || status >= 500) && !retried) {
        retried = true
        await sleep(RETRY_MS)
        continue
      }
      const body = parse(answer.body)
      const said = yahooError(body)
      if (status === 429) throw new YahooError(RATE_LIMITED)
      if (status === 401) throw new YahooError(`Yahoo Finance refused ${request.what}: ${said ?? 'not authorized'}.`)
      if (status >= 500) throw new YahooError(`Yahoo Finance answered ${status} for ${request.what}${said ? `: ${said}` : '.'}`)
      if (status < 200 || status >= 300) throw new YahooError(said ? `Yahoo Finance: ${said}` : `Yahoo Finance answered ${status} for ${request.what}.`)
      if (body === undefined) throw new YahooError(`Yahoo Finance answered ${request.what} with something that is not JSON.`)
      if (said) throw new YahooError(`Yahoo Finance: ${said}`)
      return body
    }
  }

  return {
    get(request) {
      const key = buildUrl(request.path, request.query)
      const hit = kept.get(key)
      if (hit && now() - hit.at < hit.ttl) return hit.value
      const value = load(request)
      kept.delete(key)
      kept.set(key, { at: now(), ttl: request.ttl, value })
      value.catch(() => {
        if (kept.get(key)?.value === value) kept.delete(key)
      })
      if (kept.size > KEPT) kept.delete(kept.keys().next().value!)
      return value
    },
    reset() {
      active = null
    },
  }
}
