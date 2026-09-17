# plugin-yfinance

Yahoo Finance for [Jaspers Terminal](https://github.com/JaspersAI), an open source, extensible desktop terminal for financial research.

Declares `yfinance/server`, a small MCP server that runs inside the plugin and asks Yahoo Finance, with no key. Its fourteen tools are the plugin's sources, for the assistant and for research analysts:

| Source | What it gives |
| --- | --- |
| `search` | Symbols by name or keyword, with exchange, sector, and industry |
| `quote` | Live quotes for up to 50 symbols |
| `history` | Price bars by range or dates and interval, with dividends and splits |
| `profile` | Sector, industry, employees, headquarters, business summary, officers, governance risk |
| `statistics` | Valuation, margins, growth, balance sheet, trading, short interest, dividends |
| `financials` | Income statement, balance sheet, or cash flow: annual, quarterly, or trailing twelve months |
| `earnings` | Next report date and estimates, the last four quarters against estimates, forward estimates |
| `analysts` | Price targets, consensus, monthly ratings, upgrades and downgrades |
| `holders` | Insider and institutional ownership, top holders, insider trades |
| `options` | Expirations and the chain nearest the price, with volume, open interest, and implied volatility |
| `news` | Headlines for a ticker or a topic |
| `market-summary` | Index futures, commodities, rates, currencies, and crypto |
| `movers` | Gainers, losers, most active, trending, and saved screens |
| `fund` | An ETF's or mutual fund's profile, returns, sector weights, and top holdings |

And five views the assistant places and drives:

- `yfinance/overview`, **Company**: price, day and 52-week ranges, key statistics, analyst targets and ratings, earnings, and profile for one symbol.
- `yfinance/watchlist`, **Watchlist**: quotes for up to 30 symbols, refreshed every minute.
- `yfinance/markets`, **Markets**: the market summary as tiles, and a list of movers.
- `yfinance/financials`, **Financials**: one statement, line items down and periods across.
- `yfinance/options`, **Options**: calls and puts side by side for one expiration.

Yahoo Finance has no official API: the server asks the endpoints Yahoo's own pages use, some quotes are delayed, and Yahoo can limit requests. The plugin is not affiliated with Yahoo; the data is for information only.

## Install

In Jaspers Terminal, open Settings > Plugins, paste

```
https://github.com/JaspersAI/plugin-yfinance
```

and press Install. The app downloads the latest release, shows where it came from, and asks before any of it runs. A plugin runs code on your computer with your permissions, so install plugins only from people you trust. New users are offered this plugin during setup.

## Keys

None.

## Needs

Nothing else. The server runs on the Node the app itself runs on.

## Develop

```sh
git clone https://github.com/JaspersAI/plugin-yfinance.git ~/Jaspers/plugins/yfinance
cd ~/Jaspers/plugins/yfinance
npm install
npm run typecheck
npm test
npm run smoke
```

`npm run smoke` asks the real Yahoo Finance once per tool, and through the server's stdio entry, and prints a line for each. A folder you put in `~/Jaspers/plugins` is a plugin of your own, which the app rebuilds whenever you save. If this plugin is installed, remove it in Settings > Plugins first: the clone goes where the installed copy lives. Types come from [`@jaspers-ai/sdk`](https://www.npmjs.com/package/@jaspers-ai/sdk), which the app provides at run time.

## Release

Bump `version` in `package.json`, commit, and push a tag:

```sh
npm version patch
git push --follow-tags
```

The Release workflow checks the plugin and attaches `yfinance-<version>.zip` to a GitHub release. Update in Settings > Plugins picks it up.

## License

[MIT](LICENSE)
