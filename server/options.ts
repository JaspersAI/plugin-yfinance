import { plain as f } from '../format.ts'
import { list, num, percentOf, record, records, text, type Row } from '../values.ts'
import { toolResult, type ToolResult } from './result.ts'
import { YahooError } from './yahoo.ts'

// An option chain from v7 options: the expirations, and for one of them the calls and puts side by
// side by strike, cut to the strikes nearest the underlying's price. Yahoo names an expiration by its
// day at 00:00 UTC in seconds. Implied volatility is in percent here (30.91 is 30.91%).

export type Contract = {
  contract: string | null
  last: number | null
  change: number | null
  bid: number | null
  ask: number | null
  volume: number | null
  openInterest: number | null
  ivPercent: number | null
  inTheMoney: boolean
}

export type OptionRow = {
  strike: number
  call: Contract | null
  put: Contract | null
}

export type Options = {
  symbol: string
  currency: string | null
  /** The decimals prices show with. */
  priceHint: number
  underlying: { price: number | null; change: number | null; changePercent: number | null }
  /** YYYY-MM-DD. */
  expiration: string
  expirations: string[]
  totals: {
    calls: number
    puts: number
    callVolume: number
    putVolume: number
    callOpenInterest: number
    putOpenInterest: number
    putCallVolumeRatio: number | null
    putCallOpenInterestRatio: number | null
  }
  /** The strike nearest the price, with each side's mid (bid and ask, else last) and IV. */
  atm: { strike: number; callMid: number | null; putMid: number | null; callIvPercent: number | null; putIvPercent: number | null } | null
  /** Strikes nearest the price, ascending. */
  rows: OptionRow[]
}

export const SIDES = ['both', 'calls', 'puts'] as const
export type Side = (typeof SIDES)[number]

/** Yahoo's name for an expiration day. */
export function expirationSeconds(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!) / 1000
}

/** The expirations closest to a day, nearest first. */
export function nearestExpirations(expirations: string[], day: string, count = 5): string[] {
  const at = expirationSeconds(day)
  return [...expirations].sort((a, b) => Math.abs(expirationSeconds(a) - at) - Math.abs(expirationSeconds(b) - at)).slice(0, count)
}

function round(value: number | null, places = 4): number | null {
  return value === null ? null : Math.round(value * 10 ** places) / 10 ** places
}

function readContract(raw: Row): Contract {
  return {
    contract: text(raw['contractSymbol']),
    last: num(raw['lastPrice']),
    change: round(num(raw['change'])),
    bid: num(raw['bid']),
    ask: num(raw['ask']),
    volume: num(raw['volume']),
    openInterest: num(raw['openInterest']),
    ivPercent: round(percentOf(num(raw['impliedVolatility'])), 2),
    inTheMoney: raw['inTheMoney'] === true,
  }
}

function mid(contract: Contract | null): number | null {
  if (!contract) return null
  if (contract.bid !== null && contract.ask !== null && contract.bid > 0 && contract.ask > 0) return round((contract.bid + contract.ask) / 2)
  return contract.last
}

function sum(contracts: Contract[], key: 'volume' | 'openInterest'): number {
  return contracts.reduce((total, c) => total + (c[key] ?? 0), 0)
}

export function chainOf(json: unknown, symbol?: string): Row {
  const chain = records(record(record(json)?.['optionChain'])?.['result'])[0]
  if (!chain) throw new YahooError(`Yahoo Finance has no option chain${symbol ? ` for ${symbol}` : ''}.`)
  return chain
}

/** The expirations a chain lists, as days. */
export function readExpirations(json: unknown, symbol?: string): string[] {
  return list(chainOf(json, symbol)['expirationDates'])
    .map(num)
    .filter((s): s is number => s !== null)
    .map((s) => f.day(s))
}

export function readOptions(json: unknown, strikes: number, asked?: string): Options {
  const chain = chainOf(json, asked)
  const symbol = text(chain['underlyingSymbol']) ?? asked ?? ''
  const quote = record(chain['quote']) ?? {}
  const expirations = readExpirations(json, asked)
  const set = records(chain['options'])[0]
  if (!set) throw new YahooError(`Yahoo Finance lists no options for ${symbol}.`)
  const calls = records(set['calls']).map((c) => ({ strike: num(c['strike']), contract: readContract(c) }))
  const puts = records(set['puts']).map((p) => ({ strike: num(p['strike']), contract: readContract(p) }))
  const byStrike = new Map<number, OptionRow>()
  for (const [side, entries] of [
    ['call', calls],
    ['put', puts],
  ] as const) {
    for (const { strike, contract } of entries) {
      if (strike === null) continue
      const row = byStrike.get(strike) ?? { strike, call: null, put: null }
      row[side] = contract
      byStrike.set(strike, row)
    }
  }
  const all = [...byStrike.values()].sort((a, b) => a.strike - b.strike)
  const price = num(quote['regularMarketPrice'])
  let rows = all
  let atm: Options['atm'] = null
  if (price !== null && all.length) {
    const above = all.findIndex((row) => row.strike >= price)
    const at = above === -1 ? all.length : above
    rows = all.slice(Math.max(0, at - strikes), at + strikes)
    const nearest = all.reduce((best, row) => (Math.abs(row.strike - price) < Math.abs(best.strike - price) ? row : best))
    atm = {
      strike: nearest.strike,
      callMid: mid(nearest.call),
      putMid: mid(nearest.put),
      callIvPercent: nearest.call?.ivPercent ?? null,
      putIvPercent: nearest.put?.ivPercent ?? null,
    }
  } else {
    rows = all.slice(0, strikes * 2)
  }
  const callContracts = calls.map((c) => c.contract)
  const putContracts = puts.map((p) => p.contract)
  const callVolume = sum(callContracts, 'volume')
  const putVolume = sum(putContracts, 'volume')
  const callOpenInterest = sum(callContracts, 'openInterest')
  const putOpenInterest = sum(putContracts, 'openInterest')
  const seconds = num(set['expirationDate'])
  return {
    symbol,
    currency: text(quote['currency']),
    priceHint: num(quote['priceHint']) ?? 2,
    underlying: { price, change: num(quote['regularMarketChange']), changePercent: num(quote['regularMarketChangePercent']) },
    expiration: seconds === null ? (expirations[0] ?? '') : f.day(seconds),
    expirations,
    totals: {
      calls: calls.length,
      puts: puts.length,
      callVolume,
      putVolume,
      callOpenInterest,
      putOpenInterest,
      putCallVolumeRatio: callVolume ? round(putVolume / callVolume) : null,
      putCallOpenInterestRatio: callOpenInterest ? round(putOpenInterest / callOpenInterest) : null,
    },
    atm,
    rows,
  }
}

function side(contract: Contract | null, hint: number): string {
  if (!contract) return '—'
  const cells = [
    f.price(contract.last, hint),
    f.price(contract.bid, hint),
    f.price(contract.ask, hint),
    f.fixed(contract.volume, 0),
    f.fixed(contract.openInterest, 0),
    f.percent(contract.ivPercent),
  ]
  return `${cells.join(', ')}${contract.inTheMoney ? ' ITM' : ''}`
}

export function optionsResult(options: Options, show: Side = 'both'): ToolResult {
  const { symbol, underlying, totals, atm, priceHint: hint } = options
  const move = underlying.change !== null ? `, ${f.signed(underlying.change, hint)} (${f.signedPercent(underlying.changePercent)})` : ''
  const lines = [
    `${symbol} options expiring ${options.expiration}, from Yahoo Finance${options.currency ? `, in ${options.currency}` : ''}. Underlying ${f.price(underlying.price, hint)}${move}.`,
    `Expirations (${options.expirations.length}): ${options.expirations.join(', ')}`,
    `This expiration: ${totals.calls} calls and ${totals.puts} puts; call volume ${f.fixed(totals.callVolume, 0)} and open interest ${f.fixed(
      totals.callOpenInterest,
      0,
    )}; put volume ${f.fixed(totals.putVolume, 0)} and open interest ${f.fixed(totals.putOpenInterest, 0)}; put/call ${f.fixed(
      totals.putCallVolumeRatio,
    )} by volume, ${f.fixed(totals.putCallOpenInterestRatio)} by open interest.`,
  ]
  if (atm) {
    lines.push(
      `Nearest the price, ${f.price(atm.strike, hint)}: call mid ${f.price(atm.callMid, hint)}, IV ${f.percent(atm.callIvPercent)}; put mid ${f.price(atm.putMid, hint)}, IV ${f.percent(atm.putIvPercent)}.`,
    )
  }
  const columns = 'last, bid, ask, volume, open interest, IV'
  const header = ['strike', show !== 'puts' && `call ${columns}`, show !== 'calls' && `put ${columns}`].filter(Boolean).join(' | ')
  lines.push(`Strikes nearest the price (ITM: in the money):`, header)
  for (const row of options.rows) {
    const cells = [f.price(row.strike, hint), show !== 'puts' && side(row.call, hint), show !== 'calls' && side(row.put, hint)].filter(Boolean)
    lines.push(cells.join(' | '))
  }
  return toolResult(lines.join('\n'), options)
}
