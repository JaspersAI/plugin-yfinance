import { plain as f, smallPercent } from '../format.ts'
import { list, num, percentOf, record, records, text, type Row } from '../values.ts'
import { capped, parts, toolResult, type ToolResult } from './result.ts'
import { YahooError } from './yahoo.ts'

// What quoteSummary says about one listing, one tool per group of its modules. quoteSummary writes
// ratios as fractions; a field here whose name ends in Percent is in percent (7.97 is 7.97%).

export const MODULES = {
  profile: 'assetProfile,summaryProfile,quoteType,price',
  statistics: 'summaryDetail,defaultKeyStatistics,financialData,price',
  earnings: 'earningsHistory,earningsTrend,calendarEvents,earnings,price',
  analysts: 'financialData,recommendationTrend,upgradeDowngradeHistory,price',
  holders: 'majorHoldersBreakdown,institutionOwnership,fundOwnership,insiderHolders,insiderTransactions,netSharePurchaseActivity,price',
  fund: 'topHoldings,fundProfile,defaultKeyStatistics,summaryDetail,quoteType,price',
} as const

/** The first result, with each module by name. */
export function summaryOf(json: unknown): Row {
  const result = records(record(record(json)?.['quoteSummary'])?.['result'])[0]
  if (!result) throw new YahooError('Yahoo Finance answered with no summary.')
  return result
}

function mod(result: Row, name: string): Row {
  return record(result[name]) ?? {}
}

function nameOf(result: Row): string | null {
  const price = mod(result, 'price')
  const type = mod(result, 'quoteType')
  return text(price['longName']) ?? text(price['shortName']) ?? text(type['longName']) ?? text(type['shortName'])
}

function typeOf(result: Row): string | null {
  return text(mod(result, 'quoteType')['quoteType']) ?? text(mod(result, 'price')['quoteType'])
}

function currencyOf(result: Row): string | null {
  return (
    text(mod(result, 'price')['currency']) ??
    text(mod(result, 'summaryDetail')['currency']) ??
    text(mod(result, 'financialData')['financialCurrency']) ??
    text(mod(result, 'earnings')['financialCurrency'])
  )
}

function day(value: unknown): string | null {
  const seconds = num(value)
  return seconds === null ? null : f.day(seconds)
}

function spaced(value: unknown): string | null {
  return text(value)?.replace(/\s+/g, ' ') ?? null
}

function title(symbol: string, name: string | null): string {
  return `${symbol}${name ? ` ${name}` : ''}`
}

// Profile.

export type Officer = {
  name: string
  title: string | null
  age: number | null
  pay: number | null
  payYear: number | null
}

export type Profile = {
  symbol: string
  name: string | null
  type: string | null
  sector: string | null
  industry: string | null
  employees: number | null
  website: string | null
  investorRelations: string | null
  phone: string | null
  address: string | null
  /** ISS governance risk, 1 (low) to 10 (high). */
  governance: { overall: number | null; audit: number | null; board: number | null; compensation: number | null; shareholderRights: number | null; asOf: string | null } | null
  summary: string | null
  rows: Officer[]
}

export function readProfile(symbol: string, json: unknown): Profile {
  const result = summaryOf(json)
  const profile = { ...mod(result, 'summaryProfile'), ...mod(result, 'assetProfile') }
  const place = parts(
    text(profile['address1']),
    text(profile['address2']),
    text(profile['city']),
    [text(profile['state']), text(profile['zip'])].filter(Boolean).join(' '),
    text(profile['country']),
  )
  const risks = ['overallRisk', 'auditRisk', 'boardRisk', 'compensationRisk', 'shareHolderRightsRisk'].map((key) => num(profile[key]))
  return {
    symbol,
    name: nameOf(result),
    type: typeOf(result),
    sector: text(profile['sectorDisp']) ?? text(profile['sector']),
    industry: text(profile['industryDisp']) ?? text(profile['industry']),
    employees: num(profile['fullTimeEmployees']),
    website: text(profile['website']),
    investorRelations: text(profile['irWebsite']),
    phone: text(profile['phone']),
    address: place || null,
    governance: risks.some((risk) => risk !== null)
      ? {
          overall: risks[0]!,
          audit: risks[1]!,
          board: risks[2]!,
          compensation: risks[3]!,
          shareholderRights: risks[4]!,
          asOf: day(profile['governanceEpochDate']),
        }
      : null,
    summary: text(profile['longBusinessSummary']),
    rows: records(profile['companyOfficers'])
      .map((officer) => ({
        name: spaced(officer['name']) ?? '',
        title: spaced(officer['title']),
        age: num(officer['age']),
        pay: num(officer['totalPay']),
        payYear: num(officer['fiscalYear']),
      }))
      .filter((officer) => officer.name !== ''),
  }
}

export function profileResult(profile: Profile): ToolResult {
  const g = profile.governance
  const lines = [
    `${title(profile.symbol, profile.name)}${profile.type ? ` (${profile.type})` : ''}, from Yahoo Finance.`,
    [
      profile.sector && `Sector: ${profile.sector}.`,
      profile.industry && `Industry: ${profile.industry}.`,
      profile.employees !== null && `Employees: ${f.fixed(profile.employees, 0)}.`,
    ]
      .filter(Boolean)
      .join(' '),
    [
      profile.address && `Headquarters: ${profile.address}.`,
      profile.phone && `Phone: ${profile.phone}.`,
      profile.website && `Website: ${profile.website}.`,
      profile.investorRelations && `Investor relations: ${profile.investorRelations}.`,
    ]
      .filter(Boolean)
      .join(' '),
    g
      ? `ISS governance risk, 1 (low) to 10 (high)${g.asOf ? `, as of ${g.asOf}` : ''}: ${parts(
          g.overall !== null && `overall ${g.overall}`,
          g.audit !== null && `audit ${g.audit}`,
          g.board !== null && `board ${g.board}`,
          g.compensation !== null && `compensation ${g.compensation}`,
          g.shareholderRights !== null && `shareholder rights ${g.shareholderRights}`,
        )}.`
      : '',
    profile.rows.length
      ? `Officers: ${profile.rows
          .map((o) => parts(o.name, o.title, o.age !== null && `age ${o.age}`, o.pay !== null && `paid ${f.big(o.pay)}${o.payYear !== null ? ` in ${o.payYear}` : ''}`))
          .join('; ')}.`
      : '',
    profile.summary ? `Business summary: ${profile.summary}` : '',
  ]
  return toolResult(lines.filter(Boolean).join('\n'), profile)
}

// Statistics.

type Kind = 'money' | 'big' | 'count' | 'ratio' | 'percent' | 'percentUnits' | 'date' | 'text'

export type Stat = {
  group: string
  key: string
  label: string
  value: number | string
  unit: 'currency' | 'number' | 'percent' | 'date' | 'text'
  display: string
}

export type Statistics = {
  symbol: string
  name: string | null
  currency: string | null
  /** Every figure there is, by key, as in the rows. */
  stats: Record<string, number | string>
  rows: Stat[]
}

/** Group, key, label, module, Yahoo's field, and what kind of figure it is. */
const STATS: [string, string, string, string, string, Kind][] = [
  ['Valuation', 'marketCap', 'Market cap', 'summaryDetail', 'marketCap', 'big'],
  ['Valuation', 'enterpriseValue', 'Enterprise value', 'defaultKeyStatistics', 'enterpriseValue', 'big'],
  ['Valuation', 'trailingPE', 'Trailing P/E', 'summaryDetail', 'trailingPE', 'ratio'],
  ['Valuation', 'forwardPE', 'Forward P/E', 'summaryDetail', 'forwardPE', 'ratio'],
  ['Valuation', 'pegRatio', 'PEG ratio', 'defaultKeyStatistics', 'pegRatio', 'ratio'],
  ['Valuation', 'priceToSales', 'Price/sales (ttm)', 'summaryDetail', 'priceToSalesTrailing12Months', 'ratio'],
  ['Valuation', 'priceToBook', 'Price/book', 'defaultKeyStatistics', 'priceToBook', 'ratio'],
  ['Valuation', 'enterpriseToRevenue', 'EV/revenue', 'defaultKeyStatistics', 'enterpriseToRevenue', 'ratio'],
  ['Valuation', 'enterpriseToEbitda', 'EV/EBITDA', 'defaultKeyStatistics', 'enterpriseToEbitda', 'ratio'],
  ['Profitability', 'profitMargin', 'Profit margin', 'financialData', 'profitMargins', 'percent'],
  ['Profitability', 'operatingMargin', 'Operating margin', 'financialData', 'operatingMargins', 'percent'],
  ['Profitability', 'grossMargin', 'Gross margin', 'financialData', 'grossMargins', 'percent'],
  ['Profitability', 'ebitdaMargin', 'EBITDA margin', 'financialData', 'ebitdaMargins', 'percent'],
  ['Profitability', 'returnOnAssets', 'Return on assets', 'financialData', 'returnOnAssets', 'percent'],
  ['Profitability', 'returnOnEquity', 'Return on equity', 'financialData', 'returnOnEquity', 'percent'],
  ['Income', 'revenue', 'Revenue (ttm)', 'financialData', 'totalRevenue', 'big'],
  ['Income', 'revenuePerShare', 'Revenue per share', 'financialData', 'revenuePerShare', 'money'],
  ['Income', 'revenueGrowth', 'Revenue growth (quarter, year over year)', 'financialData', 'revenueGrowth', 'percent'],
  ['Income', 'grossProfit', 'Gross profit', 'financialData', 'grossProfits', 'big'],
  ['Income', 'ebitda', 'EBITDA', 'financialData', 'ebitda', 'big'],
  ['Income', 'netIncome', 'Net income to common (ttm)', 'defaultKeyStatistics', 'netIncomeToCommon', 'big'],
  ['Income', 'trailingEps', 'EPS (ttm)', 'defaultKeyStatistics', 'trailingEps', 'money'],
  ['Income', 'forwardEps', 'Forward EPS', 'defaultKeyStatistics', 'forwardEps', 'money'],
  ['Income', 'earningsGrowth', 'Earnings growth (quarter, year over year)', 'financialData', 'earningsGrowth', 'percent'],
  ['Balance sheet', 'totalCash', 'Total cash', 'financialData', 'totalCash', 'big'],
  ['Balance sheet', 'cashPerShare', 'Cash per share', 'financialData', 'totalCashPerShare', 'money'],
  ['Balance sheet', 'totalDebt', 'Total debt', 'financialData', 'totalDebt', 'big'],
  ['Balance sheet', 'debtToEquity', 'Debt/equity (%)', 'financialData', 'debtToEquity', 'ratio'],
  ['Balance sheet', 'currentRatio', 'Current ratio', 'financialData', 'currentRatio', 'ratio'],
  ['Balance sheet', 'quickRatio', 'Quick ratio', 'financialData', 'quickRatio', 'ratio'],
  ['Balance sheet', 'bookValue', 'Book value per share', 'defaultKeyStatistics', 'bookValue', 'money'],
  ['Cash flow', 'operatingCashflow', 'Operating cash flow (ttm)', 'financialData', 'operatingCashflow', 'big'],
  ['Cash flow', 'freeCashflow', 'Levered free cash flow (ttm)', 'financialData', 'freeCashflow', 'big'],
  ['Trading', 'price', 'Price', 'financialData', 'currentPrice', 'money'],
  ['Trading', 'beta', 'Beta (5 years, monthly)', 'summaryDetail', 'beta', 'ratio'],
  ['Trading', 'fiftyTwoWeekChange', '52-week change', 'defaultKeyStatistics', '52WeekChange', 'percent'],
  ['Trading', 'sp500FiftyTwoWeekChange', 'S&P 500 52-week change', 'defaultKeyStatistics', 'SandP52WeekChange', 'percent'],
  ['Trading', 'fiftyTwoWeekHigh', '52-week high', 'summaryDetail', 'fiftyTwoWeekHigh', 'money'],
  ['Trading', 'fiftyTwoWeekLow', '52-week low', 'summaryDetail', 'fiftyTwoWeekLow', 'money'],
  ['Trading', 'fiftyDayAverage', '50-day average', 'summaryDetail', 'fiftyDayAverage', 'money'],
  ['Trading', 'twoHundredDayAverage', '200-day average', 'summaryDetail', 'twoHundredDayAverage', 'money'],
  ['Trading', 'allTimeHigh', 'All-time high', 'summaryDetail', 'allTimeHigh', 'money'],
  ['Trading', 'volume', 'Volume', 'summaryDetail', 'volume', 'count'],
  ['Trading', 'averageVolume', 'Average volume (3 months)', 'summaryDetail', 'averageVolume', 'count'],
  ['Trading', 'averageVolume10Day', 'Average volume (10 days)', 'summaryDetail', 'averageVolume10days', 'count'],
  ['Shares', 'sharesOutstanding', 'Shares outstanding', 'defaultKeyStatistics', 'sharesOutstanding', 'count'],
  ['Shares', 'floatShares', 'Float', 'defaultKeyStatistics', 'floatShares', 'count'],
  ['Shares', 'heldByInsiders', 'Held by insiders', 'defaultKeyStatistics', 'heldPercentInsiders', 'percent'],
  ['Shares', 'heldByInstitutions', 'Held by institutions', 'defaultKeyStatistics', 'heldPercentInstitutions', 'percent'],
  ['Shares', 'sharesShort', 'Shares short', 'defaultKeyStatistics', 'sharesShort', 'count'],
  ['Shares', 'shortRatio', 'Short ratio (days to cover)', 'defaultKeyStatistics', 'shortRatio', 'ratio'],
  ['Shares', 'shortPercentOfFloat', 'Short interest, % of float', 'defaultKeyStatistics', 'shortPercentOfFloat', 'percent'],
  ['Shares', 'shortInterestDate', 'Short interest as of', 'defaultKeyStatistics', 'dateShortInterest', 'date'],
  ['Dividends', 'dividendRate', 'Forward dividend rate', 'summaryDetail', 'dividendRate', 'money'],
  ['Dividends', 'dividendYield', 'Forward dividend yield', 'summaryDetail', 'dividendYield', 'percent'],
  ['Dividends', 'trailingDividendRate', 'Trailing dividend rate', 'summaryDetail', 'trailingAnnualDividendRate', 'money'],
  ['Dividends', 'trailingDividendYield', 'Trailing dividend yield', 'summaryDetail', 'trailingAnnualDividendYield', 'percent'],
  ['Dividends', 'fiveYearAverageDividendYield', '5-year average dividend yield', 'summaryDetail', 'fiveYearAvgDividendYield', 'percentUnits'],
  ['Dividends', 'payoutRatio', 'Payout ratio', 'summaryDetail', 'payoutRatio', 'percent'],
  ['Dividends', 'exDividendDate', 'Ex-dividend date', 'summaryDetail', 'exDividendDate', 'date'],
  ['Dividends', 'lastSplit', 'Last split', 'defaultKeyStatistics', 'lastSplitFactor', 'text'],
  ['Dividends', 'lastSplitDate', 'Last split date', 'defaultKeyStatistics', 'lastSplitDate', 'date'],
  ['Fiscal year', 'fiscalYearEnd', 'Last fiscal year ended', 'defaultKeyStatistics', 'lastFiscalYearEnd', 'date'],
  ['Fiscal year', 'mostRecentQuarter', 'Most recent quarter', 'defaultKeyStatistics', 'mostRecentQuarter', 'date'],
]

function stat(kind: Kind, raw: unknown): { value: number | string; unit: Stat['unit']; display: string } | null {
  if (kind === 'text') {
    const value = text(raw)
    return value === null ? null : { value, unit: 'text', display: value }
  }
  if (kind === 'date') {
    const value = day(raw)
    return value === null ? null : { value, unit: 'date', display: value }
  }
  const n = num(raw)
  if (n === null) return null
  switch (kind) {
    case 'money':
      return { value: n, unit: 'currency', display: f.fixed(n) }
    case 'big':
      return { value: n, unit: 'currency', display: f.big(n) }
    case 'count':
      return { value: n, unit: 'number', display: f.big(n) }
    case 'ratio':
      return { value: n, unit: 'number', display: f.fixed(n) }
    case 'percent': {
      const value = percentOf(n)!
      return { value, unit: 'percent', display: f.percent(value) }
    }
    case 'percentUnits':
      return { value: n, unit: 'percent', display: f.percent(n) }
  }
}

export function readStatistics(symbol: string, json: unknown): Statistics {
  const result = summaryOf(json)
  const rows: Stat[] = []
  for (const [group, key, label, module, field, kind] of STATS) {
    const read = stat(kind, mod(result, module)[field])
    // Yahoo writes a margin it has no figure for (a bank's gross margin) as exactly 0.
    if (!read || (group === 'Profitability' && read.value === 0)) continue
    rows.push({ group, key, label, ...read })
  }
  return {
    symbol,
    name: nameOf(result),
    currency: currencyOf(result),
    stats: Object.fromEntries(rows.map((row) => [row.key, row.value])),
    rows,
  }
}

export function statisticsResult(statistics: Statistics): ToolResult {
  const groups = new Map<string, Stat[]>()
  for (const row of statistics.rows) groups.set(row.group, [...(groups.get(row.group) ?? []), row])
  const head = `${title(statistics.symbol, statistics.name)} key statistics from Yahoo Finance${statistics.currency ? `, in ${statistics.currency}` : ''}:`
  if (!groups.size) return toolResult(`Yahoo Finance has no key statistics for ${statistics.symbol}.`, statistics)
  const lines = [...groups].map(([group, rows]) => `${group}: ${rows.map((row) => `${row.label} ${row.display}`).join('; ')}.`)
  return toolResult([head, ...lines].join('\n'), statistics)
}

// Earnings.

export type EarningsQuarter = {
  /** When the quarter ended. */
  quarter: string
  /** The company's fiscal quarter: "Q3 2026". */
  fiscalQuarter: string | null
  reported: string | null
  epsEstimate: number | null
  epsActual: number | null
  epsDifference: number | null
  surprisePercent: number | null
}

export type Estimate = {
  /** Yahoo's period: 0q, +1q, 0y, +1y. */
  period: string
  label: string
  endDate: string | null
  growthPercent: number | null
  eps: { average: number | null; low: number | null; high: number | null; yearAgo: number | null; analysts: number | null; growthPercent: number | null }
  revenue: { average: number | null; low: number | null; high: number | null; yearAgo: number | null; analysts: number | null; growthPercent: number | null }
  epsTrend: { current: number | null; days7Ago: number | null; days30Ago: number | null; days60Ago: number | null; days90Ago: number | null }
  revisions: { upLast7Days: number | null; upLast30Days: number | null; downLast7Days: number | null; downLast30Days: number | null }
}

export type Earnings = {
  symbol: string
  name: string | null
  currency: string | null
  next: {
    date: string | null
    /** The last day of the window when Yahoo gives one. */
    endDate: string | null
    /** Whether the date is Yahoo's estimate rather than the company's. */
    estimated: boolean
    epsAverage: number | null
    epsLow: number | null
    epsHigh: number | null
    revenueAverage: number | null
    revenueLow: number | null
    revenueHigh: number | null
  } | null
  lastCall: string | null
  exDividendDate: string | null
  dividendDate: string | null
  estimates: Estimate[]
  annual: { year: number; revenue: number | null; earnings: number | null }[]
  /** The last reported quarters, newest first. */
  rows: EarningsQuarter[]
}

const PERIODS: Record<string, string> = {
  '0q': 'Current quarter',
  '+1q': 'Next quarter',
  '0y': 'Current fiscal year',
  '+1y': 'Next fiscal year',
  '+5y': 'Next five years (per year)',
  '-5y': 'Past five years (per year)',
}

function fiscal(label: string | null): string | null {
  const match = label?.match(/^([1-4])Q(\d{4})$/)
  return match ? `Q${match[1]} ${match[2]}` : label
}

export function readEarnings(symbol: string, json: unknown): Earnings {
  const result = summaryOf(json)
  const calendar = mod(result, 'calendarEvents')
  const coming = record(calendar['earnings']) ?? {}
  const dates = list(coming['earningsDate'])
  const chart = record(mod(result, 'earnings')['earningsChart']) ?? {}
  const labels = new Map<string, { fiscalQuarter: string | null; reported: string | null }>()
  for (const q of records(chart['quarterly'])) {
    const end = day(q['periodEndDate'])
    if (end) labels.set(end, { fiscalQuarter: fiscal(text(q['fiscalQuarter'])), reported: day(q['reportedDate']) })
  }
  const rows = records(mod(result, 'earningsHistory')['history'])
    .map((h) => {
      const quarter = day(h['quarter'])
      if (!quarter) return null
      const label = labels.get(quarter)
      return {
        quarter,
        fiscalQuarter: label?.fiscalQuarter ?? null,
        reported: label?.reported ?? null,
        epsEstimate: num(h['epsEstimate']),
        epsActual: num(h['epsActual']),
        epsDifference: num(h['epsDifference']),
        surprisePercent: percentOf(num(h['surprisePercent'])),
      }
    })
    .filter((row): row is EarningsQuarter => row !== null)
    .sort((a, b) => b.quarter.localeCompare(a.quarter))
  const estimates = records(mod(result, 'earningsTrend')['trend']).map((t): Estimate => {
    const eps = record(t['earningsEstimate']) ?? {}
    const revenue = record(t['revenueEstimate']) ?? {}
    const trend = record(t['epsTrend']) ?? {}
    const revisions = record(t['epsRevisions']) ?? {}
    const period = text(t['period']) ?? ''
    return {
      period,
      label: PERIODS[period] ?? period,
      endDate: text(t['endDate']),
      growthPercent: percentOf(num(t['growth'])),
      eps: {
        average: num(eps['avg']),
        low: num(eps['low']),
        high: num(eps['high']),
        yearAgo: num(eps['yearAgoEps']),
        analysts: num(eps['numberOfAnalysts']),
        growthPercent: percentOf(num(eps['growth'])),
      },
      revenue: {
        average: num(revenue['avg']),
        low: num(revenue['low']),
        high: num(revenue['high']),
        yearAgo: num(revenue['yearAgoRevenue']),
        analysts: num(revenue['numberOfAnalysts']),
        growthPercent: percentOf(num(revenue['growth'])),
      },
      epsTrend: {
        current: num(trend['current']),
        days7Ago: num(trend['7daysAgo']),
        days30Ago: num(trend['30daysAgo']),
        days60Ago: num(trend['60daysAgo']),
        days90Ago: num(trend['90daysAgo']),
      },
      revisions: {
        upLast7Days: num(revisions['upLast7days']),
        upLast30Days: num(revisions['upLast30days']),
        downLast7Days: num(revisions['downLast7Days'] ?? revisions['downLast7days']),
        downLast30Days: num(revisions['downLast30days']),
      },
    }
  })
  const annual = records(record(mod(result, 'earnings')['financialsChart'])?.['yearly'])
    .map((y) => ({ year: num(y['date']), revenue: num(y['revenue']), earnings: num(y['earnings']) }))
    .filter((y): y is { year: number; revenue: number | null; earnings: number | null } => y.year !== null)
  const date = day(dates[0])
  return {
    symbol,
    name: nameOf(result),
    currency: currencyOf(result),
    next: date
      ? {
          date,
          endDate: dates.length > 1 ? day(dates.at(-1)) : null,
          estimated: coming['isEarningsDateEstimate'] === true,
          epsAverage: num(coming['earningsAverage']),
          epsLow: num(coming['earningsLow']),
          epsHigh: num(coming['earningsHigh']),
          revenueAverage: num(coming['revenueAverage']),
          revenueLow: num(coming['revenueLow']),
          revenueHigh: num(coming['revenueHigh']),
        }
      : null,
    lastCall: day(list(coming['earningsCallDate']).at(-1)),
    exDividendDate: day(calendar['exDividendDate']),
    dividendDate: day(calendar['dividendDate']),
    estimates,
    annual,
    rows,
  }
}

function spread(average: number | null, low: number | null, high: number | null, show: (n: number | null) => string): string | null {
  if (average === null) return null
  return low !== null && high !== null ? `${show(average)} (${show(low)} to ${show(high)})` : show(average)
}

export function earningsResult(earnings: Earnings): ToolResult {
  const { next } = earnings
  const money = (n: number | null): string => f.fixed(n)
  const lines = [`${title(earnings.symbol, earnings.name)} earnings from Yahoo Finance${earnings.currency ? `, in ${earnings.currency}` : ''}:`]
  if (next) {
    const when = next.endDate ? `${next.date} to ${next.endDate}` : next.date
    const expected = parts(
      spread(next.epsAverage, next.epsLow, next.epsHigh, money) && `EPS ${spread(next.epsAverage, next.epsLow, next.epsHigh, money)}`,
      spread(next.revenueAverage, next.revenueLow, next.revenueHigh, f.big) && `revenue ${spread(next.revenueAverage, next.revenueLow, next.revenueHigh, f.big)}`,
    )
    lines.push(`Next report: ${when} (${next.estimated ? 'estimated' : 'confirmed'}).${expected ? ` Expected ${expected}.` : ''}`)
  } else {
    lines.push('Next report: not announced.')
  }
  const dates = [
    earnings.lastCall && `Last earnings call: ${earnings.lastCall}.`,
    earnings.exDividendDate && `Ex-dividend date: ${earnings.exDividendDate}.`,
    earnings.dividendDate && `Dividend paid: ${earnings.dividendDate}.`,
  ].filter(Boolean)
  if (dates.length) lines.push(dates.join(' '))
  if (earnings.rows.length) {
    lines.push('Last quarters, newest first (EPS estimate, actual, surprise):')
    for (const q of earnings.rows) {
      const name = parts(q.fiscalQuarter ?? `Quarter ended ${q.quarter}`, q.fiscalQuarter && `ended ${q.quarter}`, q.reported && `reported ${q.reported}`)
      lines.push(`${name}: estimate ${money(q.epsEstimate)}, actual ${money(q.epsActual)}, surprise ${f.signedPercent(q.surprisePercent)}`)
    }
  }
  if (earnings.estimates.length) {
    lines.push('Analyst estimates:')
    for (const e of earnings.estimates) {
      const detail = (x: Estimate['eps'], show: (n: number | null) => string): string =>
        parts(
          x.low !== null && x.high !== null && `${show(x.low)} to ${show(x.high)}`,
          x.analysts !== null && `${x.analysts} analysts`,
          x.yearAgo !== null && `a year ago ${show(x.yearAgo)}`,
          x.growthPercent !== null && f.signedPercent(x.growthPercent),
        )
      const eps = e.eps.average !== null ? `EPS ${money(e.eps.average)}${detail(e.eps, money) ? ` (${detail(e.eps, money)})` : ''}` : null
      const revenue = e.revenue.average !== null ? `revenue ${f.big(e.revenue.average)}${detail(e.revenue, f.big) ? ` (${detail(e.revenue, f.big)})` : ''}` : null
      const trend = e.epsTrend.days90Ago !== null ? `EPS estimate 90 days ago ${money(e.epsTrend.days90Ago)}` : null
      const revisions =
        e.revisions.upLast30Days !== null || e.revisions.downLast30Days !== null
          ? `revisions in 30 days: ${e.revisions.upLast30Days ?? 0} up, ${e.revisions.downLast30Days ?? 0} down`
          : null
      const body = [eps, revenue, trend, revisions].filter(Boolean).join('; ')
      const growth = !eps && e.growthPercent !== null ? `growth ${f.signedPercent(e.growthPercent)}` : ''
      lines.push(`${e.label}${e.endDate ? `, ends ${e.endDate}` : ''}: ${body || growth}.`)
    }
  }
  if (earnings.annual.length) {
    lines.push(`Annual revenue and earnings: ${earnings.annual.map((y) => `${y.year} ${f.big(y.revenue)} and ${f.big(y.earnings)}`).join('; ')}.`)
  }
  return toolResult(lines.join('\n'), earnings)
}

// Analysts.

export type Rating = {
  date: string | null
  firm: string
  /** upgrade, downgrade, maintain, initiate, reiterate, or Yahoo's own word. */
  action: string | null
  from: string | null
  to: string | null
  targetAction: string | null
  target: number | null
  priorTarget: number | null
}

export type Analysts = {
  symbol: string
  name: string | null
  currency: string | null
  price: number | null
  target: { low: number | null; mean: number | null; median: number | null; high: number | null; analysts: number | null }
  /** Yahoo's consensus: key (strong_buy … sell) and mean, 1 (strong buy) to 5 (strong sell). */
  recommendation: { key: string | null; mean: number | null }
  trend: { period: string; label: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[]
  /** Rating changes, newest first. */
  rows: Rating[]
}

const ACTIONS: Record<string, string> = { up: 'upgrade', down: 'downgrade', main: 'maintain', init: 'initiate', reit: 'reiterate' }

function monthLabel(period: string): string {
  const back = Number(period.match(/^-?(\d+)m$/)?.[1] ?? NaN)
  if (back === 0) return 'this month'
  if (back === 1) return '1 month ago'
  return Number.isFinite(back) ? `${back} months ago` : period
}

export function readAnalysts(symbol: string, json: unknown, limit: number): Analysts {
  const result = summaryOf(json)
  const data = mod(result, 'financialData')
  const positive = (value: unknown): number | null => {
    const n = num(value)
    return n !== null && n > 0 ? n : null
  }
  const rows = records(mod(result, 'upgradeDowngradeHistory')['history'])
    .map((h) => {
      const action = text(h['action'])
      return {
        at: num(h['epochGradeDate']) ?? 0,
        rating: {
          date: day(h['epochGradeDate']),
          firm: text(h['firm']) ?? '',
          action: action ? (ACTIONS[action] ?? action) : null,
          from: text(h['fromGrade']),
          to: text(h['toGrade']),
          targetAction: text(h['priceTargetAction']),
          target: positive(h['currentPriceTarget']),
          priorTarget: positive(h['priorPriceTarget']),
        },
      }
    })
    .filter((h) => h.rating.firm !== '')
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((h) => h.rating)
  return {
    symbol,
    name: nameOf(result),
    currency: currencyOf(result),
    price: num(data['currentPrice']) ?? num(mod(result, 'price')['regularMarketPrice']),
    target: {
      low: num(data['targetLowPrice']),
      mean: num(data['targetMeanPrice']),
      median: num(data['targetMedianPrice']),
      high: num(data['targetHighPrice']),
      analysts: num(data['numberOfAnalystOpinions']),
    },
    recommendation: { key: text(data['recommendationKey']), mean: num(data['recommendationMean']) },
    trend: records(mod(result, 'recommendationTrend')['trend']).map((t) => {
      const period = text(t['period']) ?? ''
      return {
        period,
        label: monthLabel(period),
        strongBuy: num(t['strongBuy']) ?? 0,
        buy: num(t['buy']) ?? 0,
        hold: num(t['hold']) ?? 0,
        sell: num(t['sell']) ?? 0,
        strongSell: num(t['strongSell']) ?? 0,
      }
    }),
    rows,
  }
}

function ratingLine(r: Rating): string {
  let what: string
  switch (r.action) {
    case 'upgrade':
      what = `upgrades to ${r.to ?? '?'}${r.from ? ` from ${r.from}` : ''}`
      break
    case 'downgrade':
      what = `downgrades to ${r.to ?? '?'}${r.from ? ` from ${r.from}` : ''}`
      break
    case 'initiate':
      what = `initiates at ${r.to ?? '?'}`
      break
    case 'maintain':
      what = `maintains ${r.to ?? '?'}`
      break
    case 'reiterate':
      what = `reiterates ${r.to ?? '?'}`
      break
    default:
      what = `${r.action ?? 'rates'} ${r.to ?? '?'}`
  }
  const target =
    r.target !== null
      ? `, target ${f.price(r.target)}${r.priorTarget !== null && r.priorTarget !== r.target ? ` from ${f.price(r.priorTarget)}` : ''}${r.targetAction ? ` (${r.targetAction.toLowerCase()})` : ''}`
      : ''
  return `${[r.date, r.firm].filter(Boolean).join(' ')} ${what}${target}`
}

export function analystsResult(analysts: Analysts): ToolResult {
  const { target, recommendation } = analysts
  const lines = [`${title(analysts.symbol, analysts.name)} analyst ratings from Yahoo Finance:`]
  const price = analysts.price !== null ? `Price ${f.price(analysts.price)}${analysts.currency ? ` ${analysts.currency}` : ''}.` : ''
  if (target.mean !== null) {
    const away = analysts.price ? `; the mean is ${f.signedPercent(((target.mean - analysts.price) / analysts.price) * 100)} from the price` : ''
    const from = target.analysts !== null ? ` from ${target.analysts} analysts` : ''
    lines.push(
      `${price ? `${price} ` : ''}Price targets${from}: ${parts(
        target.low !== null && `low ${f.price(target.low)}`,
        `mean ${f.price(target.mean)}`,
        target.median !== null && `median ${f.price(target.median)}`,
        target.high !== null && `high ${f.price(target.high)}`,
      )}${away}.`,
    )
  } else {
    lines.push(`${price ? `${price} ` : ''}No analyst price targets.`)
  }
  if (recommendation.key || recommendation.mean !== null) {
    lines.push(
      `Consensus: ${parts(recommendation.key?.replace(/_/g, ' '), recommendation.mean !== null && `mean ${f.fixed(recommendation.mean)} on a scale from 1 (strong buy) to 5 (strong sell)`)}.`,
    )
  }
  if (analysts.trend.length) {
    lines.push(
      `Ratings by month (strong buy, buy, hold, sell, strong sell): ${analysts.trend
        .map((t) => `${t.label} ${[t.strongBuy, t.buy, t.hold, t.sell, t.strongSell].join(', ')}`)
        .join('; ')}.`,
    )
  }
  if (analysts.rows.length) {
    lines.push('Rating changes, newest first:')
    lines.push(...analysts.rows.map(ratingLine))
  }
  return toolResult(lines.join('\n'), analysts)
}

// Holders.

export type Holding = {
  holder: string
  shares: number | null
  percent: number | null
  value: number | null
  reported: string | null
  changePercent: number | null
}

export type Insider = {
  name: string
  relation: string | null
  lastTransaction: string | null
  date: string | null
  shares: number | null
  indirectShares: number | null
}

export type InsiderTrade = {
  date: string | null
  insider: string
  relation: string | null
  description: string | null
  shares: number | null
  value: number | null
  ownership: 'direct' | 'indirect' | null
}

export type Holders = {
  symbol: string
  name: string | null
  breakdown: { insidersPercent: number | null; institutionsPercent: number | null; institutionsFloatPercent: number | null; institutions: number | null } | null
  funds: Holding[]
  insiders: Insider[]
  /** Newest first. */
  transactions: InsiderTrade[]
  netPurchases: {
    period: string | null
    buys: number | null
    buyShares: number | null
    sells: number | null
    sellShares: number | null
    netShares: number | null
    insiderShares: number | null
    institutionalNetShares: number | null
  } | null
  /** The top institutions. */
  rows: Holding[]
}

function holdings(value: unknown, limit: number): Holding[] {
  return records(record(value)?.['ownershipList'])
    .map((o) => ({
      holder: spaced(o['organization']) ?? '',
      shares: num(o['position']),
      percent: percentOf(num(o['pctHeld'])),
      value: num(o['value']),
      reported: day(o['reportDate']),
      changePercent: percentOf(num(o['pctChange'])),
    }))
    .filter((h) => h.holder !== '')
    .slice(0, limit)
}

export function readHolders(symbol: string, json: unknown, limit: number): Holders {
  const result = summaryOf(json)
  const major = mod(result, 'majorHoldersBreakdown')
  const net = mod(result, 'netSharePurchaseActivity')
  const breakdown = {
    insidersPercent: percentOf(num(major['insidersPercentHeld'])),
    institutionsPercent: percentOf(num(major['institutionsPercentHeld'])),
    institutionsFloatPercent: percentOf(num(major['institutionsFloatPercentHeld'])),
    institutions: num(major['institutionsCount']),
  }
  const ownership = (value: unknown): InsiderTrade['ownership'] => (value === 'D' ? 'direct' : value === 'I' ? 'indirect' : null)
  return {
    symbol,
    name: nameOf(result),
    breakdown: Object.values(breakdown).some((v) => v !== null) ? breakdown : null,
    funds: holdings(result['fundOwnership'], limit),
    insiders: records(mod(result, 'insiderHolders')['holders'])
      .map((h) => ({
        name: spaced(h['name']) ?? '',
        relation: spaced(h['relation']),
        lastTransaction: spaced(h['transactionDescription']),
        date: day(h['latestTransDate']),
        shares: num(h['positionDirect']),
        indirectShares: num(h['positionIndirect']),
      }))
      .filter((h) => h.name !== '')
      .slice(0, limit),
    transactions: records(mod(result, 'insiderTransactions')['transactions'])
      .map((t) => ({
        at: num(t['startDate']) ?? 0,
        trade: {
          date: day(t['startDate']),
          insider: spaced(t['filerName']) ?? '',
          relation: spaced(t['filerRelation']),
          description: spaced(t['transactionText']) ?? spaced(t['moneyText']),
          shares: num(t['shares']),
          value: num(t['value']),
          ownership: ownership(t['ownership']),
        },
      }))
      .filter((t) => t.trade.insider !== '')
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map((t) => t.trade),
    netPurchases:
      Object.keys(net).length > 1
        ? {
            period: text(net['period']),
            buys: num(net['buyInfoCount']),
            buyShares: num(net['buyInfoShares']),
            sells: num(net['sellInfoCount']),
            sellShares: num(net['sellInfoShares']),
            netShares: num(net['netInfoShares']),
            insiderShares: num(net['totalInsiderShares']),
            institutionalNetShares: num(net['netInstSharesBuying']),
          }
        : null,
    rows: holdings(result['institutionOwnership'], limit),
  }
}

function holdingLine(h: Holding): string {
  return `${h.holder}: ${parts(f.big(h.shares), f.percent(h.percent), f.big(h.value), h.reported, h.changePercent !== null && f.signedPercent(h.changePercent))}`
}

export function holdersResult(holders: Holders): ToolResult {
  const lines = [`${title(holders.symbol, holders.name)} holders from Yahoo Finance:`]
  const b = holders.breakdown
  if (b) {
    const institutions = b.institutionsPercent !== null
      ? `institutions ${f.percent(b.institutionsPercent)}${b.institutionsFloatPercent !== null ? ` (${f.percent(b.institutionsFloatPercent)} of the float)` : ''}`
      : null
    const held = [b.insidersPercent !== null && `insiders hold ${f.percent(b.insidersPercent)}`, institutions].filter(Boolean).join(' and ')
    const count = b.institutions !== null ? `, across ${f.fixed(b.institutions, 0)} institutions` : ''
    if (held) lines.push(`${held.charAt(0).toUpperCase()}${held.slice(1)}${count}.`)
  }
  if (holders.rows.length) lines.push('Top institutions (shares, % held, value, as of, change):', ...holders.rows.map(holdingLine))
  if (holders.funds.length) lines.push('Top funds (shares, % held, value, as of, change):', ...holders.funds.map(holdingLine))
  if (holders.insiders.length) {
    lines.push('Insiders (latest transaction, shares held):')
    for (const i of holders.insiders) {
      const last = i.lastTransaction ? `${i.lastTransaction}${i.date ? ` on ${i.date}` : ''}` : null
      const held = parts(i.shares !== null && `holds ${f.big(i.shares)} shares directly`, i.indirectShares !== null && `${f.big(i.indirectShares)} indirectly`)
      lines.push(`${parts(i.name, i.relation)}: ${[last, held].filter(Boolean).join('; ')}`)
    }
  }
  if (holders.transactions.length) {
    lines.push('Insider transactions, newest first:')
    for (const t of holders.transactions) {
      const amounts = parts(t.shares !== null && `${f.big(t.shares)} shares`, t.value !== null && t.value !== 0 && f.big(t.value), t.ownership)
      lines.push(`${t.date ? `${t.date} ` : ''}${parts(t.insider, t.relation)}: ${[t.description, amounts].filter(Boolean).join(' ')}`)
    }
  }
  const n = holders.netPurchases
  if (n) {
    const trades = parts(
      n.buys !== null && `${n.buys} buys${n.buyShares !== null ? ` (${f.big(n.buyShares)} shares)` : ''}`,
      n.sells !== null && `${n.sells} sales${n.sellShares !== null ? ` (${f.big(n.sellShares)} shares)` : ''}`,
      n.netShares !== null && `net ${f.big(n.netShares)} shares`,
    )
    const held = n.insiderShares !== null ? `; insiders hold ${f.big(n.insiderShares)} shares` : ''
    const institutional =
      n.institutionalNetShares !== null && n.institutionalNetShares !== 0
        ? ` Institutions were net ${n.institutionalNetShares > 0 ? 'buyers' : 'sellers'} of ${f.big(Math.abs(n.institutionalNetShares))} shares.`
        : ''
    lines.push(`Insider trades${n.period ? ` over ${n.period}` : ''}: ${trades}${held}.${institutional}`)
  }
  return toolResult(capped([lines[0]!], lines.slice(1), (left) => `(${left} more lines left out.)`), holders)
}

// Funds.

export type Fund = {
  symbol: string
  name: string | null
  type: string | null
  currency: string | null
  family: string | null
  category: string | null
  legalType: string | null
  inception: string | null
  totalAssets: number | null
  expenseRatioPercent: number | null
  turnoverPercent: number | null
  yieldPercent: number | null
  nav: number | null
  pe: number | null
  beta3Year: number | null
  ytdReturnPercent: number | null
  threeYearReturnPercent: number | null
  fiveYearReturnPercent: number | null
  /** Each in percent. */
  assets: { stock: number | null; bond: number | null; cash: number | null; preferred: number | null; convertible: number | null; other: number | null }
  /** Largest first. */
  sectors: { sector: string; percent: number }[]
  /** The top holdings. */
  rows: { symbol: string | null; name: string; percent: number | null }[]
}

const SECTORS: Record<string, string> = {
  realestate: 'Real estate',
  consumer_cyclical: 'Consumer cyclical',
  basic_materials: 'Basic materials',
  consumer_defensive: 'Consumer defensive',
  technology: 'Technology',
  communication_services: 'Communication services',
  financial_services: 'Financial services',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
}

export function readFund(symbol: string, json: unknown): Fund {
  const result = summaryOf(json)
  const top = record(result['topHoldings'])
  const profile = record(result['fundProfile'])
  const type = typeOf(result)
  if (!top && !profile) throw new YahooError(`${symbol} is not a fund (${type ?? 'unknown type'}): fund holdings are for ETFs and mutual funds.`)
  const stats = mod(result, 'defaultKeyStatistics')
  const detail = mod(result, 'summaryDetail')
  const fees = record(profile?.['feesExpensesInvestment']) ?? {}
  const position = (key: string): number | null => percentOf(num(top?.[key]))
  return {
    symbol,
    name: nameOf(result),
    type,
    currency: currencyOf(result),
    family: text(profile?.['family']) ?? text(stats['fundFamily']),
    category: text(profile?.['categoryName']) ?? text(stats['category']),
    legalType: text(profile?.['legalType']) ?? text(stats['legalType']),
    inception: day(stats['fundInceptionDate']),
    totalAssets: num(stats['totalAssets']) ?? num(detail['totalAssets']),
    expenseRatioPercent: percentOf(num(fees['annualReportExpenseRatio'])),
    // Yahoo writes a turnover it has no figure for as 0.
    turnoverPercent: percentOf(num(fees['annualHoldingsTurnover'])) || null,
    yieldPercent: percentOf(num(stats['yield']) ?? num(detail['yield'])),
    nav: num(detail['navPrice']),
    pe: num(detail['trailingPE']),
    beta3Year: num(stats['beta3Year']),
    ytdReturnPercent: percentOf(num(stats['ytdReturn'])),
    threeYearReturnPercent: percentOf(num(stats['threeYearAverageReturn'])),
    fiveYearReturnPercent: percentOf(num(stats['fiveYearAverageReturn'])),
    assets: {
      stock: position('stockPosition'),
      bond: position('bondPosition'),
      cash: position('cashPosition'),
      preferred: position('preferredPosition'),
      convertible: position('convertiblePosition'),
      other: position('otherPosition'),
    },
    sectors: records(top?.['sectorWeightings'])
      .flatMap((weight) => Object.entries(weight))
      .map(([key, value]) => ({ sector: SECTORS[key] ?? key.replace(/_/g, ' '), percent: percentOf(num(value)) }))
      .filter((s): s is { sector: string; percent: number } => s.percent !== null && s.percent > 0)
      .sort((a, b) => b.percent - a.percent),
    rows: records(top?.['holdings'])
      .map((h) => ({ symbol: text(h['symbol']), name: spaced(h['holdingName']) ?? text(h['symbol']) ?? '', percent: percentOf(num(h['holdingPercent'])) }))
      .filter((h) => h.name !== ''),
  }
}

export function fundResult(fund: Fund): ToolResult {
  const lines = [`${title(fund.symbol, fund.name)}${fund.type ? ` (${fund.type})` : ''} from Yahoo Finance.`]
  const about = [
    fund.family && `Family: ${fund.family}.`,
    fund.category && `Category: ${fund.category}.`,
    fund.legalType && `Legal type: ${fund.legalType}.`,
    fund.inception && `Inception: ${fund.inception}.`,
  ].filter(Boolean)
  if (about.length) lines.push(about.join(' '))
  const figures = [
    fund.totalAssets !== null && `Net assets ${f.big(fund.totalAssets)}${fund.currency ? ` ${fund.currency}` : ''}.`,
    fund.expenseRatioPercent !== null && `Expense ratio ${smallPercent(fund.expenseRatioPercent)}.`,
    fund.turnoverPercent !== null && `Turnover ${f.percent(fund.turnoverPercent)}.`,
    fund.yieldPercent !== null && `Yield ${f.percent(fund.yieldPercent)}.`,
    fund.nav !== null && `NAV ${f.price(fund.nav)}.`,
    fund.pe !== null && `P/E ${f.fixed(fund.pe)}.`,
    fund.beta3Year !== null && `Beta (3 years) ${f.fixed(fund.beta3Year)}.`,
  ].filter(Boolean)
  if (figures.length) lines.push(figures.join(' '))
  const returns = parts(
    fund.ytdReturnPercent !== null && `year to date ${f.signedPercent(fund.ytdReturnPercent)}`,
    fund.threeYearReturnPercent !== null && `3-year average ${f.signedPercent(fund.threeYearReturnPercent)}`,
    fund.fiveYearReturnPercent !== null && `5-year average ${f.signedPercent(fund.fiveYearReturnPercent)}`,
  )
  if (returns) lines.push(`Returns: ${returns}.`)
  const names: [keyof Fund['assets'], string][] = [
    ['stock', 'stocks'],
    ['bond', 'bonds'],
    ['cash', 'cash'],
    ['preferred', 'preferred'],
    ['convertible', 'convertibles'],
    ['other', 'other'],
  ]
  const mix = parts(...names.map(([key, label]) => fund.assets[key] !== null && fund.assets[key] !== 0 && `${label} ${f.percent(fund.assets[key])}`))
  if (mix) lines.push(`Asset mix: ${mix}.`)
  if (fund.sectors.length) lines.push(`Sectors: ${fund.sectors.map((s) => `${s.sector} ${f.percent(s.percent)}`).join(', ')}.`)
  if (fund.rows.length) {
    lines.push(`Top holdings: ${fund.rows.map((h) => `${h.symbol ? `${h.symbol} ` : ''}${h.name} ${f.percent(h.percent)}`).join(', ')}.`)
  }
  return toolResult(lines.join('\n'), fund)
}
