import { plain as f } from '../format.ts'
import { list, num, record, records, text } from '../values.ts'
import { toolResult, type ToolResult } from './result.ts'
import { YahooError } from './yahoo.ts'

// Financial statements from Yahoo's fundamentals time series, the source its own Financials page
// reads (quoteSummary's statement modules have been mostly empty since 2023). Each line is a series
// named by the frequency and the item, annualTotalRevenue; Yahoo gives about four years and five
// quarters. Values are as reported, in the statement's currency; a tax rate is a fraction.

export const STATEMENTS = ['income', 'balance', 'cashflow'] as const
export const FREQUENCIES = ['annual', 'quarterly', 'trailing'] as const
export type Statement = (typeof STATEMENTS)[number]
export type Frequency = (typeof FREQUENCIES)[number]

export type LineKind = 'money' | 'perShare' | 'shares' | 'rate'

export type Line = { key: string; label: string; kind: LineKind; highlight: boolean }

export type LineItem = Line & {
  /** By period, as in `periods`. */
  values: Record<string, number | null>
}

export type Financials = {
  symbol: string
  statement: Statement
  frequency: Frequency
  currency: string | null
  /** When each column's period ended, latest first. */
  periods: string[]
  rows: LineItem[]
}

const line = (key: string, label: string, kind: LineKind = 'money', highlight = false): Line => ({ key, label, kind, highlight })

export const LINES: Record<Statement, Line[]> = {
  income: [
    line('TotalRevenue', 'Total revenue', 'money', true),
    line('OperatingRevenue', 'Operating revenue'),
    line('CostOfRevenue', 'Cost of revenue'),
    line('GrossProfit', 'Gross profit', 'money', true),
    line('OperatingExpense', 'Operating expense'),
    line('SellingGeneralAndAdministration', 'Selling, general and administrative'),
    line('ResearchAndDevelopment', 'Research and development'),
    line('OperatingIncome', 'Operating income', 'money', true),
    line('NetNonOperatingInterestIncomeExpense', 'Net non-operating interest'),
    line('InterestIncome', 'Interest income'),
    line('InterestExpense', 'Interest expense'),
    line('OtherIncomeExpense', 'Other income and expense'),
    line('PretaxIncome', 'Pretax income'),
    line('TaxProvision', 'Tax provision'),
    line('NetIncomeContinuousOperations', 'Net income from continuing operations'),
    line('MinorityInterests', 'Minority interests'),
    line('NetIncome', 'Net income', 'money', true),
    line('NetIncomeCommonStockholders', 'Net income to common stockholders'),
    line('BasicEPS', 'Basic EPS', 'perShare'),
    line('DilutedEPS', 'Diluted EPS', 'perShare', true),
    line('BasicAverageShares', 'Basic average shares', 'shares'),
    line('DilutedAverageShares', 'Diluted average shares', 'shares'),
    line('TotalExpenses', 'Total expenses'),
    line('EBIT', 'EBIT'),
    line('EBITDA', 'EBITDA', 'money', true),
    line('NormalizedEBITDA', 'Normalized EBITDA'),
    line('NormalizedIncome', 'Normalized income'),
    line('ReconciledDepreciation', 'Depreciation and amortization'),
    line('TotalUnusualItems', 'Unusual items'),
    line('TaxRateForCalcs', 'Tax rate', 'rate'),
  ],
  balance: [
    line('TotalAssets', 'Total assets', 'money', true),
    line('CurrentAssets', 'Current assets'),
    line('CashCashEquivalentsAndShortTermInvestments', 'Cash and short-term investments'),
    line('CashAndCashEquivalents', 'Cash and cash equivalents', 'money', true),
    line('OtherShortTermInvestments', 'Short-term investments'),
    line('Receivables', 'Receivables'),
    line('AccountsReceivable', 'Accounts receivable'),
    line('Inventory', 'Inventory'),
    line('OtherCurrentAssets', 'Other current assets'),
    line('TotalNonCurrentAssets', 'Non-current assets'),
    line('NetPPE', 'Property, plant and equipment, net'),
    line('GoodwillAndOtherIntangibleAssets', 'Goodwill and intangibles'),
    line('Goodwill', 'Goodwill'),
    line('InvestmentsAndAdvances', 'Investments and advances'),
    line('OtherNonCurrentAssets', 'Other non-current assets'),
    line('TotalLiabilitiesNetMinorityInterest', 'Total liabilities', 'money', true),
    line('CurrentLiabilities', 'Current liabilities'),
    line('AccountsPayable', 'Accounts payable'),
    line('CurrentDebt', 'Current debt'),
    line('CurrentDeferredRevenue', 'Current deferred revenue'),
    line('OtherCurrentLiabilities', 'Other current liabilities'),
    line('TotalNonCurrentLiabilitiesNetMinorityInterest', 'Non-current liabilities'),
    line('LongTermDebt', 'Long-term debt'),
    line('OtherNonCurrentLiabilities', 'Other non-current liabilities'),
    line('StockholdersEquity', "Stockholders' equity", 'money', true),
    line('CommonStockEquity', 'Common stock equity'),
    line('RetainedEarnings', 'Retained earnings'),
    line('TotalEquityGrossMinorityInterest', 'Total equity with minority interest'),
    line('TotalDebt', 'Total debt', 'money', true),
    line('NetDebt', 'Net debt'),
    line('WorkingCapital', 'Working capital'),
    line('InvestedCapital', 'Invested capital'),
    line('TangibleBookValue', 'Tangible book value'),
    line('ShareIssued', 'Shares issued', 'shares'),
    line('OrdinarySharesNumber', 'Ordinary shares', 'shares'),
    line('TreasurySharesNumber', 'Treasury shares', 'shares'),
  ],
  cashflow: [
    line('OperatingCashFlow', 'Operating cash flow', 'money', true),
    line('NetIncomeFromContinuingOperations', 'Net income from continuing operations'),
    line('DepreciationAndAmortization', 'Depreciation and amortization'),
    line('StockBasedCompensation', 'Stock-based compensation'),
    line('DeferredIncomeTax', 'Deferred income tax'),
    line('ChangeInWorkingCapital', 'Change in working capital'),
    line('InvestingCashFlow', 'Investing cash flow', 'money', true),
    line('CapitalExpenditure', 'Capital expenditure'),
    line('NetBusinessPurchaseAndSale', 'Acquisitions and divestitures'),
    line('NetInvestmentPurchaseAndSale', 'Investments bought and sold'),
    line('FinancingCashFlow', 'Financing cash flow', 'money', true),
    line('NetIssuancePaymentsOfDebt', 'Debt issued and repaid'),
    line('RepurchaseOfCapitalStock', 'Share repurchases'),
    line('IssuanceOfCapitalStock', 'Shares issued'),
    line('CashDividendsPaid', 'Dividends paid'),
    line('ChangesInCash', 'Change in cash'),
    line('BeginningCashPosition', 'Cash at the start'),
    line('EndCashPosition', 'Cash at the end'),
    line('FreeCashFlow', 'Free cash flow', 'money', true),
    line('IncomeTaxPaidSupplementalData', 'Income taxes paid'),
    line('InterestPaidSupplementalData', 'Interest paid'),
  ],
}

/** The line whose periods are the statement's columns. */
const LEAD: Record<Statement, string> = { income: 'TotalRevenue', balance: 'TotalAssets', cashflow: 'OperatingCashFlow' }

const NAMES: Record<Statement, string> = { income: 'income statement', balance: 'balance sheet', cashflow: 'cash flow statement' }
const EVERY: Record<Frequency, string> = { annual: 'annual', quarterly: 'quarterly', trailing: 'trailing twelve months' }

/** Columns kept at most. */
const PERIODS_MAX = 8
/** Yahoo's own start for the series (1985). */
const START = 493590046
const DAY = 86_400

export function timeseriesQuery(symbol: string, statement: Statement, frequency: Frequency, now: number): Record<string, string | number> {
  return {
    symbol,
    type: LINES[statement].map((l) => `${frequency}${l.key}`).join(','),
    period1: START,
    // The next midnight, UTC: the same address all day, so the answer can be kept.
    period2: Math.ceil(now / 1000 / DAY) * DAY,
  }
}

export function readFinancials(symbol: string, statement: Statement, frequency: Frequency, json: unknown): Financials {
  if (statement === 'balance' && frequency === 'trailing') {
    throw new YahooError('A balance sheet has no trailing twelve months: it is a point in time. Ask for annual or quarterly.')
  }
  const wanted = frequency === 'trailing' ? 'TTM' : null
  const series = new Map<string, Map<string, number>>()
  let currency: string | null = null
  for (const result of records(record(record(json)?.['timeseries'])?.['result'])) {
    const type = text(list(record(result['meta'])?.['type'])[0])
    if (!type?.startsWith(frequency)) continue
    const values = new Map<string, number>()
    for (const entry of records(result[type])) {
      const date = text(entry['asOfDate'])
      const value = num(record(entry['reportedValue'])?.['raw'])
      if (!date || value === null) continue
      if (wanted && text(entry['periodType']) !== wanted) continue
      values.set(date, value)
      currency ??= text(entry['currencyCode'])
    }
    if (values.size) series.set(type.slice(frequency.length), values)
  }
  if (!series.size) throw new YahooError(`Yahoo Finance has no ${EVERY[frequency]} ${NAMES[statement]} for ${symbol}.`)
  const lead = series.get(LEAD[statement])
  const dates = lead ? [...lead.keys()] : [...series.values()].flatMap((values) => [...values.keys()])
  const periods = [...new Set(dates)].sort((a, b) => b.localeCompare(a)).slice(0, PERIODS_MAX)
  const rows: LineItem[] = []
  for (const l of LINES[statement]) {
    const values = series.get(l.key)
    if (!values || !periods.some((p) => values.has(p))) continue
    rows.push({ ...l, values: Object.fromEntries(periods.map((p) => [p, values.get(p) ?? null])) })
  }
  return { symbol, statement, frequency, currency, periods, rows }
}

export function lineValue(kind: LineKind, value: number | null, format: { big(v: number | null): string; fixed(v: number | null): string; fraction(v: number | null): string }): string {
  if (kind === 'perShare') return format.fixed(value)
  if (kind === 'rate') return format.fraction(value)
  return format.big(value)
}

export function financialsResult(financials: Financials): ToolResult {
  const { symbol, statement, frequency, currency, periods, rows } = financials
  const head = `${symbol} ${NAMES[statement]}, ${EVERY[frequency]}, from Yahoo Finance${currency ? `, in ${currency}` : ''}.`
  const lines = rows.map((row) => `${row.label}: ${periods.map((p) => lineValue(row.kind, row.values[p] ?? null, f)).join(' | ')}`)
  return toolResult([head, `Period ended: ${periods.join(' | ')}`, ...lines].join('\n'), financials)
}
