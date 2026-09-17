import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  analystsResult,
  earningsResult,
  fundResult,
  holdersResult,
  profileResult,
  readAnalysts,
  readEarnings,
  readFund,
  readHolders,
  readProfile,
  readStatistics,
  statisticsResult,
} from './company.ts'

// What quoteSummary says about one company or fund: its profile, statistics, earnings, analysts,
// holders, and holdings. Fractions become percent (0.0797 is 7.97) wherever a field says Percent.

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

test('a profile reads the company, its address, governance, and officers', () => {
  const profile = readProfile('AAPL', fixture('profile'))
  const { summary, rows, ...rest } = profile
  assert.deepEqual(rest, {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    type: 'EQUITY',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    employees: 150000,
    website: 'https://www.apple.com',
    investorRelations: 'http://investor.apple.com/',
    phone: '(408) 996-1010',
    address: 'One Apple Park Way, Cupertino, CA 95014, United States',
    governance: { overall: 1, audit: 2, board: 1, compensation: 6, shareholderRights: 1, asOf: '2026-09-01' },
  })
  assert.ok(summary?.startsWith('Apple Inc. designs, manufactures, and markets smartphones'))
  assert.deepEqual(rows[1], { name: 'Mr. Kevan Parekh', title: 'Senior VP & CFO', age: 53, pay: 4034174, payYear: 2025 })
  const lines = profileResult(profile).content[0]!.text.split('\n')
  assert.deepEqual(lines.slice(0, 5), [
    'AAPL Apple Inc. (EQUITY), from Yahoo Finance.',
    'Sector: Technology. Industry: Consumer Electronics. Employees: 150,000.',
    'Headquarters: One Apple Park Way, Cupertino, CA 95014, United States. Phone: (408) 996-1010. Website: https://www.apple.com. Investor relations: http://investor.apple.com/.',
    'ISS governance risk, 1 (low) to 10 (high), as of 2026-09-01: overall 1, audit 2, board 1, compensation 6, shareholder rights 1.',
    'Officers: Mr. Timothy D. Cook, Executive Chairman of the Board, age 64, paid 16.76M in 2025; Mr. Kevan Parekh, Senior VP & CFO, age 53, paid 4.03M in 2025; Mr. Sabih Khan, Senior VP & Chief Operating Officer, age 58, paid 5.02M in 2025.',
  ])
  assert.match(lines[5]!, /^Business summary: Apple Inc\. designs/)
})

test('a fund’s profile has no company fields, and says what it has', () => {
  const profile = readProfile('SPY', fixture('profile_etf'))
  assert.equal(profile.name, 'State Street SPDR S&P 500 ETF Trust')
  assert.equal(profile.type, 'ETF')
  assert.equal(profile.sector, null)
  assert.equal(profile.governance, null)
  assert.deepEqual(profile.rows, [])
  const text = profileResult(profile).content[0]!.text
  assert.equal(text.split('\n')[0], 'SPY State Street SPDR S&P 500 ETF Trust (ETF), from Yahoo Finance.')
  assert.match(text, /^Business summary: The trust seeks/m)
  assert.doesNotMatch(text, /Officers|Sector/)
})

test('statistics read by group, with percent in percent and dates as days', () => {
  const statistics = readStatistics('AAPL', fixture('stats'))
  assert.equal(statistics.name, 'Apple Inc.')
  assert.equal(statistics.currency, 'USD')
  const { stats } = statistics
  assert.equal(stats['marketCap'], 4851251544064)
  assert.equal(stats['trailingPE'], 38.033184)
  assert.equal(stats['profitMargin'], 27.619)
  assert.equal(stats['dividendYield'], 0.33)
  assert.equal(stats['fiveYearAverageDividendYield'], 0.5)
  assert.equal(stats['fiftyTwoWeekChange'], 39.0895)
  assert.equal(stats['exDividendDate'], '2026-08-10')
  assert.equal(stats['lastSplit'], '4:1')
  assert.equal(stats['lastSplitDate'], '2020-08-31')
  assert.equal(stats['fiscalYearEnd'], '2025-09-27')
  assert.deepEqual(statistics.rows[0], { group: 'Valuation', key: 'marketCap', label: 'Market cap', value: 4851251544064, unit: 'currency', display: '4.85T' })
  assert.deepEqual(
    statistics.rows.find((row) => row.key === 'returnOnEquity'),
    { group: 'Profitability', key: 'returnOnEquity', label: 'Return on equity', value: 148.751, unit: 'percent', display: '148.75%' },
  )
  assert.equal(new Set(statistics.rows.map((row) => row.group)).size, 9)
  const lines = statisticsResult(statistics).content[0]!.text.split('\n')
  assert.equal(lines[0], 'AAPL Apple Inc. key statistics from Yahoo Finance, in USD:')
  assert.equal(
    lines[1],
    'Valuation: Market cap 4.85T; Enterprise value 4.87T; Trailing P/E 38.03; Forward P/E 34.69; PEG ratio 2.67; Price/sales (ttm) 10.39; Price/book 45.16; EV/revenue 10.44; EV/EBITDA 29.01.',
  )
  assert.match(lines.join('\n'), /^Dividends: Forward dividend rate 1\.08; Forward dividend yield 0\.33%; .*Ex-dividend date 2026-08-10; Last split 4:1; Last split date 2020-08-31\.$/m)
})

test('earnings read the next report, the last four quarters newest first, and the estimates', () => {
  const earnings = readEarnings('AAPL', fixture('earnings'))
  assert.deepEqual(earnings.next, {
    date: '2026-10-29',
    endDate: null,
    estimated: false,
    epsAverage: 1.98124,
    epsLow: 1.93,
    epsHigh: 2.07,
    revenueAverage: 113624521680,
    revenueLow: 112248100000,
    revenueHigh: 117219700000,
  })
  assert.equal(earnings.lastCall, '2026-07-30')
  assert.equal(earnings.exDividendDate, '2026-08-10')
  assert.equal(earnings.dividendDate, '2026-08-13')
  assert.deepEqual(earnings.rows[0], {
    quarter: '2026-06-30',
    fiscalQuarter: 'Q3 2026',
    reported: '2026-07-30',
    epsEstimate: 1.89243,
    epsActual: 2.02,
    epsDifference: 0.13,
    surprisePercent: 6.74,
  })
  assert.deepEqual(earnings.rows.map((row) => row.quarter), ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'])
  const current = earnings.estimates[0]!
  assert.equal(current.label, 'Current quarter')
  assert.equal(current.endDate, '2026-09-30')
  assert.equal(current.growthPercent, 7.09)
  assert.deepEqual(current.eps, { average: 1.97754, low: 1.93, high: 2.07, yearAgo: 1.85, analysts: 27, growthPercent: 6.89 })
  assert.deepEqual(current.revisions, { upLast7Days: 1, upLast30Days: 7, downLast7Days: 0, downLast30Days: 14 })
  assert.deepEqual(current.epsTrend, { current: 1.97754, days7Ago: 1.97754, days30Ago: 1.97656, days60Ago: 2.01755, days90Ago: 2.00801 })
  assert.deepEqual(earnings.estimates.map((e) => e.label), ['Current quarter', 'Next quarter', 'Current fiscal year', 'Next fiscal year'])
  assert.deepEqual(earnings.annual[0], { year: 2022, revenue: 394328000000, earnings: 99803000000 })
  const text = earningsResult(earnings).content[0]!.text
  const lines = text.split('\n')
  assert.equal(lines[0], 'AAPL Apple Inc. earnings from Yahoo Finance, in USD:')
  assert.equal(lines[1], 'Next report: 2026-10-29 (confirmed). Expected EPS 1.98 (1.93 to 2.07), revenue 113.62B (112.25B to 117.22B).')
  assert.equal(lines[2], 'Last earnings call: 2026-07-30. Ex-dividend date: 2026-08-10. Dividend paid: 2026-08-13.')
  assert.equal(lines[3], 'Last quarters, newest first (EPS estimate, actual, surprise):')
  assert.equal(lines[4], 'Q3 2026, ended 2026-06-30, reported 2026-07-30: estimate 1.89, actual 2.02, surprise +6.74%')
  assert.match(
    text,
    /^Current quarter, ends 2026-09-30: EPS 1\.98 \(1\.93 to 2\.07, 27 analysts, a year ago 1\.85, \+6\.89%\); revenue 113\.62B \(112\.25B to 117\.22B, 27 analysts, a year ago 102\.47B, \+10\.89%\); EPS estimate 90 days ago 2\.01; revisions in 30 days: 7 up, 14 down\.$/m,
  )
  assert.match(text, /^Annual revenue and earnings: 2022 394\.33B and 99\.80B; 2023 /m)
})

test('analysts read targets, consensus, the monthly mix, and rating changes in words', () => {
  const analysts = readAnalysts('AAPL', fixture('analysts'), 4)
  assert.deepEqual(analysts.target, { low: 215, mean: 327.1964, median: 335, high: 405, analysts: 39 })
  assert.deepEqual(analysts.recommendation, { key: 'buy', mean: 2.20455 })
  assert.equal(analysts.price, 332.41)
  assert.deepEqual(analysts.trend[1], { period: '-1m', label: '1 month ago', strongBuy: 6, buy: 19, hold: 14, sell: 3, strongSell: 2 })
  assert.equal(analysts.rows.length, 4)
  assert.deepEqual(analysts.rows[2], {
    date: '2026-09-10',
    firm: 'B of A Securities',
    action: 'maintain',
    from: 'Buy',
    to: 'Buy',
    targetAction: 'Lowers',
    target: 370,
    priorTarget: 380,
  })
  const needham = readAnalysts('AAPL', fixture('analysts'), 10).rows[4]!
  assert.equal(needham.target, null)
  assert.equal(needham.targetAction, null)
  const lines = analystsResult(readAnalysts('AAPL', fixture('analysts'), 10)).content[0]!.text.split('\n')
  assert.deepEqual(lines.slice(0, 5), [
    'AAPL Apple Inc. analyst ratings from Yahoo Finance:',
    'Price 332.41 USD. Price targets from 39 analysts: low 215.00, mean 327.20, median 335.00, high 405.00; the mean is -1.57% from the price.',
    'Consensus: buy, mean 2.20 on a scale from 1 (strong buy) to 5 (strong sell).',
    'Ratings by month (strong buy, buy, hold, sell, strong sell): this month 6, 19, 13, 3, 3; 1 month ago 6, 19, 14, 3, 2; 2 months ago 6, 22, 14, 2, 2; 3 months ago 6, 22, 16, 1, 2.',
    'Rating changes, newest first:',
  ])
  assert.deepEqual(lines.slice(5), [
    '2026-09-10 TD Cowen reiterates Buy, target 400.00 (maintains)',
    '2026-09-10 Rosenblatt maintains Neutral, target 303.00 (maintains)',
    '2026-09-10 B of A Securities maintains Buy, target 370.00 from 380.00 (lowers)',
    '2026-09-08 HSBC reiterates Buy, target 366.00 (maintains)',
    '2026-09-08 Needham reiterates Hold',
    '2026-09-02 Morgan Stanley reiterates Overweight, target 360.00 (maintains)',
  ])
})

test('holders read the breakdown, institutions, funds, insiders, and their trades', () => {
  const holders = readHolders('AAPL', fixture('holders'), 10)
  assert.deepEqual(holders.breakdown, { insidersPercent: 1.648, institutionsPercent: 66.34, institutionsFloatPercent: 67.452, institutions: 7759 })
  assert.deepEqual(holders.rows[0], { holder: 'Blackrock Inc.', shares: 1162996939, percent: 7.97, value: 386591816752, reported: '2026-06-30', changePercent: 1.6 })
  assert.equal(holders.funds.length, 2)
  assert.deepEqual(holders.insiders[1], { name: 'COOK TIMOTHY D', relation: 'Chief Executive Officer', lastTransaction: 'Sale', date: '2026-04-02', shares: 3280420, indirectShares: null })
  assert.deepEqual(holders.transactions[0], {
    date: '2026-09-08',
    insider: 'NEWSTEAD JENNIFER',
    relation: 'General Counsel',
    description: 'Sale at price 317.23 per share.',
    shares: 1438,
    value: 456177,
    ownership: 'direct',
  })
  assert.deepEqual(holders.netPurchases, {
    period: '6m',
    buys: 10,
    buyShares: 433407,
    sells: 12,
    sellShares: 405069,
    netShares: 28338,
    insiderShares: 240512096,
    institutionalNetShares: -1371978271,
  })
  assert.equal(readHolders('AAPL', fixture('holders'), 2).transactions.length, 2)
  const lines = holdersResult(holders).content[0]!.text.split('\n')
  assert.equal(lines[0], 'AAPL Apple Inc. holders from Yahoo Finance:')
  assert.equal(lines[1], 'Insiders hold 1.65% and institutions 66.34% (67.45% of the float), across 7,759 institutions.')
  assert.equal(lines[2], 'Top institutions (shares, % held, value, as of, change):')
  assert.equal(lines[3], 'Blackrock Inc.: 1.16B, 7.97%, 386.59B, 2026-06-30, +1.60%')
  assert.ok(lines.includes('COOK TIMOTHY D, Chief Executive Officer: Sale on 2026-04-02; holds 3.28M shares directly'))
  assert.ok(lines.includes('2026-09-08 NEWSTEAD JENNIFER, General Counsel: Sale at price 317.23 per share. 1.44K shares, 456.18K, direct'))
  assert.equal(lines.at(-1), 'Insider trades over 6m: 10 buys (433.41K shares), 12 sales (405.07K shares), net 28.34K shares; insiders hold 240.51M shares. Institutions were net sellers of 1.37B shares.')
})

test('a fund reads its profile, returns, mix, sectors, and top holdings; a stock is not a fund', () => {
  const fund = readFund('SPY', fixture('fund'))
  const { rows, sectors, ...rest } = fund
  assert.deepEqual(rest, {
    symbol: 'SPY',
    name: 'State Street SPDR S&P 500 ETF Trust',
    type: 'ETF',
    currency: 'USD',
    family: 'State Street Investment Management',
    category: 'Large Blend',
    legalType: 'Exchange Traded Fund',
    inception: '1993-01-22',
    totalAssets: 811937038336,
    expenseRatioPercent: 0.0945,
    turnoverPercent: 3,
    yieldPercent: 0.98,
    nav: 760.69275,
    pe: 24.36312,
    beta3Year: 1,
    ytdReturnPercent: 12.1734,
    threeYearReturnPercent: 20.5923,
    fiveYearReturnPercent: 12.8867,
    assets: { stock: 99.88, bond: 0, cash: 0.11, preferred: 0, convertible: 0, other: 0 },
  })
  assert.deepEqual(sectors.slice(0, 2), [
    { sector: 'Technology', percent: 38.69 },
    { sector: 'Financial services', percent: 12.06 },
  ])
  assert.deepEqual(rows[0], { symbol: 'NVDA', name: 'NVIDIA Corp', percent: 8.0787 })
  const lines = fundResult(fund).content[0]!.text.split('\n')
  assert.deepEqual(lines, [
    'SPY State Street SPDR S&P 500 ETF Trust (ETF) from Yahoo Finance.',
    'Family: State Street Investment Management. Category: Large Blend. Legal type: Exchange Traded Fund. Inception: 1993-01-22.',
    'Net assets 811.94B USD. Expense ratio 0.0945%. Turnover 3.00%. Yield 0.98%. NAV 760.69. P/E 24.36. Beta (3 years) 1.00.',
    'Returns: year to date +12.17%, 3-year average +20.59%, 5-year average +12.89%.',
    'Asset mix: stocks 99.88%, cash 0.11%.',
    'Sectors: Technology 38.69%, Financial services 12.06%, Communication services 9.50%, Consumer cyclical 9.31%, Healthcare 9.28%, Industrials 7.75%, Consumer defensive 4.46%, Energy 3.48%, Utilities 1.98%, Real estate 1.80%, Basic materials 1.68%.',
    'Top holdings: NVDA NVIDIA Corp 8.08%, AAPL Apple Inc 7.03%, MSFT Microsoft Corp 5.69%, AMZN Amazon.com Inc 3.84%.',
  ])
  assert.throws(() => readFund('AAPL', fixture('fund_stock')), { message: 'AAPL is not a fund (EQUITY): fund holdings are for ETFs and mutual funds.' })
})
