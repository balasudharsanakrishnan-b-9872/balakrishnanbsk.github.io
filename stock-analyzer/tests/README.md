# Tests — BSK Stock Analyser

Automated **functional + accessibility** tests. They run fully offline: a tiny local
server hosts the app, and the network layer (Yahoo / `/api` responses + Chart.js) is
**mocked** via Playwright request interception, so the real app code
(`search → fetch → analyse → render → charts → watchlist`) is exercised end-to-end
without hitting any external API. An axe-core audit checks accessibility.

## Run

```bash
cd tests
npm install     # installs Playwright + axe-core + Chart.js, and downloads Chromium
npm test
```

If you already have a Chromium build and want to skip the download, point at it:

```bash
PW_EXECUTABLE=/path/to/chrome npm test
```

`npm test` exits non-zero if any check fails, so it works in CI.

## What it covers (95 checks)

- **Search** — live dropdown, NSE/BSE dual-listing disambiguation, combobox ARIA,
  **arrow-key + Enter keyboard nav**, and the **no-match "analyze directly"** path
- **Home** — 8 mover screens, market breadth, open/closed badge, refresh, sector heatmap,
  indices, live-price watchlist, **"Show all" dialog**, row → analysis, unavailable state
- **Financials / Peers** — statement tables + annual/quarterly toggle; peer table with
  best-in-column + rank; both **unavailable** states
- **Google sign-in** — hidden when unconfigured; mocked end-to-end (sign-in → merge →
  push → sign-out); `mergeData` unit
- **Unit (deterministic core)** — SMA / RSI / CAGR / max-drawdown / beta / Sharpe; the
  full **decision-band ladder** + critical & low-data-quality **overrides**; red-flag
  detection; score **re-normalization**; **ticker resolution** (NSE/BSE/index/`&`, altYahoo)
- **Verdict** — score gauge, rating, ₹ price, stat tiles, data-quality
- **Overview / Score / Technical / Risk / Fundamentals / Audit** tabs render with real
  computed values; score-table total matches the gauge
- **Charts** — real Chart.js instances (price / volume / RSI) + range switching
- **Watchlist** — add / persist across reload / remove
- **Theme** — toggle + persistence
- **BSE fallback** — `.NS` miss auto-resolves to `.BO`
- **Error path** — fetch failure shows an error, never fabricated data
- **Fundamentals unavailable** — shown as unavailable; data-quality drops
- **Accessibility** — axe-core (no serious/critical violations) on landing + dashboard;
  keyboard tab navigation
- **No uncaught console / page errors** across the whole run

> These tests are excluded from the Vercel deployment via `../.vercelignore`.
