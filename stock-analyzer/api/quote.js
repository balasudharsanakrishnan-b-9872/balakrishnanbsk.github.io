// api/quote.js — Vercel serverless function.
// Server-side proxy to Yahoo Finance's quoteSummary endpoint to fetch fundamentals
// (P/E, P/B, ROE, margins, debt, cash flow, dividend yield, growth). This endpoint now
// requires a "crumb" + cookie handshake that is impossible from a browser but fine from
// a server. If Yahoo blocks it (they change this often), we return {available:false}
// with a reason — we DO NOT invent ratios (spec §36.1-2).

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'assetProfile',
].join(',');

async function getCrumb() {
  // 1) hit a Yahoo page to obtain a session cookie
  const c = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  let cookie = '';
  if (typeof c.headers.getSetCookie === 'function') cookie = c.headers.getSetCookie().join('; ');
  else cookie = c.headers.get('set-cookie') || '';
  // strip attributes, keep name=value pairs
  cookie = cookie.split(/,(?=[^ ;]+=)/).map((p) => p.split(';')[0].trim()).filter(Boolean).join('; ');
  if (!cookie) throw new Error('no cookie from Yahoo');
  // 2) exchange cookie for a crumb
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/plain' },
  });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.length > 40 || /error|invalid|<\/?html/i.test(crumb)) throw new Error('crumb rejected');
  return { cookie, crumb };
}

const num = (o) => (o && typeof o === 'object' && 'raw' in o ? o.raw : o == null ? null : o);

module.exports = async (req, res) => {
  const symbol = String((req.query && req.query.symbol) || '').trim();
  if (!symbol) return res.status(400).json({ available: false, reason: 'symbol required' });
  const ticker = symbol.includes('.') ? symbol : `${symbol}.NS`;

  try {
    const { cookie, crumb } = await getCrumb();
    const url =
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
    const text = await r.text();
    if (!r.ok) return res.status(200).json({ available: false, reason: `Yahoo quoteSummary ${r.status}`, ticker });

    let json;
    try { json = JSON.parse(text); } catch (_) { return res.status(200).json({ available: false, reason: 'non-JSON from Yahoo', ticker }); }
    const q = json?.quoteSummary?.result?.[0];
    if (!q) return res.status(200).json({ available: false, reason: 'no quoteSummary result', ticker });

    const sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {}, fd = q.financialData || {}, pr = q.price || {}, ap = q.assetProfile || {};

    // Map only fields Yahoo actually returned; leave the rest null (no fabrication).
    const data = {
      available: true,
      ticker,
      asOf: Date.now(),
      source: 'Yahoo Finance quoteSummary (server proxy)',
      profile: { sector: ap.sector || null, industry: ap.industry || null, employees: num(ap.fullTimeEmployees) },
      valuation: {
        trailingPE: num(sd.trailingPE) ?? num(ks.trailingPE),
        forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
        priceToBook: num(ks.priceToBook),
        pegRatio: num(ks.pegRatio),
        priceToSales: num(sd.priceToSalesTrailing12Months),
        enterpriseToEbitda: num(ks.enterpriseToEbitda),
        dividendYield: num(sd.dividendYield),
        marketCap: num(pr.marketCap) ?? num(sd.marketCap),
      },
      profitability: {
        returnOnEquity: num(fd.returnOnEquity),
        returnOnAssets: num(fd.returnOnAssets),
        profitMargins: num(fd.profitMargins) ?? num(ks.profitMargins),
        operatingMargins: num(fd.operatingMargins),
        grossMargins: num(fd.grossMargins),
      },
      growth: {
        revenueGrowth: num(fd.revenueGrowth),
        earningsGrowth: num(fd.earningsGrowth),
        earningsQuarterlyGrowth: num(ks.earningsQuarterlyGrowth),
      },
      health: {
        debtToEquity: num(fd.debtToEquity),
        currentRatio: num(fd.currentRatio),
        quickRatio: num(fd.quickRatio),
        totalCash: num(fd.totalCash),
        totalDebt: num(fd.totalDebt),
        freeCashflow: num(fd.freeCashflow),
        operatingCashflow: num(fd.operatingCashflow),
        totalRevenue: num(fd.totalRevenue),
        ebitda: num(fd.ebitda),
      },
    };

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600'); // fundamentals change slowly
    return res.status(200).json(data);
  } catch (e) {
    // Honest degradation — the frontend will render "unavailable", not fake data.
    return res.status(200).json({
      available: false,
      ticker,
      reason: 'Yahoo fundamentals handshake failed (' + (e && e.message ? e.message : String(e)) + '). Yahoo frequently changes this; a licensed data feed removes the fragility.',
    });
  }
};
