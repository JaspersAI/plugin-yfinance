// What the orchestrator is told while one of the Yahoo Finance views is focused: how each is driven
// by state, what its output holds, and where to go for more than it shows.

const SYMBOLS = 'Symbols are Yahoo’s: AAPL, BRK-B, SHOP.TO, 7203.T, ^GSPC, ES=F, EURUSD=X, BTC-USD; the yfinance search source finds one from a name.'
const SOURCE = 'The data is Yahoo Finance’s, which has no official API: some quotes are delayed; say where figures come from.'

export const OVERVIEW_INSTRUCTIONS = [
  'One company or fund from Yahoo Finance: price and change, day and 52-week ranges, key statistics, analyst targets and the month’s ratings, the next earnings date and recent quarters against estimates, and the profile; for an ETF or mutual fund, also its figures, top holdings, and sector weights.',
  `state.symbol is the symbol; set it to show another. ${SYMBOLS}`,
  'output holds the price, change in percent, market cap, P/E, forward P/E, dividend yield, the 52-week range, the analysts’ target (low, mean, high) and consensus, the next earnings date, sector, and industry, and output.errors names any part Yahoo refused. For figures the view does not publish, call the yfinance sources (statistics, analysts, earnings, profile, holders, fund) rather than guessing.',
  SOURCE,
].join('\n')

export const WATCHLIST_INSTRUCTIONS = [
  'A watchlist: quotes from Yahoo Finance for a list of symbols (last, change, volume, market cap, day range), asked again every minute. The user adds symbols in its field and removes them with ×.',
  `state.symbols is the whole list, up to 30; set it whole to change it, keeping the symbols already there unless the user asks to drop them. ${SYMBOLS}`,
  'output.rows holds each symbol’s price and change in percent, in the list’s order; output.missing names symbols Yahoo did not find, which the search source can correct.',
  SOURCE,
].join('\n')

export const MARKETS_INSTRUCTIONS = [
  'The market at a glance from Yahoo Finance: tiles for index futures, commodities, the 10-year yield, the VIX, currencies, and crypto, then a list of US stocks, both asked again every minute.',
  'state.list is gainers (default), losers, most_active, trending, or a saved screen: undervalued_growth, growth_technology, aggressive_small_caps, small_cap_gainers, undervalued_large_caps.',
  'output.tiles holds each tile’s symbol, price, and change in percent; output.top the first ten of the list, and output.total how many the list has. For more of a list, call the movers source with a limit.',
  SOURCE,
].join('\n')

export const FINANCIALS_INSTRUCTIONS = [
  'One company’s financial statement from Yahoo Finance: line items down, periods across, latest first, as reported in the statement’s currency. Yahoo has about four years and five quarters.',
  `state.symbol is the symbol; state.statement is income (default), balance, or cashflow; state.frequency is annual (default), quarterly, or trailing (twelve months; not for a balance sheet). ${SYMBOLS}`,
  'output holds the periods and the key lines’ values by label (revenue, profit, EPS; assets, liabilities, equity, debt; operating, investing, financing, and free cash flow), aligned with the periods. For every line, call the financials source with the same arguments.',
  SOURCE,
].join('\n')

export const OPTIONS_INSTRUCTIONS = [
  'One symbol’s option chain from Yahoo Finance for one expiration: calls and puts side by side at the strikes nearest the price, with last, bid, ask, volume, open interest, and implied volatility, the in-the-money side shaded. Asked again every minute; prices can be delayed.',
  'state.symbol is the underlying; state.expiration is a date the chain lists (YYYY-MM-DD), or null for the nearest; state.strikes is how many strikes on each side of the price, 10 by default. Setting a new symbol, set expiration to null too.',
  'output holds the expiration, output.expirations (the dates listed, for choosing another), the underlying price, the strike nearest the price with its call and put mid and IV, and put/call ratios by volume and open interest.',
  SOURCE,
].join('\n')
