import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { historyResult, isIntraday, readHistory } from './history.ts'

// Price history from v8 chart: bars on the market's own clock, dividends and splits, and the text
// the model reads, cut to the latest bars when there are many.

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

test('daily bars read on the market’s day, rounded past Yahoo’s float noise', () => {
  const history = readHistory(fixture('chart_daily'))
  assert.equal(history.symbol, 'AAPL')
  assert.equal(history.name, 'Apple Inc.')
  assert.equal(history.currency, 'USD')
  assert.equal(history.exchange, 'NasdaqGS')
  assert.equal(history.timezone, 'America/New_York')
  assert.equal(history.interval, '1d')
  assert.equal(history.range, '1mo')
  assert.equal(history.intraday, false)
  assert.equal(history.price, 332.41)
  assert.deepEqual(
    history.rows.map((bar) => bar.date),
    ['2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16'],
  )
  assert.deepEqual(history.rows[4], { date: '2026-09-16', open: 332.53, high: 335.48, low: 330.7, close: 332.41, adjClose: 332.41, volume: 35920400 })
  assert.deepEqual(history.dividends, [])
  assert.deepEqual(history.splits, [])
})

test('dividends and splits read by their dates, oldest first', () => {
  const history = readHistory(fixture('chart_events'))
  assert.equal(history.interval, '3mo')
  assert.deepEqual(history.rows.map((bar) => bar.date), ['2026-03-01', '2026-06-01', '2026-09-01', '2026-09-16'])
  assert.equal(history.rows[0]!.adjClose, 210.6585)
  assert.deepEqual(history.dividends, [
    { date: '2026-03-11', amount: 0.01 },
    { date: '2026-06-04', amount: 0.25 },
    { date: '2026-09-10', amount: 0.25 },
  ])
  assert.deepEqual(history.splits, [{ date: '2024-06-10', ratio: '10:1' }])
})

test('intraday bars carry the market’s time; a bar with no close is left out', () => {
  const history = readHistory(fixture('chart_intraday'))
  assert.equal(history.intraday, true)
  assert.deepEqual(history.rows.map((bar) => bar.date), ['2026-09-16 15:15', '2026-09-16 15:30', '2026-09-16 15:45', '2026-09-16 16:00'])
  assert.equal(history.rows[3]!.adjClose, null)
  const gappy = fixture('chart_intraday') as { chart: { result: { indicators: { quote: { close: (number | null)[] }[] } }[] } }
  gappy.chart.result[0]!.indicators.quote[0]!.close[1] = null
  assert.equal(readHistory(gappy).rows.length, 3)
  assert.equal(isIntraday('15m'), true)
  assert.equal(isIntraday('1h'), true)
  assert.equal(isIntraday('1mo'), false)
  assert.equal(isIntraday('1wk'), false)
})

test('the text sums up the period, then lists the bars and the corporate actions', () => {
  const lines = historyResult(readHistory(fixture('chart_daily'))).content[0]!.text.split('\n')
  assert.deepEqual(lines, [
    'AAPL Apple Inc. price history from Yahoo Finance: 5 daily bars from 2026-09-10 to 2026-09-16, in USD (NasdaqGS, America/New_York).',
    'Close 326.57 to 332.41 (+1.79%). High 336.22 on 2026-09-11, low 316.51 on 2026-09-10.',
    'date,open,high,low,close,adj close,volume',
    '2026-09-10,316.67,326.74,316.51,326.57,326.57,70011900',
    '2026-09-11,327.45,336.22,326.30,332.27,332.27,50716900',
    '2026-09-14,334.79,335.50,331.34,333.08,333.08,39269100',
    '2026-09-15,330.14,331.78,328.35,331.34,331.34,31748200',
    '2026-09-16,332.53,335.48,330.70,332.41,332.41,35920400',
  ])
  const events = historyResult(readHistory(fixture('chart_events'))).content[0]!.text.split('\n')
  assert.equal(events[0], 'NVDA NVIDIA Corporation price history from Yahoo Finance: 4 quarterly bars from 2026-03-01 to 2026-09-16, in USD (NasdaqGS, America/New_York).')
  assert.deepEqual(events.slice(-2), ['Dividends per share: 2026-03-11 0.01, 2026-06-04 0.25, 2026-09-10 0.25.', 'Splits: 2024-06-10 10:1.'])
})

test('many bars: the text keeps the latest and says how to get the rest; the rows keep them all', () => {
  const history = readHistory(fixture('chart_daily'))
  const text = historyResult(history, 2).content[0]!.text.split('\n')
  assert.deepEqual(text.slice(2), [
    'date,open,high,low,close,adj close,volume',
    '2026-09-15,330.14,331.78,328.35,331.34,331.34,31748200',
    '2026-09-16,332.53,335.48,330.70,332.41,332.41,35920400',
    'Only the latest 2 of 5 bars are listed; ask for a shorter range or a longer interval to see the rest.',
  ])
  assert.equal(historyResult(history, 2).structuredContent.rows.length, 5)
})

test('a chart with no bars reads empty and says so', () => {
  const empty = readHistory({ chart: { result: [{ meta: { symbol: 'X', dataGranularity: '1d', range: '5d' }, timestamp: [], indicators: { quote: [{}] } }], error: null } })
  assert.equal(empty.rows.length, 0)
  assert.equal(historyResult(empty).content[0]!.text, 'Yahoo Finance has no 1d bars for X over 5d.')
  assert.throws(() => readHistory({ chart: { result: [] } }), /no price history/)
})
