import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { expirationSeconds, nearestExpirations, optionsResult, readExpirations, readOptions } from './options.ts'

// An option chain: calls and puts by strike, the strikes nearest the price, the totals for the whole
// expiration, and the strike at the money.

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

test('expirations are days, named to Yahoo as that day at 00:00 UTC', () => {
  assert.deepEqual(readExpirations(fixture('options')), ['2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25', '2026-10-02'])
  assert.equal(expirationSeconds('2026-09-18'), 1789689600)
  assert.deepEqual(nearestExpirations(readExpirations(fixture('options')), '2026-09-22', 3), ['2026-09-21', '2026-09-23', '2026-09-25'])
  assert.throws(() => readExpirations({ optionChain: { result: [] } }), /no option chain/)
})

test('the chain keeps the strikes nearest the price, sums the whole expiration, and finds the money', () => {
  const options = readOptions(fixture('options'), 3)
  assert.equal(options.symbol, 'AAPL')
  assert.equal(options.expiration, '2026-09-18')
  assert.deepEqual(options.underlying, { price: 332.41, change: 1.07001, changePercent: 0.322933 })
  assert.deepEqual(options.rows.map((row) => row.strike), [325, 327.5, 330, 332.5, 335, 337.5])
  assert.deepEqual(options.rows[0], {
    strike: 325,
    call: { contract: 'AAPL260918C00325000', last: 8.25, change: 0.58, bid: 8.05, ask: 8.45, volume: 3228, openInterest: 19934, ivPercent: 37.01, inTheMoney: true },
    put: { contract: 'AAPL260918P00325000', last: 0.65, change: -0.63, bid: 0.62, ask: 0.66, volume: 17020, openInterest: 15674, ivPercent: 31.18, inTheMoney: false },
  })
  assert.deepEqual(options.totals, {
    calls: 13,
    puts: 12,
    callVolume: 200214,
    putVolume: 91435,
    callOpenInterest: 181339,
    putOpenInterest: 68858,
    putCallVolumeRatio: 0.4567,
    putCallOpenInterestRatio: 0.3797,
  })
  assert.deepEqual(options.atm, { strike: 332.5, callMid: 2.945, putMid: 2.82, callIvPercent: 30.91, putIvPercent: 29.08 })
  // A strike with a call and no put keeps its row.
  assert.equal(readOptions(fixture('options'), 50).rows.at(-1)!.put, null)
  const later = readOptions(fixture('options_date'), 2)
  assert.equal(later.expiration, '2026-09-21')
  assert.deepEqual(later.rows.map((row) => row.strike), [327.5, 330, 332.5, 335])
})

test('the text sums up the expiration and lists each side at two decimals', () => {
  const lines = optionsResult(readOptions(fixture('options'), 3)).content[0]!.text.split('\n')
  assert.deepEqual(lines.slice(0, 7), [
    'AAPL options expiring 2026-09-18, from Yahoo Finance, in USD. Underlying 332.41, +1.07 (+0.32%).',
    'Expirations (5): 2026-09-18, 2026-09-21, 2026-09-23, 2026-09-25, 2026-10-02',
    'This expiration: 13 calls and 12 puts; call volume 200,214 and open interest 181,339; put volume 91,435 and open interest 68,858; put/call 0.46 by volume, 0.38 by open interest.',
    'Nearest the price, 332.50: call mid 2.95, IV 30.91%; put mid 2.82, IV 29.08%.',
    'Strikes nearest the price (ITM: in the money):',
    'strike | call last, bid, ask, volume, open interest, IV | put last, bid, ask, volume, open interest, IV',
    '325.00 | 8.25, 8.05, 8.45, 3,228, 19,934, 37.01% ITM | 0.65, 0.62, 0.66, 17,020, 15,674, 31.18%',
  ])
  const puts = optionsResult(readOptions(fixture('options'), 3), 'puts').content[0]!.text.split('\n')
  assert.equal(puts[5], 'strike | put last, bid, ask, volume, open interest, IV')
  assert.equal(puts.at(-1), '337.50 | 6.10, 5.75, 6.20, 1,858, 1,555, 30.25% ITM')
})
