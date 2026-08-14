// api/search.js — Vercel serverless function.
// Server-side proxy to Yahoo Finance's symbol-search endpoint so users can search by
// COMPANY NAME (or partial symbol) instead of memorizing NSE symbols / BSE codes.
// Returns real listed matches with their exchange, so ambiguous names (same company on
// NSE and BSE) are disambiguated by what the user clicks — nothing is guessed.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

module.exports = async (req, res) => {
  try {
    const q = String((req.query && req.query.q) || '').trim();
    if (!q) return res.status(200).json({ quotes: [] });
    const url =
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
      `&quotesCount=15&newsCount=0&enableFuzzyQuery=true&lang=en-IN&region=IN`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) return res.status(r.status).json({ quotes: [], error: `Yahoo ${r.status}` });
    const j = await r.json();
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json({ quotes: Array.isArray(j.quotes) ? j.quotes : [] });
  } catch (e) {
    return res.status(502).json({ quotes: [], error: (e && e.message) || String(e) });
  }
};
