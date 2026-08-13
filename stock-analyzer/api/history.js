// api/history.js — Vercel serverless function.
// Server-side proxy to Yahoo Finance's chart endpoint. Running on the server means
// there is NO browser CORS problem, so the app no longer depends on flaky public
// relays. We only proxy a public read endpoint, add a User-Agent, cache at the edge,
// and pass Yahoo's JSON through verbatim. Nothing is fabricated: on failure we return
// the upstream status and an error, never a made-up price.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

module.exports = async (req, res) => {
  try {
    const { symbol = '', range = '5y', interval = '1d' } = req.query || {};
    if (!symbol) return res.status(400).json({ error: 'symbol query param is required' });

    // Accept either a bare NSE symbol (RELIANCE) or an explicit Yahoo ticker (^NSEI, RELIANCE.NS).
    const raw = String(symbol).trim();
    const ticker = raw.startsWith('^') || raw.includes('.') ? raw : `${raw}.NS`;
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;

    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `Yahoo responded ${r.status}`, ticker });

    let json;
    try { json = JSON.parse(text); } catch (_) { return res.status(502).json({ error: 'Upstream returned non-JSON', ticker }); }
    if (!json?.chart?.result?.[0]) return res.status(404).json({ error: 'No chart data', ticker });

    // Edge cache: price history is fine to cache briefly (spec §33 — respect rate limits).
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    res.setHeader('X-Data-Source', 'Yahoo Finance v8/chart (server proxy)');
    return res.status(200).json(json);
  } catch (e) {
    return res.status(502).json({ error: 'Proxy error: ' + (e && e.message ? e.message : String(e)) });
  }
};
