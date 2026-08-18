# BSK Stock Analyser — Maintainer & Developer Guide

This document explains **how the whole project works and how to change it safely**, so
anyone (including future-you) can pick it up and extend it. It is intentionally detailed.

- New here? Read [1. Overview](#1-overview) → [3. How it runs](#3-how-it-runs) → [5. File-by-file](#5-file-by-file-reference).
- Want to change something specific? Jump to [7. Recipes](#7-common-edit-recipes).

---

## Table of contents
1. [Overview & guiding principles](#1-overview)
2. [Tech stack & why](#2-tech-stack)
3. [How it runs (two modes)](#3-how-it-runs)
4. [Data flow](#4-data-flow)
5. [File-by-file reference](#5-file-by-file-reference)
6. [The scoring & decision engine explained](#6-scoring--decision-engine)
7. [Common edit recipes](#7-common-edit-recipes)
8. [Serverless API reference](#8-serverless-api-reference)
9. [Design system & theming](#9-design-system--theming)
10. [Accessibility rules to preserve](#10-accessibility)
11. [Testing](#11-testing)
12. [Deployment](#12-deployment)
13. [Troubleshooting / FAQ](#13-troubleshooting--faq)
14. [Glossary](#14-glossary)
15. [Known limitations & roadmap](#15-known-limitations--roadmap)

---

## 1. Overview

BSK Stock Analyser is a **client-side web app** that analyses Indian (NSE & BSE) listed
stocks and produces a **transparent, weighted investment score** with an explicit
decision, confidence and data-quality reading. It is a *decision-support* tool, not a
price-prediction gimmick.

### The five principles (do not violate when editing)
1. **Never fabricate data.** If a fetch fails, show an error — never a guessed value.
   Missing metrics render as `—`, and the component is dropped from the score.
2. **Deterministic maths.** Every number comes from plain JS in `indicators.js` /
   `analysis.js`. No LLM/AI computes a metric. A console self-test guards the maths.
3. **Transparency.** The score is a labelled sum of sub-scores × weights, all shown.
4. **Honesty about freshness.** Data is delayed (never "real-time"); timestamps and
   sources are always displayed.
5. **Missing ≠ clean.** The red-flag engine lists what it *couldn't* check, so the
   absence of a flag is never read as a clean bill of health.

Whenever you add a feature, keep these true. They are the product.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla **ES modules** (no framework, no build step) | Deploys as static files anywhere; nothing to compile; easy to read/edit |
| Charts | **Chart.js 4** via CDN | Mature, small, no build |
| Fonts | Google Fonts (Sora / Inter / JetBrains Mono) | Distinct identity; graceful fallback |
| Backend | **Vercel serverless functions** (Node) in `api/` | Proxy market data server-side (no browser CORS), hold no secrets in the client |
| Tests | **Playwright + axe-core** in `tests/` | Real browser, offline via request mocking |

There is **no build step**. What you see in the repo is what ships.

---

## 3. How it runs

The app has **two runtime modes**, chosen automatically at request time by
`js/providers.js`:

- **Mode 1 — Vercel (recommended).** The browser calls our own `/api/*` functions,
  which fetch Yahoo Finance server-side. No CORS problem, and **fundamentals work**.
- **Mode 2 — plain static hosting** (e.g. GitHub Pages). `/api/*` returns 404, so the
  app falls back to public CORS relays for price history; fundamentals show as
  *unavailable* (the crumb handshake can't run in a browser).

`providers.js` always tries `/api/*` first and silently falls back — so the *same files*
work in both places.

---

## 4. Data flow

```
          user types / clicks
                 │
      js/app.js  ▼  (search, orchestration, rendering, theme, watchlist)
                 │
   ┌─────────────┼───────────────────────────────┐
   ▼             ▼                                 ▼
stocks.js   providers.js  ───────►  /api/history  │  (Vercel)  ─► Yahoo v8/chart
(search      (fetch + cache          /api/quote    │            ─► Yahoo quoteSummary
 index,       + fallback)            /api/search   │            ─► Yahoo search
 ticker                              └── or public CORS relays (static mode)
 mapping)          │
                   ▼
             indicators.js   (deterministic maths: SMA/RSI/MACD/beta/…)
                   │
                   ▼
              analysis.js    (technical/trend/risk + scorers + decision + red flags)
                   │
                   ▼
      app.js render*()  +  charts.js  +  icons.js   →   DOM
```

**Golden rule:** data comes *in* through `providers.js`, maths happens in
`indicators.js`/`analysis.js`, and the *view* is built in `app.js`. Keep these separate.

---

## 5. File-by-file reference

```
stock-analyzer/
├── index.html          # page shell: topbar, search, intro, tabs template, footer
├── css/styles.css      # the entire design system (tokens, components, responsive)
├── js/
│   ├── stocks.js       # search shortlist, sector map, NSE/BSE→Yahoo ticker resolution
│   ├── providers.js    # data layer: /api first, CORS-relay fallback, cache, honesty
│   ├── indicators.js   # deterministic maths + a console self-test
│   ├── analysis.js     # technical/trend/risk + scoring + decision + red-flag engines
│   ├── charts.js       # Chart.js wrappers (price / volume / RSI / score)
│   ├── icons.js        # hand-built SVG icon set + logo mark + favicon
│   ├── config.js       # GOOGLE_CLIENT_ID for optional Google sign-in (+ setup notes)
│   ├── gsync.js        # optional Google sign-in + sync to the user's Google Drive appData
│   └── app.js          # orchestration, rendering, theming, a11y, watchlist, account UI
├── api/                # Vercel serverless functions (Node)
│   ├── history.js      # proxy → Yahoo v8/chart
│   ├── quote.js        # proxy → Yahoo quoteSummary (fundamentals; crumb handshake)
│   ├── search.js       # proxy → Yahoo symbol search (search by company name)
│   ├── movers.js       # proxy → Yahoo v7/quote batch (home-page market movers)
│   ├── financials.js   # proxy → Yahoo fundamentals-timeseries (P&L/BS/CF) + quoteSummary fallback
│   └── peers.js        # proxy → batch quoteSummary fundamentals (peer comparison)
├── tests/              # Playwright + axe-core suite (npm test) — NOT deployed
├── vercel.json         # Vercel config (clean URLs, function limits, CORS header)
├── .vercelignore       # keeps tests/ + node_modules out of the deploy
├── README.md           # short project readme
└── DOCUMENTATION.md    # (this file)
```

### `js/stocks.js`
- `STOCK_UNIVERSE` — the **autocomplete shortlist** only (a curated cross-sector sample).
  It is **not** the limit of what can be analysed; any symbol can be typed.
- `SECTORS` — sector code → display label. Used for tags and sector-specific scoring.
- `SECTOR_INDEX`, `BENCHMARK` — index tickers for relative strength / benchmark.
- `toYahoo(symbol)` / `altYahoo(symbol)` — resolve a typed symbol to a Yahoo ticker:
  alphabetic → `.NS` (with `.BO` fallback), all-numeric → BSE `.BO`, `^INDEX`/explicit
  passthrough. **Tickers are kept raw here; URL-encoding happens at fetch time.**
- `searchStocks(q)` — instant local fuzzy match over the shortlist.

### `js/providers.js`
- `getHistory(symbol, range, interval)` — price history, primary exchange then
  `altYahoo` fallback; caches in memory + `localStorage` (15 min TTL).
- `getIndexHistory(ticker, name, range)` — for benchmark/sector indices.
- `getFundamentals(symbol)` — `/api/quote`; returns `{available:false, reason}` on static
  hosting (never fabricates).
- `searchSymbols(q)` — live company-name search (`/api/search` → relay fallback), filtered
  to Indian `.NS`/`.BO` equities/ETFs.
- `getNews`, `getOwnership` — currently honest stubs (`available:false`) — **extension points**.
- Internals: `fetchChart()` (shared parse), `fetchJSONviaRelays()`, `tryLocalApi()`, cache helpers.

### `js/indicators.js`
Pure functions, each returns `null` when there's insufficient data (never a guess):
`sma/ema`, `rsi`, `macd`, `bollinger`, `atr`, `adx`, `pctReturn`, `cagr`,
`annualVolatility`, `dailyReturns`, `maxDrawdown`, `beta`, `sharpe`, `downsideVolatility`,
plus `round()` and `_selfTest()` (runs on load; logs to console).

### `js/analysis.js`
- `technical(bars)`, `trend(bars)`, `performance(bars)`, `risk(bars, benchBars)`,
  `relativeStrength(bars, benchBars)` — build the analysis objects.
- Scorers (each → `{score:0-100|null, notes:[]}`): `scoreTechnical`, `scoreRelStrength`,
  `scoreRisk`, `scoreFundamentals`, `scoreGrowth`, `scoreHealth`, `scoreValuation`
  (sector-aware). `band()` maps a value to a sub-score via a threshold table.
- `buildScore({...})` — combines scorers using `BASE_WEIGHTS`, **re-normalises** over
  available components, returns `{overall, breakdown, dataQuality, confidence}`.
- `decide(score, risk, redFlags)` — maps score → rating, applies **overrides**.
- `redFlags({...})` — price/volatility flags + the "not assessable" list.

### `js/app.js`
Boot (`setupChrome` injects logo/icons/theme, wires the brand→home click), `wireSearch`
(debounced live search + ARIA), `wireTabs` (ARIA + keyboard), `runAnalysis` (the
orchestrator, with a `loading` lock so a second analysis can't race the first),
`renderAll` + `render*` panel builders, `gaugeSVG`, watchlist (localStorage), helpers.
The **Markets home** lives here too: `loadHome` → `getMovers` + `loadIndices`,
`computeScreens` (gainers / losers / most-active / volume-shockers / sector averages),
`renderHome`, and `showHome`/`hideHome` toggling `#home` vs `#result`. Also a guarded
`?e2e=1` test seam that exposes `renderAll`/`setCurrent`.

### `css/styles.css`, `js/icons.js`, `api/*` — see [§9](#9-design-system--theming) and [§8](#8-serverless-api-reference).

---

## 6. Scoring & decision engine

### Weights (`analysis.js` → `BASE_WEIGHTS`)
```
Fundamentals 25 · Growth 15 · Financial health 15 · Valuation 15
Technical 10 · Relative strength 5 · Ownership 5 · News 5 · Risk 5   (= 100)
```

### Re-normalisation (the honesty mechanism)
Components that can't be computed (e.g. fundamentals on static hosting, or a missing
ratio) are **dropped**, and the remaining weights are scaled back up to 100:
```
effectiveWeight(k) = baseWeight(k) / Σ(available baseWeights) × 100
overall            = Σ sub-score(k) × effectiveWeight(k) / 100
```

### Data quality & confidence
```
dataQuality = Σ(available baseWeights)            # % of intended weight computed
confidence  = max(20, round(dataQuality × 0.9))   # never overstates certainty
```

### Decision bands (`decide()`)
```
85–100 STRONG BUY · 75–84 BUY · 60–74 WATCH/HOLD · 45–59 AVOID · 0–44 STRONG AVOID
```
**Overrides (safety first):**
- Any `critical` red flag → rating capped at **AVOID**.
- `dataQuality < 45` → rating capped at **WATCH/HOLD** (won't issue STRONG BUY on thin data).

---

## 7. Common edit recipes

> After any edit run `cd tests && npm test`. For maths, also open the app and check the
> `[indicators self-test]` line in the browser console.

### Add / remove a stock in the autocomplete shortlist
`js/stocks.js` → add to `STOCK_UNIVERSE`:
```js
{ s: 'TATAPOWER', n: 'Tata Power', sector: 'ENERGY', industry: 'Power Utility' },
```
`s` = NSE symbol, `sector` must be a key of `SECTORS`. (Reminder: users can already
analyse *any* symbol by typing it — the shortlist is just convenience.) **`STOCK_UNIVERSE`
is also the pool the Markets home page scans** for gainers/losers/most-active/shockers and
sector trends, so adding names here widens the home dashboard too. To make the home page
cover the whole market, replace this list with a fuller NSE symbol list (mind the
`/api/movers` batch size — it caps at 150 symbols per call).

### Add a new sector
`js/stocks.js` → add to `SECTORS` (e.g. `REALTY: 'Real Estate'`). Optionally add a
sector index to `SECTOR_INDEX`. If the sector needs special valuation, see below.

### Change the scoring weights
`js/analysis.js` → `BASE_WEIGHTS`. They don't have to sum to 100 (re-normalisation
handles it), but keeping them at 100 keeps `dataQuality` intuitive.

### Change decision thresholds or overrides
`js/analysis.js` → `decide()` (bands) and the `overrides` block. Update the bands table
in this doc and the README if you change them.

### Add a new technical indicator
1. Implement it in `js/indicators.js` (return `null` when data is insufficient) and add a
   line to `_selfTest()`.
2. Compute it in `analysis.js` → `technical()`; optionally push a signal into `signals`.
3. Show it in `app.js` → `renderTechnical()` (add a `metric(...)`).
4. Optionally fold it into `scoreTechnical()`.

### Add a new fundamental metric
1. Map it in `api/quote.js` (add to the `data` object from the right Yahoo module).
2. Consume it in the relevant scorer in `analysis.js` (`scoreFundamentals` / `scoreGrowth`
   / `scoreHealth` / `scoreValuation`) — guard for `null`.
3. Display it in `app.js` → `renderFundamentals()`.

### Add a sector-specific valuation rule
`js/analysis.js` → `scoreValuation(f, sector)`. Example pattern already there:
```js
const isBank = sector === 'BANK';
if (isBank && v.priceToBook != null) { /* score on P/B */ }
else if (v.trailingPE != null) { /* score on P/E */ }
```
Add `else if (sector === 'YOURSECTOR')` branches as needed.

### Swap Yahoo for a licensed data feed (recommended for production)
Only `api/history.js`, `api/quote.js`, `api/search.js` know about Yahoo. Repoint them at
your vendor and keep the **response shapes** identical:
- history → Yahoo v8/chart JSON shape (or adapt `parseChart` in `providers.js`).
- quote → the `{available, valuation, profitability, growth, health}` object.
- search → `{ quotes: [{symbol, shortname/longname, quoteType, exchange}] }`.
Nothing else changes.

### Enable News / Ownership / Backtesting
Implement `api/news.js` / `api/ownership.js`, then update `getNews()` / `getOwnership()`
in `providers.js` to call them and return real data. `buildScore()` will automatically
start weighting `news`/`ownership` (their weight stops being re-normalised away) and
`dataQuality`/`confidence` rise. Add render logic in `app.js` → `renderNewsOwnership()`.

### Change colours / fonts
`css/styles.css` → the `:root` token blocks (and the two dark blocks). Never define a
colour only inside a media/`[data-theme]` block — always give it a base value in `:root`.
Fonts: change the `<link>` in `index.html` and the font-family stacks in the CSS.

### Change the logo or add an icon
`js/icons.js`. Add an entry to `ICON` (24×24, `currentColor`, no fixed fill unless
filled) and call `icon('name')`. The logo is `logoMark()`; the favicon is
`faviconDataUri()` — keep them visually in sync.

### Enable Google sign-in & Drive sync (optional)
Paste a Google OAuth **Web** client ID into `js/config.js` → `GOOGLE_CLIENT_ID`. That's it
— the "Sign in" button appears and syncing turns on. Setup steps are in the comment at the
top of `config.js` (enable Google Drive API; add scopes openid/email/profile/`drive.appdata`;
add your origin to the client's Authorized JavaScript origins). How it works:
- `js/gsync.js` uses the browser-only **GIS token flow** (no client secret) to get a
  short-lived access token, then reads/writes **one JSON file** in the Drive
  `appDataFolder` (hidden, private to this app). It only touches the watchlist + theme.
- `app.js` renders the account button/menu (`renderAccount`), and on sign-in runs
  `onGoogleSignedIn`: pull remote → `mergeData` (unions watchlists, newer theme wins) →
  apply locally → push back. Local changes (`setWL`, theme toggle) call `schedulePush`
  (debounced). Nothing else leaves the browser, and there is **no database**.
- To sync more keys, extend `getLocalData()`/`mergeData()` in `app.js`/`gsync.js`.

---

## 8. Serverless API reference

All three live in `api/`, run on Vercel's Node runtime, only read public endpoints, add a
`User-Agent`, set `Cache-Control`, and **degrade honestly** (never fabricate).

| Endpoint | Query | Returns |
|---|---|---|
| `GET /api/history` | `symbol` (RELIANCE / 500325 / ^NSEI / RELIANCE.NS), `range`, `interval` | Yahoo v8/chart JSON (passthrough) |
| `GET /api/quote` | `symbol` | `{available:true, valuation, profitability, growth, health, …}` or `{available:false, reason}` |
| `GET /api/search` | `q` | `{ quotes: [...] }` (Yahoo symbol search passthrough) |
| `GET /api/movers` | `symbols` (comma-separated `.NS`/`.BO` list) | `{available:true, quotes:[{symbol, price, changePct, volume, avgVolume, high52, low52, marketCap}]}` or `{available:false, reason}` — the home page derives gainers/losers/most-active(value&volume)/shockers/most-valuable/near-52w-high/low/sectors/breadth from this |
| `GET /api/financials` | `symbol` | `{available:true, annual:{income,balance,cash}, quarterly:{…}, earnings:{yearly,quarterly}}` or `{available:false, reason}` — P&L/BS/CF line items per period (lazy, Financials tab) |
| `GET /api/peers` | `symbols` (≤8, comma-separated) | `{available:true, peers:[{symbol, name, valuation, profitability, growth, health}]}` or `{available:false, reason}` — batch fundamentals for the peer table (lazy, Peers tab) |

`api/quote.js` performs Yahoo's cookie→crumb handshake; Yahoo changes this periodically,
so it may return `available:false` — that's expected and handled.

---

## 9. Design system & theming

- **Tokens** live on `:root` in `css/styles.css` (light is the bare default). Dark theme
  is defined twice: under `@media (prefers-color-scheme: dark)` guarded by
  `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]` so the manual
  toggle wins both ways.
- The toggle is in `app.js` → `setupChrome()`; it stores `sa_theme` in localStorage, and
  a tiny inline script in `index.html` applies it before paint (no flash).
- Type: **Sora** (display), **Inter** (text), **JetBrains Mono** (all figures/tickers —
  use the `.mono` class or the elements already wired).
- Palette identity: emerald/mint brand (green = growth), warm gold as the "signal"
  accent, coral for downside, on a carbon background.

---

## 10. Accessibility

Preserve these when editing (the test suite checks them):
- **Skip link**, semantic landmarks (`header`/`main`/`footer`), `aria-live` on `#result`.
- **Search** is an ARIA combobox (`aria-expanded`, `role="listbox"`/`option`).
- **Tabs** are an ARIA tablist with roving `tabindex`, `aria-selected`, and Arrow/Home/End
  keyboard support (`wireTabs()`).
- **Icon-only buttons** (theme toggle, watchlist, delete) must keep `aria-label`s.
- The score gauge SVG has an accessible `aria-label` with the numeric score.
- `prefers-reduced-motion` disables animations — don't add motion that ignores it.
- Keep colour contrast AA in both themes.

---

## 11. Testing

```bash
cd tests
npm install     # Playwright + axe-core + Chart.js; downloads Chromium (postinstall)
npm test        # 97 checks; non-zero exit on failure
# or, with a pre-installed browser:
PW_EXECUTABLE=/path/to/chrome npm test
```
The suite (`tests/run.cjs`) serves the app locally and **mocks** the network (Yahoo /
`/api` + Chart.js) so it exercises the real app offline, then runs axe-core.

**To add a check:** open `tests/run.cjs`, use the `check(name, condition, extraOnFail)`
helper inside the relevant scenario. To add a scenario, copy an existing `makeContext(...)`
block and set flags (`histFail`, `bseOnly`, `noFund`) — see the top of the file.

---

## 12. Deployment

### Vercel (recommended — enables `/api`)
Import the repo → **Root Directory = the folder containing `index.html`** → Framework
**Other**, no build command → Deploy. Functions appear at `/api/history|quote|search`.
`.vercelignore` keeps `tests/` and `node_modules` out of the build.

### Static (GitHub Pages, Netlify drop, etc.)
Upload the files as-is. Everything works except the `/api`-backed fundamentals (they show
as unavailable), and price data goes through public CORS relays.

**Never commit secrets.** If you add a keyed vendor, put the key in Vercel env vars and
read it only inside `api/*` (server-side).

---

## 13. Troubleshooting / FAQ

- **"Could not load data" for a valid stock.** The data source may be rate-limited, or
  Yahoo may not cover that ticker. In static mode, public relays are flaky — deploy on
  Vercel for reliability.
- **Fundamentals show "unavailable" on Vercel.** Yahoo changed its crumb handshake;
  check `api/quote.js`. This is expected to break occasionally — a licensed feed fixes it.
- **Every stock reads WATCH/HOLD.** You're likely in static mode (no fundamentals →
  dataQuality < 45 → the override caps the rating). Deploy `/api` to lift it.
- **Charts don't render.** Chart.js CDN blocked; check the `<script>` tag / network.
- **Console self-test failed.** A maths change broke an invariant — see the failing check
  logged by `_selfTest()` in `indicators.js`.

---

## 14. Glossary

- **NSE/BSE** — India's two main exchanges. Yahoo suffixes: `.NS` (NSE), `.BO` (BSE).
- **Adjusted close** — price adjusted for splits/dividends; used for all returns/indicators.
- **Beta** — sensitivity to the benchmark (NIFTY 50).
- **Data quality** — % of the intended scoring weight that could actually be computed.
- **Confidence** — how much to trust the score given data completeness (capped).
- **Red flag** — a risk indicator; "critical" ones cap the rating.

---

## 15. Known limitations & roadmap

**Limitations**
- Coverage is bounded by the data vendor (Yahoo) for any given ticker.
- News, promoter/FII/DII ownership, and backtesting are not implemented (stubs).
- Fundamentals depend on Yahoo's fragile crumb endpoint.

**Roadmap ideas** (each is a self-contained task)
- `api/news.js` + sentiment → light up the News tab and its 5% weight.
- Ownership data from NSE/BSE filings → Ownership tab + weight.
- A point-in-time **backtesting** engine (avoid look-ahead / survivorship bias).
- Stock comparison (up to 5) and a portfolio view (both sketched in the original spec).
- Swap the data layer to a licensed feed for reliability.

---

*Keep this document in sync with the code. When you change weights, bands, files, or
endpoints, update the matching section here and in `README.md`.*
