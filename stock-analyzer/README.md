# Indian Equity Analyzer

A **data-driven Indian (NSE) equity research & investment decision-support tool** — not a
"stock prediction" gimmick. It fetches live price history, computes technical / trend /
risk metrics deterministically, and produces a **transparent, weighted score** with an
explicit decision, confidence and data-quality reading.

🔗 **Live (once merged & Pages is enabled):** `https://balakrishnanbsk.github.io/stock-analyzer/`

> ⚠️ **Not investment advice.** Every output is a quantitative analytical signal from
> publicly available, **delayed** data. It is not a prediction of future returns and not a
> guarantee of any outcome.

---

## Honest scope (read this first)

This app is hosted on **GitHub Pages**, which is **static hosting only** — there is no
server we control. That single fact defines what is and isn't possible, and the app is
built to be honest about it rather than fake the rest.

### What actually works (client-side)
- **Search** across a curated NSE universe (symbol / name / industry).
- **Live price & volume history** from Yahoo Finance (`v8/chart`, delayed), fetched
  through public CORS relays with automatic fallback.
- **Technical analysis** — SMA 20/50/100/200, EMA 20/50, RSI 14, MACD, Bollinger Bands,
  ATR, ADX, volume signals, 52-week high/low, golden/death cross.
- **Multi-timeframe trend** (short / medium / long) and **strength**.
- **Price & performance** — returns for 1W…5Y, CAGR, and CAGR over actual elapsed time.
- **Risk** — annualized volatility, downside volatility, max drawdown, Sharpe, beta vs
  NIFTY 50, and a 0–100 risk score.
- **Relative strength** vs NIFTY 50 (3M/6M/1Y).
- **Transparent scoring engine** with a **decision engine**, **red-flag engine**,
  **confidence** and **data-quality** scores.
- **Watchlist** (localStorage).
- **Interactive charts** (price + SMAs, volume, RSI) with 1M…MAX ranges.

### What is deliberately marked "unavailable" (needs a backend)
Fundamentals, valuation ratios, growth quality, financial health, promoter/FII/DII
ownership, news & sentiment, and backtesting **are not reliably reachable from a
browser-only client** (no CORS-friendly free source for Indian fundamentals; official
portals block cross-origin access; news/backtesting need server-side aggregation and API
keys). Rather than invent numbers, the app shows these sections as **unavailable** and
lowers the **data-quality** and **confidence** scores accordingly.

Because a price-only build covers only ~20% of the intended scoring weight, the decision
engine **caps the rating at WATCH/HOLD** — it will never issue a STRONG BUY on partial
data. This is intentional (spec §19, §23–24): honesty over false precision.

---

## The "never fabricate" contract

These rules are enforced in code, not just documented:

1. **No fabricated data.** A failed fetch renders an error, never a guessed value
   (`providers.js`, `app.js:showError`).
2. **Never presented as real-time.** Yahoo India data is delayed; every panel shows the
   data timestamp and source relay (`app.js:renderAll`, `renderAudit`).
3. **Deterministic math.** All indicators/ratios are computed in `indicators.js` in plain,
   testable code — never by an LLM (spec §31). A console self-test (`_selfTest`) guards it.
4. **Missing ≠ clean.** The red-flag engine lists checks it *cannot* run so the absence of
   a flag is never misread as a clean bill of health (spec §36.13).
5. **Transparent scoring.** The overall score is a labeled sum of sub-scores × weights;
   weights re-normalize over only what could be computed, and the breakdown is fully shown.

---

## Architecture

```
index.html ── css/styles.css
     │
     └── js/ (ES modules, no build step)
         ├── stocks.js       search universe, sector map, Yahoo ticker mapping
         ├── providers.js    MarketDataProvider abstraction + CORS-relay fallback + cache
         ├── indicators.js   deterministic math (SMA/EMA/RSI/MACD/ATR/ADX/beta/…) + self-test
         ├── analysis.js     technical/trend/risk + scoring engine + decision + red flags
         ├── charts.js       Chart.js wrappers (price/volume/RSI/score)
         └── app.js          orchestration + rendering + watchlist
```

Data flow: **providers → analysis (deterministic) → view**. The layers are intentionally
separated so the data source can be swapped for a real backend without touching the math.

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

`Overall = Σ (sub-score × effective weight)`, where effective weights are re-normalized
across the components that could actually be computed.

### Decision bands
`85–100 STRONG BUY · 75–84 BUY · 60–74 WATCH/HOLD · 45–59 AVOID · 0–44 STRONG AVOID`,
with **overrides**: critical red flags cap the rating at AVOID, and low data quality caps
it at WATCH/HOLD.

---

## Backend extension points (to unlock the rest of the spec)

The provider functions `getFundamentals`, `getNews`, `getOwnership` in `providers.js`
currently return `{ available: false, reason }`. To make them real, put a small backend in
front and repoint these functions at it:

```
Frontend (this app)
   └── /api  (your backend — e.g. FastAPI)
          ├── /fundamentals   ← Alpha Vantage / FMP / official filings (API keys server-side)
          ├── /news           ← news API / RSS aggregation + sentiment
          ├── /ownership      ← NSE/BSE shareholding filings
          └── /backtest       ← point-in-time engine (avoid look-ahead/survivorship bias)
```

The scoring engine already handles these gracefully: once a provider returns real scores,
its weight stops being re-normalized away and data-quality/confidence rise automatically.
No other change is required.

---

## Run locally

ES modules require a server (not `file://`):

```bash
cd stock-analyzer
python3 -m http.server 8000
# open http://localhost:8000/
```

Open the browser console to see the indicator self-test result on load.

## Enable GitHub Pages

The repository root (`../index.html`) is the owner's résumé and is left untouched. This
tool lives entirely under `/stock-analyzer/`. Once this branch is merged into the Pages
branch, the tool is served at `…/stock-analyzer/`.

## Notes & limitations

- Public CORS relays are third-party and occasionally rate-limited or down; a fetch may
  need a retry. A real deployment should proxy Yahoo (or a licensed feed) from its own
  backend to remove this dependency.
- The stock universe in `stocks.js` is a curated sample across sectors and market caps for
  demonstration and testing — extend the list as needed; any valid `.NS` symbol can be
  analyzed by typing it directly.
