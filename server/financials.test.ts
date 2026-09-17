import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { financialsResult, LINES, readFinancials, timeseriesQuery } from './financials.ts'

// Statements from the fundamentals time series: one line per item in statement order, one column per
// period the statement's lead line has, latest first.

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

test('the query names every line of the statement with the frequency in front, over a day-stable window', () => {
  const query = timeseriesQuery('AAPL', 'income', 'quarterly', Date.UTC(2026, 8, 16, 21, 5))
  const types = String(query.type).split(',')
  assert.equal(types.length, LINES.income.length)
  assert.equal(types[0], 'quarterlyTotalRevenue')
  assert.equal(query.symbol, 'AAPL')
  assert.equal(query.period1, 493590046)
  assert.equal(query.period2, Date.UTC(2026, 8, 17) / 1000)
  assert.equal(timeseriesQuery('AAPL', 'income', 'quarterly', Date.UTC(2026, 8, 16, 1)).period2, Date.UTC(2026, 8, 17) / 1000)
  assert.ok(LINES.cashflow.some((line) => line.key === 'FreeCashFlow' && line.highlight))
})

test('an annual statement reads the lead line’s periods and drops lines with nothing in them', () => {
  const income = readFinancials('AAPL', 'income', 'annual', fixture('ts_income_annual'))
  assert.equal(income.currency, 'USD')
  assert.deepEqual(income.periods, ['2025-09-30', '2024-09-30', '2023-09-30', '2022-09-30'])
  assert.deepEqual(
    income.rows.map((row) => row.key),
    ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'InterestExpense', 'NetIncome', 'DilutedEPS', 'DilutedAverageShares', 'TaxRateForCalcs'],
  )
  assert.deepEqual(income.rows[0], {
    key: 'TotalRevenue',
    label: 'Total revenue',
    kind: 'money',
    highlight: true,
    values: { '2025-09-30': 416161000000, '2024-09-30': 391035000000, '2023-09-30': 383285000000, '2022-09-30': 394328000000 },
  })
  assert.deepEqual(income.rows[3]!.values, { '2025-09-30': null, '2024-09-30': null, '2023-09-30': 3933000000, '2022-09-30': 2931000000 })
  const lines = financialsResult(income).content[0]!.text.split('\n')
  assert.deepEqual(lines, [
    'AAPL income statement, annual, from Yahoo Finance, in USD.',
    'Period ended: 2025-09-30 | 2024-09-30 | 2023-09-30 | 2022-09-30',
    'Total revenue: 416.16B | 391.04B | 383.29B | 394.33B',
    'Gross profit: 195.20B | 180.68B | 169.15B | 170.78B',
    'Operating income: 133.05B | 123.22B | 114.30B | 119.44B',
    'Interest expense: — | — | 3.93B | 2.93B',
    'Net income: 112.01B | 93.74B | 97.00B | 99.80B',
    'Diluted EPS: 7.46 | 6.08 | 6.13 | 6.11',
    'Diluted average shares: 15.00B | 15.41B | 15.81B | 16.33B',
    'Tax rate: 15.60% | 24.10% | 14.70% | 16.20%',
  ])
})

test('quarterly and trailing statements keep their own periods', () => {
  const quarterly = readFinancials('AAPL', 'income', 'quarterly', fixture('ts_income_quarterly'))
  assert.deepEqual(quarterly.periods, ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'])
  const trailing = readFinancials('AAPL', 'income', 'trailing', fixture('ts_income_trailing'))
  assert.deepEqual(trailing.periods, ['2026-06-30', '2025-06-30'])
  assert.deepEqual(trailing.rows.map((row) => row.key), ['TotalRevenue', 'NetIncome', 'DilutedEPS'])
  assert.deepEqual(trailing.rows[2]!.values, { '2026-06-30': 8.72, '2025-06-30': 6.59 })
  assert.equal(financialsResult(trailing).content[0]!.text.split('\n')[0], 'AAPL income statement, trailing twelve months, from Yahoo Finance, in USD.')
})

test('balance sheet and cash flow read in statement order', () => {
  const balance = readFinancials('AAPL', 'balance', 'annual', fixture('ts_balance_annual'))
  assert.deepEqual(balance.rows.map((row) => row.key), ['TotalAssets', 'CashAndCashEquivalents', 'StockholdersEquity', 'TotalDebt'])
  const cash = readFinancials('AAPL', 'cashflow', 'annual', fixture('ts_cash_annual'))
  assert.deepEqual(cash.rows.map((row) => row.key), ['OperatingCashFlow', 'CapitalExpenditure', 'CashDividendsPaid', 'FreeCashFlow'])
  assert.equal(financialsResult(cash).content[0]!.text.split('\n')[3], 'Capital expenditure: -12.72B | -9.45B | -10.96B | -10.71B')
})

test('no data, and a trailing balance sheet, are refusals in words', () => {
  assert.throws(() => readFinancials('NOPE123X', 'income', 'annual', fixture('ts_bad')), {
    message: 'Yahoo Finance has no annual income statement for NOPE123X.',
  })
  assert.throws(() => readFinancials('AAPL', 'balance', 'trailing', fixture('ts_balance_annual')), {
    message: 'A balance sheet has no trailing twelve months: it is a point in time. Ask for annual or quarterly.',
  })
})
