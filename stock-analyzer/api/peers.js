// api/peers.js — Vercel serverless function.
// Fetches comparable fundamentals for a small set of sector peers (≤ 8 symbols) so the
// frontend can build a peer-comparison table + ranking. Uses one crumb for all symbols.
// Degrades honestly: symbols that fail are simply omitted; never fabricates a peer.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const MODULES = 'price,summaryDetail,defaultKeyStatistics,financialData';

async function getCrumb() {
  const c = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  let cookie = typeof c.headers.getSetCookie === 'function' ? c.headers.getSetCookie().join('; ') : (c.headers.get('set-cookie') || '');
  cookie = cookie.split(/,(?=[^ ;]+=)/).map((p) => p.split(';')[0].trim()).filter(Boolean).join('; ');
  if (!cookie) throw new Error('no cookie');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/plain' } });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.length > 40 || /error|invalid|<\/?html/i.test(crumb)) throw new Error('crumb rejected');
  return { cookie, crumb };
}
const num = (o) => (o && typeof o === 'object' && 'raw' in o ? o.raw : o == null ? null : typeof o === 'number' ? o : null);

async function fetchOne(ticker, cookie, crumb) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
    if (!r.ok) return null;
    const q = (await r.json())?.quoteSummary?.result?.[0];
    if (!q) return null;
    const sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {}, fd = q.financialData || {}, pr = q.price || {};
    return {
      symbol: String(ticker).replace(/\.(NS|BO)$/i, ''),
      name: pr.shortName || pr.longName || ticker,
      available: true,
      valuation: { trailingPE: num(sd.trailingPE) ?? num(ks.trailingPE), priceToBook: num(ks.priceToBook), pegRatio: num(ks.pegRatio), enterpriseToEbitda: num(ks.enterpriseToEbitda), dividendYield: num(sd.dividendYield), marketCap: num(pr.marketCap) ?? num(sd.marketCap) },
      profitability: { returnOnEquity: num(fd.returnOnEquity), returnOnAssets: num(fd.returnOnAssets), profitMargins: num(fd.profitMargins) ?? num(ks.profitMargins), operatingMargins: num(fd.operatingMargins) },
      growth: { revenueGrowth: num(fd.revenueGrowth), earningsGrowth: num(fd.earningsGrowth) },
      health: { debtToEquity: num(fd.debtToEquity), currentRatio: num(fd.currentRatio), freeCashflow: num(fd.freeCashflow), totalCash: num(fd.totalCash), totalDebt: num(fd.totalDebt) },
    };
  } catch (_) { return null; }
}

module.exports = async (req, res) => {
  const raw = String((req.query && req.query.symbols) || '').trim();
  const symbols = (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []).slice(0, 8);
  if (!symbols.length) return res.status(400).json({ available: false, reason: 'symbols required' });
  try {
    const { cookie, crumb } = await getCrumb();
    const peers = (await Promise.all(symbols.map((s) => fetchOne(s, cookie, crumb)))).filter(Boolean);
    if (!peers.length) return res.status(200).json({ available: false, reason: 'no peer data returned' });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).json({ available: true, asOf: Date.now(), source: 'Yahoo Finance quoteSummary (server proxy)', peers });
  } catch (e) {
    return res.status(200).json({ available: false, reason: 'peers failed (' + ((e && e.message) || e) + ')' });
  }
};
