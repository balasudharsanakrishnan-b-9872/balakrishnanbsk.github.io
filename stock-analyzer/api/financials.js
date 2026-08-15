// api/financials.js — Vercel serverless function.
// Fetches P&L / Balance Sheet / Cash Flow statements (annual + quarterly) + the earnings
// trend from Yahoo quoteSummary (server-side crumb handshake), lazily (only when the user
// opens the Financials tab). Degrades honestly to {available:false} — never fabricates a
// line item; missing values are simply omitted and shown as "—" by the frontend.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const MODULES = [
  'price', 'earnings',
  'incomeStatementHistory', 'incomeStatementHistoryQuarterly',
  'balanceSheetHistory', 'balanceSheetHistoryQuarterly',
  'cashflowStatementHistory', 'cashflowStatementHistoryQuarterly',
].join(',');

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
const pick = (s, keys) => { const o = { date: num(s.endDate) }; keys.forEach((k) => { o[k] = num(s[k]); }); return o; };

const INCOME = ['totalRevenue', 'costOfRevenue', 'grossProfit', 'operatingIncome', 'ebit', 'interestExpense', 'incomeBeforeTax', 'incomeTaxExpense', 'netIncome'];
const BALANCE = ['cash', 'totalCurrentAssets', 'totalAssets', 'totalCurrentLiabilities', 'totalLiab', 'longTermDebt', 'shortLongTermDebt', 'totalStockholderEquity'];
const CASH = ['totalCashFromOperatingActivities', 'capitalExpenditures', 'totalCashflowsFromInvestingActivities', 'totalCashFromFinancingActivities', 'netIncome', 'changeInCash'];

module.exports = async (req, res) => {
  const symbol = String((req.query && req.query.symbol) || '').trim();
  if (!symbol) return res.status(400).json({ available: false, reason: 'symbol required' });
  const ticker = symbol.includes('.') ? symbol : /^\d+$/.test(symbol) ? `${symbol}.BO` : `${symbol}.NS`;
  try {
    const { cookie, crumb } = await getCrumb();
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
    if (!r.ok) return res.status(200).json({ available: false, reason: `Yahoo quoteSummary ${r.status}`, ticker });
    const j = await r.json();
    const q = j?.quoteSummary?.result?.[0];
    if (!q) return res.status(200).json({ available: false, reason: 'no result', ticker });

    const inc = (m) => (q[m]?.incomeStatementHistory || []).map((s) => pick(s, INCOME));
    const bal = (m) => (q[m]?.balanceSheetStatements || []).map((s) => pick(s, BALANCE));
    const cf = (m) => (q[m]?.cashflowStatements || []).map((s) => pick(s, CASH));
    const e = q.earnings || {};
    const chart = (arr) => (arr || []).map((x) => ({ date: x.date, revenue: num(x.revenue), earnings: num(x.earnings) }));

    const data = {
      available: true, ticker, asOf: Date.now(), source: 'Yahoo Finance quoteSummary (server proxy)',
      currency: num(q.price?.currency) || q.price?.currency || 'INR',
      annual: { income: inc('incomeStatementHistory'), balance: bal('balanceSheetHistory'), cash: cf('cashflowStatementHistory') },
      quarterly: { income: inc('incomeStatementHistoryQuarterly'), balance: bal('balanceSheetHistoryQuarterly'), cash: cf('cashflowStatementHistoryQuarterly') },
      earnings: { yearly: chart(e.financialsChart?.yearly), quarterly: chart(e.financialsChart?.quarterly) },
    };
    const empty = !data.annual.income.length && !data.quarterly.income.length && !data.annual.balance.length;
    if (empty) return res.status(200).json({ available: false, reason: 'no statements returned for ' + ticker, ticker });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400'); // statements change quarterly
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({ available: false, reason: 'financials failed (' + ((err && err.message) || err) + ')', ticker });
  }
};
