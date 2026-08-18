# BSK Stock Analyser — Indian Equity Intelligence

**BSK Stock Analyser** is a **data-driven Indian (NSE & BSE) equity research & investment
decision-support tool** — not a "stock prediction" gimmick.

The UI is a bespoke design system (custom logo + hand-built SVG icon set, no emoji;
Sora / Inter / JetBrains Mono type; emerald-on-carbon palette with a gold signal accent),
with **light & dark themes**, a **circular score gauge**, and full **keyboard + screen-reader
accessibility** (ARIA tabs/combobox, skip link, reduced-motion support). Verified with an
automated Playwright + axe-core audit: **0 accessibility violations** across landing and
dashboard in both themes, responsive at 375 / 768 / 1280 px. It fetches live price history **and fundamentals**, computes
technical / trend / risk / valuation metrics deterministically, and produces a
**transparent, weighted score** with an explicit decision, confidence and data-quality
reading.

> ⚠️ **Not investment advice.** Every output is a quantitative analytical signal from
> publicly available, **delayed** data. It is not a prediction of future returns and not a
> guarantee of any outcome.

---

## Deploy on Vercel (recommended)

This project is Vercel-ready: static frontend + serverless functions in `api/`. The
functions proxy Yahoo Finance **server-side**, which removes the browser-CORS problem and
**unlocks fundamentals** (P/E, P/B, ROE, margins, debt, cash flow, growth).

### Option A — import the GitHub repo (no CLI)
1. Push this branch and go to **vercel.com → Add New → Project → Import** your repo
   `balakrishnanbsk.github.io`.
2. **Set “Root Directory” to `stock-analyzer`.** ← important: the repo root is a résumé;
   the tool lives in this subfolder.
3. Framework Preset: **Other**. No build command, no install step needed.
4. Deploy. Your app is served at `https://<project>.vercel.app/`, with the functions at
   `/api/history` and `/api/quote`.

### Option B — Vercel CLI
```bash
cd stock-analyzer
npx vercel          # first run links/creates the project (asks you to log in)
npx vercel --prod   # production deploy
```
(Deploying requires logging into *your* Vercel account — it can't be done unattended.)

Everything still works on plain static hosting too (e.g. GitHub Pages): without the `/api`
functions the app falls back to public CORS relays for price data, and fundamentals show
as **unavailable** rather than being invented.

---

## Honest scope (read this first)

The app is built to be honest about what it can and can't know.

### What works on Vercel (with the `/api` functions)
- **Markets home page** — on load, a dashboard computed from the tracked universe via
  `/api/movers`: **top gainers, top losers, most-active (by value & by volume), volume
  shockers, most valuable (by m-cap), near 52-week high / low, trending sectors**, a
  **market-breadth** bar (advances vs declines), a **market open/closed** badge, a NIFTY 50
  / SENSEX strip and a **refresh** button. The **watchlist shows live prices** here. Click
  any row to analyse that stock; click the logo to return. (Honest "unavailable" card on
  static hosting.)
- **Search by company name** (live) — type "reliance", "hdfc", "infosys" and pick from real
  listed matches via `/api/search` (Yahoo symbol directory), each tagged **NSE** or **BSE**
  so same-name dual listings are disambiguated by what you click. You can still type an exact
  NSE symbol or BSE scrip code (`500325`) directly; NSE is tried first with an automatic BSE
  fallback. No memorizing or copy-pasting codes.
- **Live price & volume history** via `/api/history` (Yahoo Finance, delayed).
- **Technical analysis** — SMA 20/50/100/200, EMA 20/50, RSI 14, MACD, Bollinger, ATR,
  ADX, volume signals, 52-week high/low, golden/death cross.
- **Multi-timeframe trend** and strength.
- **Price & performance** — returns 1W…5Y, CAGR over actual elapsed time.
- **Risk** — annualized & downside volatility, max drawdown, Sharpe, beta vs NIFTY 50,
  0–100 risk score.
- **Relative strength** vs NIFTY 50 (3M/6M/1Y).
- **Fundamentals** via `/api/quote` — valuation (P/E, forward P/E, P/B, PEG, P/S,
  EV/EBITDA, dividend yield, market cap), profitability (ROE, ROA, margins), growth
  (revenue/earnings), financial health (D/E, current ratio, cash vs debt, FCF).
- **Financials** via `/api/financials` — Profit & Loss, Balance Sheet and Cash Flow
  (annual **and** quarterly, ~4 periods) with a revenue/profit trend chart. Lazy-loaded
  when the Financials tab is opened.
- **Peer comparison** via `/api/peers` — same-sector peers compared on growth, ROE,
  margin, D/E, P/E, EV/EBITDA, dividend yield, with best-in-column highlights and a
  composite peer **rank**.
- **Transparent scoring** + decision engine + red-flag engine + confidence & data-quality.
- **Watchlist** (localStorage) and **interactive charts**.
- **Optional Google sign-in + sync** — sign in with Google to sync your watchlist &
  theme to your *own* Google Drive (hidden app-data folder). **No database, no client
  secret.** Disabled until you add a Google OAuth **Web client ID** in `js/config.js`
  (see the setup steps in that file); the app works fully without it.

### Still marked "unavailable" (need further integrations)
- **News & sentiment** — needs a news API / RSS aggregation on the backend.
- **Promoter / FII / DII ownership** — from NSE/BSE shareholding filings.
- **Backtesting** — needs a point-in-time engine (avoiding look-ahead/survivorship bias).

These render as **unavailable** and lower the data-quality/confidence scores instead of
being fabricated.

---

## The "never fabricate" contract (enforced in code)

1. **No fabricated data** — a failed fetch renders an error, never a guessed value.
2. **Never presented as real-time** — Yahoo India data is delayed; timestamps + source are
   shown on every panel.
3. **Deterministic math** — all indicators/ratios computed in `indicators.js`/`analysis.js`
   in plain, testable code, never by an LLM (spec §31). A console self-test guards it.
4. **Missing ≠ clean** — the red-flag engine lists checks it *cannot* run.
5. **Transparent scoring** — weights re-normalize over only the components that could be
   computed; the full breakdown is shown; low coverage caps the rating at WATCH/HOLD.

---

## Architecture

```
stock-analyzer/
├── index.html · css/styles.css        static frontend (no build step)
├── js/
│   ├── stocks.js       search universe, sector map, NSE/BSE ticker resolution
│   ├── providers.js    provider layer: tries /api first, falls back to CORS relays + cache
│   ├── indicators.js   deterministic math (+ self-test)
│   ├── analysis.js     technical/trend/risk + fundamental scorers + decision + red flags
│   ├── charts.js       Chart.js wrappers
│   ├── icons.js        hand-built SVG icon set + brand logo mark + favicon
│   ├── config.js       GOOGLE_CLIENT_ID (optional Google sign-in) + setup notes
│   ├── gsync.js        optional Google sign-in + sync to the user's Google Drive
│   └── app.js          orchestration + rendering + theming + a11y + watchlist
├── api/                Vercel serverless functions (Node)
│   ├── history.js      server proxy → Yahoo v8/chart (kills the CORS-relay dependency)
│   ├── quote.js        server proxy → Yahoo quoteSummary (fundamentals, crumb handshake)
│   ├── search.js       server proxy → Yahoo symbol search (search by company name)
│   ├── movers.js       server proxy → Yahoo v7/quote batch (home-page market movers)
│   ├── financials.js   server proxy → Yahoo fundamentals-timeseries (+quoteSummary fallback)
│   └── peers.js        server proxy → batch quoteSummary (peer comparison)
└── vercel.json
```

Data flow: **providers → analysis (deterministic) → view**. Layers are separated so the
data source can be swapped for a licensed feed without touching the math.

### Scoring model (configurable weights in `analysis.js`)
| Component | Base weight |
|---|---|
| Fundamentals | 25% |
| Growth quality | 15% |
| Financial health | 15% |
| Valuation | 15% |
| Technical trend | 10% |
| Relative strength | 5% |
| Management / ownership | 5% |
| News & events | 5% |
| Risk adjustment | 5% |

`Overall = Σ (sub-score × effective weight)`, with effective weights re-normalized across
the components that could actually be computed. Valuation is **sector-aware** (banks are
scored on P/B rather than P/E).

### Decision bands
`85–100 STRONG BUY · 75–84 BUY · 60–74 WATCH/HOLD · 45–59 AVOID · 0–44 STRONG AVOID`,
with overrides: critical red flags cap at AVOID; low data quality forces a NEUTRAL WATCH/HOLD (both directions — no AVOID/BUY on thin data).

---

## Run locally
```bash
cd stock-analyzer
npx vercel dev      # runs the static site AND the /api functions locally
# or, static-only (fundamentals will show unavailable):
python3 -m http.server 8000
```
Open the browser console to see the indicator self-test on load.

## Documentation

Full maintainer & developer guide — architecture, a file-by-file reference, the scoring
engine, and step-by-step "how to change X" recipes — is in
**[DOCUMENTATION.md](DOCUMENTATION.md)**. Read that before making changes.

## Tests

A functional + accessibility suite lives in [`tests/`](tests/). It runs **offline** —
it serves the app locally and mocks the network layer (Yahoo / `/api` + Chart.js) with
Playwright, then drives the real app end-to-end and runs an axe-core audit.

```bash
cd tests && npm install && npm test   # 97 checks; exits non-zero on failure
```

Covers search, the full analysis render, all tabs, charts, watchlist & theme persistence,
BSE fallback, the error path (no fabricated data), and accessibility. Excluded from the
Vercel deployment via `.vercelignore`.

## Notes & limitations
- Yahoo’s fundamentals (crumb) handshake changes often; `api/quote.js` degrades honestly to
  “unavailable” when it breaks. A licensed feed (Alpha Vantage / FMP / vendor) removes the
  fragility — repoint `api/quote.js` at it and the scoring engine picks it up automatically.
- `stocks.js` holds only a curated shortlist for autocomplete convenience — it is **not** the
  limit of what can be analyzed. Any valid NSE symbol or BSE scrip code can be typed directly
  (`toYahoo`/`altYahoo` resolve NSE `.NS` with a BSE `.BO` fallback). Yahoo Finance coverage
  of the specific ticker is the only real constraint.
