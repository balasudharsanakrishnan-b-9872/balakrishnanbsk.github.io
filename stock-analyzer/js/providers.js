// providers.js — MarketDataProvider abstraction with automatic fallback (spec §2, §34).
//
// HONESTY / SAFETY NOTES (these are load-bearing, not decoration):
//  * GitHub Pages is static hosting: there is no server we control. All fetches happen
//    from the user's browser.
//  * Browsers block cross-origin calls to NSE/BSE/Yahoo unless the host sends CORS
//    headers. Yahoo's chart endpoint does not, so we route through public CORS relays
//    and try each in turn. This is a best-effort *demo* path. If every relay fails we
//    surface "data unavailable" — we NEVER fabricate a price or ratio (spec §36.1).
//  * We only read public quote/history endpoints. We do not bypass auth, CAPTCHAs, or
//    paywalls, and we do not claim data is real-time — Yahoo India data is typically
//    delayed; every panel shows the source and the data timestamp (spec §36.3-5).
//
// Fundamentals/ownership/news for Indian names are generally NOT reachable from a
// pure browser client without an API key + backend. Those providers are declared here
// as extension points and return {available:false, reason} so the UI can be honest.

import { toYahoo } from './stocks.js';

// Public CORS relays, tried in order. Each takes an encoded target URL.
const CORS_RELAYS = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
];

const CACHE_TTL = {
  history: 15 * 60 * 1000, // 15 min — price history
  quote: 5 * 60 * 1000,    // 5 min — latest quote
};

// simple in-memory + localStorage cache to respect rate limits (spec §33)
const mem = new Map();
function cacheGet(key, ttl) {
  const m = mem.get(key);
  if (m && Date.now() - m.t < ttl) return m.v;
  try {
    const raw = localStorage.getItem('sa_cache_' + key);
    if (raw) {
      const o = JSON.parse(raw);
      if (Date.now() - o.t < ttl) { mem.set(key, o); return o.v; }
    }
  } catch (_) {}
  return null;
}
function cacheSet(key, v) {
  const o = { t: Date.now(), v };
  mem.set(key, o);
  try { localStorage.setItem('sa_cache_' + key, JSON.stringify(o)); } catch (_) {}
}

async function fetchJSONviaRelays(targetUrl, timeoutMs = 12000) {
  let lastErr = null;
  for (const relay of CORS_RELAYS) {
    const url = relay(targetUrl);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status + ' via ' + hostOf(url)); continue; }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (_) { lastErr = new Error('non-JSON via ' + hostOf(url)); continue; }
      return { json, relay: hostOf(url) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all relays failed');
}

const hostOf = (u) => { try { return new URL(u).host; } catch (_) { return u; } };

// ---------- Yahoo Finance history + quote (chart endpoint) ----------
// range: 1mo,3mo,6mo,1y,2y,5y,10y,max ; interval: 1d
export async function getHistory(nseSymbol, range = '5y', interval = '1d') {
  const ykey = toYahoo(nseSymbol);
  const cacheKey = `hist_${ykey}_${range}_${interval}`;
  const cached = cacheGet(cacheKey, CACHE_TTL.history);
  if (cached) return { ...cached, cached: true };

  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${ykey}?range=${range}&interval=${interval}`;
  const { json, relay } = await fetchJSONviaRelays(target);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No chart data returned for ' + nseSymbol);

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || null;
  const meta = result.meta || {};

  // Build clean, split/dividend-adjusted OHLCV arrays; drop null bars (spec §36.16-17).
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null) continue; // missing bar — skip, do not interpolate
    bars.push({
      t: ts[i] * 1000,
      o: q.open?.[i] ?? null,
      h: q.high?.[i] ?? null,
      l: q.low?.[i] ?? null,
      c,
      adj: adj?.[i] ?? c,
      v: q.volume?.[i] ?? null,
    });
  }
  if (!bars.length) throw new Error('Empty series for ' + nseSymbol);

  const payload = {
    symbol: nseSymbol,
    yahoo: ykey,
    bars,
    meta: {
      currency: meta.currency || 'INR',
      exchange: meta.exchangeName || meta.fullExchangeName || 'NSE',
      instrumentType: meta.instrumentType,
      regularMarketPrice: meta.regularMarketPrice ?? null,
      previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      regularMarketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    },
    source: 'Yahoo Finance (v8/chart)',
    via: relay,
    fetchedAt: Date.now(),
  };
  cacheSet(cacheKey, payload);
  return payload;
}

// ---------- Fundamentals / ownership / news: declared, honestly unavailable client-side ----------
// These are the extension seams described in the spec's provider layer. In a real
// deployment they'd be served by a backend holding API keys (Alpha Vantage, FMP, etc.).
export async function getFundamentals(nseSymbol) {
  return {
    available: false,
    reason:
      'Fundamental statements & ratios for Indian equities are not reliably reachable ' +
      'from a browser-only client (no CORS-friendly free source; official portals block ' +
      'cross-origin access). This needs a backend with API keys — see README "Backend ' +
      'extension points". No values are fabricated here.',
    fields: [
      'PE', 'PB', 'EV/EBITDA', 'ROE', 'ROCE', 'Debt/Equity', 'Revenue/Profit growth',
      'Free cash flow', 'Promoter holding & pledge', 'Dividend yield',
    ],
  };
}

export async function getNews(nseSymbol) {
  return {
    available: false,
    reason:
      'Company news requires a news API / RSS aggregation on a backend. Not fetched ' +
      'client-side to avoid CORS-scraping and to honor source terms. No headlines are invented.',
  };
}

export async function getOwnership(nseSymbol) {
  return {
    available: false,
    reason:
      'Shareholding-pattern (promoter/FII/DII) data comes from NSE/BSE filings that are ' +
      'not CORS-accessible. Requires a backend. No holdings are invented.',
  };
}

// Human-readable relay/proxy status for the UI footer.
export function relayNames() {
  return CORS_RELAYS.map((r) => hostOf(r('https://x/')));
}
