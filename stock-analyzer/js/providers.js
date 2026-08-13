// providers.js — MarketDataProvider abstraction with automatic fallback (spec §2, §34).
//
// TWO RUNTIME MODES, chosen automatically:
//  1. On Vercel (or any host with the /api serverless functions) the browser calls our
//     OWN endpoints — /api/history and /api/quote — which proxy Yahoo Finance server-side.
//     No browser CORS problem, no public relays, and fundamentals become available.
//  2. On plain static hosting (e.g. GitHub Pages) /api/* returns 404, so we fall back to
//     public CORS relays for price history; fundamentals stay honestly "unavailable".
//
// HONESTY / SAFETY (load-bearing, not decoration):
//  * We only read public quote/history endpoints; we don't bypass auth/CAPTCHAs/paywalls.
//  * Data is delayed (Yahoo India), never presented as real-time; timestamps are shown.
//  * On any failure we surface an error — we NEVER fabricate a price or ratio (spec §36.1).

import { toYahoo } from './stocks.js';

// Public CORS relays (fallback path only), tried in order.
const CORS_RELAYS = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
];

const CACHE_TTL = { history: 15 * 60 * 1000, quote: 60 * 60 * 1000 };

// simple in-memory + localStorage cache to respect rate limits (spec §33)
const mem = new Map();
function cacheGet(key, ttl) {
  const m = mem.get(key);
  if (m && Date.now() - m.t < ttl) return m.v;
  try {
    const raw = localStorage.getItem('sa_cache_' + key);
    if (raw) { const o = JSON.parse(raw); if (Date.now() - o.t < ttl) { mem.set(key, o); return o.v; } }
  } catch (_) {}
  return null;
}
function cacheSet(key, v) {
  const o = { t: Date.now(), v };
  mem.set(key, o);
  try { localStorage.setItem('sa_cache_' + key, JSON.stringify(o)); } catch (_) {}
}

const hostOf = (u) => { try { return new URL(u, location.origin).host; } catch (_) { return u; } };

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
      let json; try { json = JSON.parse(text); } catch (_) { lastErr = new Error('non-JSON via ' + hostOf(url)); continue; }
      return { json, via: hostOf(url) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all relays failed');
}

// Parse a Yahoo v8 chart JSON into our clean, split/dividend-adjusted payload.
function parseChart(nseSymbol, ykey, json, source, via) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No chart data returned for ' + nseSymbol);
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || null;
  const meta = result.meta || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null) continue; // missing bar — skip, do not interpolate (spec §36.16-19)
    bars.push({ t: ts[i] * 1000, o: q.open?.[i] ?? null, h: q.high?.[i] ?? null, l: q.low?.[i] ?? null, c, adj: adj?.[i] ?? c, v: q.volume?.[i] ?? null });
  }
  if (!bars.length) throw new Error('Empty series for ' + nseSymbol);
  return {
    symbol: nseSymbol, yahoo: ykey, bars,
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
    source, via, fetchedAt: Date.now(),
  };
}

// Try our own serverless proxy first; return null (not throw) if it isn't deployed.
async function tryLocalApi(path) {
  try {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, json: await res.json() };
  } catch (_) { return null; } // network/404 — API not present, caller falls back
}

// ---------- price history ----------
export async function getHistory(nseSymbol, range = '5y', interval = '1d') {
  const ykey = toYahoo(nseSymbol);
  const cacheKey = `hist_${ykey}_${range}_${interval}`;
  const cached = cacheGet(cacheKey, CACHE_TTL.history);
  if (cached) return { ...cached, cached: true };

  // Mode 1: our serverless proxy.
  const local = await tryLocalApi(`/api/history?symbol=${encodeURIComponent(nseSymbol)}&range=${range}&interval=${interval}`);
  if (local && local.ok && local.json?.chart) {
    const payload = parseChart(nseSymbol, ykey, local.json, 'Yahoo Finance (server proxy /api)', location.host);
    cacheSet(cacheKey, payload);
    return payload;
  }

  // Mode 2: public CORS relays on the direct Yahoo URL.
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${ykey}?range=${range}&interval=${interval}`;
  const { json, via } = await fetchJSONviaRelays(target);
  const payload = parseChart(nseSymbol, ykey, json, 'Yahoo Finance (v8/chart via public relay)', via);
  cacheSet(cacheKey, payload);
  return payload;
}

// Raw history for index tickers (^NSEI etc.) — used for benchmark.
export async function getIndexHistory(yahooTicker, name, range = '5y') {
  const cacheKey = `idx_${yahooTicker}_${range}`;
  const cached = cacheGet(cacheKey, CACHE_TTL.history);
  if (cached) return { ...cached, cached: true };
  const local = await tryLocalApi(`/api/history?symbol=${encodeURIComponent(yahooTicker)}&range=${range}&interval=1d`);
  let json, via;
  if (local && local.ok && local.json?.chart) { json = local.json; via = location.host; }
  else { const r = await fetchJSONviaRelays(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=${range}&interval=1d`); json = r.json; via = r.via; }
  const p = parseChart(name, yahooTicker, json, 'Yahoo Finance', via);
  const out = { name, bars: p.bars, source: p.source, via };
  cacheSet(cacheKey, out);
  return out;
}

// ---------- fundamentals ----------
// Available only via the serverless proxy (crumb handshake can't run in a browser).
export async function getFundamentals(nseSymbol) {
  const cacheKey = `fund_${nseSymbol}`;
  const cached = cacheGet(cacheKey, CACHE_TTL.quote);
  if (cached) return { ...cached, cached: true };

  const local = await tryLocalApi(`/api/quote?symbol=${encodeURIComponent(nseSymbol)}`);
  if (local && local.ok && local.json) {
    if (local.json.available) cacheSet(cacheKey, local.json);
    return local.json; // {available:true, ...} or {available:false, reason}
  }
  // No serverless backend (e.g. static hosting) — honest unavailable.
  return {
    available: false,
    reason:
      'Fundamentals require the server-side /api/quote function (present on the Vercel ' +
      'deployment). On static hosting the browser cannot perform Yahoo’s crumb handshake, ' +
      'so ratios are shown as unavailable rather than fabricated.',
    fields: ['P/E', 'P/B', 'PEG', 'EV/EBITDA', 'ROE', 'ROA', 'margins', 'Debt/Equity', 'FCF', 'Dividend yield', 'Revenue/Earnings growth'],
  };
}

export async function getNews() {
  return { available: false, reason: 'Company news requires a news API / RSS aggregation on the backend. Not fetched here to honor source terms. No headlines are invented.' };
}
export async function getOwnership() {
  return { available: false, reason: 'Shareholding-pattern (promoter/FII/DII) data comes from NSE/BSE filings that need a backend. No holdings are invented.' };
}

export function relayNames() { return CORS_RELAYS.map((r) => hostOf(r('https://x/'))); }
