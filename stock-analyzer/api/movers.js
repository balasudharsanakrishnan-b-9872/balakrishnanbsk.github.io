// api/movers.js — Vercel serverless function.
// Batch-quote a universe of NSE symbols (server-side, via Yahoo v7/quote with the
// cookie+crumb handshake) so the home page can compute gainers / losers / most-active /
// volume-shockers / sector trends. The screens are derived by the FRONTEND from this raw
// quote list — this function only fetches, it does not rank. Degrades honestly: on any
// failure it returns {available:false, reason} and never fabricates a quote.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// Fallback universe if the client sends none (kept small; the client normally sends its own).
const DEFAULT = ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS', 'ITC.NS', 'BHARTIARTL.NS', 'LT.NS', 'TATAMOTORS.NS'];

async function getCrumb() {
  const c = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  let cookie = typeof c.headers.getSetCookie === 'function' ? c.headers.getSetCookie().join('; ') : (c.headers.get('set-cookie') || '');
  cookie = cookie.split(/,(?=[^ ;]+=)/).map((p) => p.split(';')[0].trim()).filter(Boolean).join('; ');
  if (!cookie) throw new Error('no cookie from Yahoo');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/plain' } });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.length > 40 || /error|invalid|<\/?html/i.test(crumb)) throw new Error('crumb rejected');
  return { cookie, crumb };
}
const num = (v) => (typeof v === 'number' ? v : v && v.raw != null ? v.raw : null);

module.exports = async (req, res) => {
  try {
    const raw = String((req.query && req.query.symbols) || '').trim();
    const symbols = (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT).slice(0, 150);
    const { cookie, crumb } = await getCrumb();
    const url =
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}` +
      `&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
    if (!r.ok) return res.status(200).json({ available: false, reason: `Yahoo quote ${r.status}` });
    const j = await r.json();
    const list = (j?.quoteResponse?.result || []).map((q) => ({
      symbol: String(q.symbol || '').replace(/\.(NS|BO)$/i, ''),
      yahoo: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: num(q.regularMarketPrice),
      change: num(q.regularMarketChange),
      changePct: num(q.regularMarketChangePercent),
      volume: num(q.regularMarketVolume),
      avgVolume: num(q.averageDailyVolume3Month) ?? num(q.averageDailyVolume10Day),
      high52: num(q.fiftyTwoWeekHigh),
      low52: num(q.fiftyTwoWeekLow),
      marketCap: num(q.marketCap),
    })).filter((x) => x.price != null);
    if (!list.length) return res.status(200).json({ available: false, reason: 'no quotes returned' });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ available: true, asOf: Date.now(), source: 'Yahoo Finance v7/quote (server proxy)', quotes: list });
  } catch (e) {
    return res.status(200).json({ available: false, reason: 'movers fetch failed (' + ((e && e.message) || e) + ')' });
  }
};
