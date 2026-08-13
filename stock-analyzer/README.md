# Indian Equity Analyzer

A **data-driven Indian (NSE) equity research & investment decision-support tool** — not a
"stock prediction" gimmick. It fetches live price history **and fundamentals**, computes
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
- **Search** across a curated NSE universe (symbol / name / industry) + any `.NS` symbol.
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
- **Transparent scoring** + decision engine + red-flag engine + confidence & data-quality.
- **Watchlist** (localStorage) and **interactive charts**.

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
│   ├── stocks.js       search universe, sector map, Yahoo ticker mapping
│   ├── providers.js    provider layer: tries /api first, falls back to CORS relays + cache
│   ├── indicators.js   deterministic math (+ self-test)
│   ├── analysis.js     technical/trend/risk + fundamental scorers + decision + red flags
│   ├── charts.js       Chart.js wrappers
│   └── app.js          orchestration + rendering + watchlist
├── api/                Vercel serverless functions (Node)
│   ├── history.js      server proxy → Yahoo v8/chart (kills the CORS-relay dependency)
│   └── quote.js        server proxy → Yahoo quoteSummary (fundamentals, crumb handshake)
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
with overrides: critical red flags cap at AVOID; low data quality caps at WATCH/HOLD.

---

## Run locally
```bash
cd stock-analyzer
npx vercel dev      # runs the static site AND the /api functions locally
# or, static-only (fundamentals will show unavailable):
python3 -m http.server 8000
```
Open the browser console to see the indicator self-test on load.

## Notes & limitations
- Yahoo’s fundamentals (crumb) handshake changes often; `api/quote.js` degrades honestly to
  “unavailable” when it breaks. A licensed feed (Alpha Vantage / FMP / vendor) removes the
  fragility — repoint `api/quote.js` at it and the scoring engine picks it up automatically.
- The universe in `stocks.js` is a curated cross-sector sample; extend as needed — any valid
  `.NS` symbol can be analyzed by typing it directly.
