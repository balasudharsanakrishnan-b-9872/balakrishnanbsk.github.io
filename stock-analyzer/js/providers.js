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

import { toYahoo, altYahoo } from './stocks.js';

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

// Fetch+parse one Yahoo chart for a fully-resolved RAW ticker (e.g. RELIANCE.NS, 500325.BO,
// ^NSEI). Tries our serverless proxy first, then public relays. Throws on failure.
async function fetchChart(displaySymbol, ticker, range, interval) {
  const enc = encodeURIComponent(ticker);
  const local = await tryLocalApi(`/api/history?symbol=${enc}&range=${range}&interval=${interval}`);
  if (local && local.ok && local.json?.chart?.result?.[0]) {
    return parseChart(displaySymbol, ticker, local.json, 'Yahoo Finance (server proxy /api)', location.host);
  }
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=${range}&interval=${interval}`;
  const { json, via } = await fetchJSONviaRelays(target);
  return parseChart(displaySymbol, ticker, json, 'Yahoo Finance (v8/chart via public relay)', via);
}

// ---------- price history (NSE with automatic BSE fallback) ----------
export async function getHistory(symbol, range = '5y', interval = '1d') {
  const primary = toYahoo(symbol);
  const alt = altYahoo(symbol);
  const cacheKey = `hist_${primary}_${range}_${interval}`;
  const cached = cacheGet(cacheKey, CACHE_TTL.history);
  if (cached) return { ...cached, cached: true };

  let payload, firstErr;
  try { payload = await fetchChart(symbol, primary, range, interval); }
  catch (e) {
    firstErr = e;
    if (!alt) throw e;
    payload = await fetchChart(symbol, alt, range, interval); // e.g. BSE-only listing
  }
  payload.exchange = payload.yahoo.endsWith('.BO') ? 'BSE' : payload.yahoo.endsWith('.NS') ? 'NSE' : payload.meta.exchange;
  cacheSet(cacheKey, payload);
  return payload;
}

// History for index tickers (^NSEI etc.) — used for benchmark.
export async function getIndexHistory(yahooTicker, name, range = '5y') {
  const ticker = decodeURIComponent(yahooTicker); // accept raw or pre-encoded
  const cacheKey = `idx_${ticker}_${range}`;
  const cached = cacheGet(cacheKey, CACHE_TTL.history);
  if (cached) return { ...cached, cached: true };
  const p = await fetchChart(name, ticker, range, '1d');
  const out = { name, bars: p.bars, source: p.source, via: p.via };
  cacheSet(cacheKey, out);
  return out;
}

// ---------- fundamentals ----------
// Available only via the serverless proxy (crumb handshake can't run in a browser).
export async function getFundamentals(nseSymbol) {
  const cacheKey = `fund_${nseSymbol}`;
  const cached = cacheGet(cacheKey, CACHE_TTL.quote);
  if (cached) return { ...cached, cached: true };

  const local = await tryLocalApi(`/api/quote?symbol=${encodeURIComponent(toYahoo(nseSymbol))}`);
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

// ---------- live symbol search (by company name or partial symbol) ----------
// Returns Indian (NSE/BSE) equity/ETF matches: { yahoo, s, name, exch }. Empty on failure
// (the UI still falls back to the local shortlist) — never invents tickers.
export async function searchSymbols(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  let quotes = [];
  try {
    const local = await tryLocalApi(`/api/search?q=${encodeURIComponent(q)}`);
    if (local && local.ok && Array.isArray(local.json?.quotes)) quotes = local.json.quotes;
    else {
      const { json } = await fetchJSONviaRelays(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&enableFuzzyQuery=true`,
      );
      quotes = json?.quotes || [];
    }
  } catch (_) { return []; }

  const out = [];
  const seen = new Set();
  for (const it of quotes) {
    const sym = String(it.symbol || '');
    if (!/\.(NS|BO)$/i.test(sym)) continue; // India only (NSE .NS / BSE .BO)
    if (it.quoteType && !['EQUITY', 'ETF'].includes(it.quoteType)) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push({
      yahoo: sym,
      s: sym.replace(/\.(NS|BO)$/i, ''),
      name: it.longname || it.shortname || sym,
      exch: /\.BO$/i.test(sym) ? 'BSE' : 'NSE',
    });
  }
  return out;
}

export function relayNames() { return CORS_RELAYS.map((r) => hostOf(r('https://x/'))); }
