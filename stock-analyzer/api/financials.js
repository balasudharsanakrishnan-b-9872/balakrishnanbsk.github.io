// api/financials.js — Vercel serverless function.
// P&L / Balance Sheet / Cash Flow (annual + quarterly) for the Financials tab.
//
// PRIMARY source: Yahoo's fundamentals-timeseries endpoint — it has far better coverage
// for Indian (.NS/.BO) stocks than quoteSummary, whose balanceSheetHistory /
// cashflowStatementHistory modules are frequently EMPTY for Indian tickers (which is why
// Balance Sheet / Cash Flow looked blank). FALLBACK: the old quoteSummary statement
// modules, so income still works even if the timeseries call fails.
// Degrades honestly to {available:false}; missing line items are omitted (shown as "—").

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

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

// outKey (consumed by the frontend rows) -> timeseries type suffix (without annual/quarterly prefix)
const INCOME = { totalRevenue: 'TotalRevenue', costOfRevenue: 'CostOfRevenue', grossProfit: 'GrossProfit', operatingIncome: 'OperatingIncome', ebit: 'EBIT', interestExpense: 'InterestExpense', incomeBeforeTax: 'PretaxIncome', incomeTaxExpense: 'TaxProvision', netIncome: 'NetIncome' };
const BALANCE = { cash: 'CashAndCashEquivalents', totalCurrentAssets: 'CurrentAssets', totalAssets: 'TotalAssets', totalCurrentLiabilities: 'CurrentLiabilities', totalLiab: 'TotalLiabilitiesNetMinorityInterest', longTermDebt: 'LongTermDebt', shortLongTermDebt: 'CurrentDebt', totalStockholderEquity: 'StockholdersEquity' };
const CASH = { totalCashFromOperatingActivities: 'OperatingCashFlow', capitalExpenditures: 'CapitalExpenditure', totalCashflowsFromInvestingActivities: 'InvestingCashFlow', totalCashFromFinancingActivities: 'FinancingCashFlow', changeInCash: 'ChangesInCash' };

const suffixes = () => [...new Set([...Object.values(INCOME), ...Object.values(BALANCE), ...Object.values(CASH)])];

// Build a { typeName: [{date, value}] } map from a timeseries result array.
function seriesMap(results) {
  const m = {};
  for (const r of results || []) {
    const t = r && r.meta && r.meta.type && r.meta.type[0];
    if (!t || !Array.isArray(r[t])) continue;
    m[t] = r[t].filter(Boolean).map((x) => ({ date: x.asOfDate, value: x.reportedValue ? num(x.reportedValue) : null }));
  }
  return m;
}
// Assemble period rows (newest first) for a prefix ('annual'|'quarterly') from the field map.
function buildPeriods(m, prefix, fieldMap) {
  const byDate = {};
  for (const [outKey, suffix] of Object.entries(fieldMap)) {
    const arr = m[prefix + suffix] || [];
    for (const { date, value } of arr) {
      if (!date) continue;
      if (!byDate[date]) byDate[date] = { date: Math.floor(Date.parse(date) / 1000) };
      byDate[date][outKey] = value;
    }
  }
  return Object.values(byDate).sort((a, b) => b.date - a.date);
}

async function tryTimeseries(ticker, cookie, crumb) {
  const types = [];
  for (const p of ['annual', 'quarterly']) suffixes().forEach((s) => types.push(p + s));
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?symbol=${encodeURIComponent(ticker)}&type=${types.join(',')}&period1=493590046&period2=${p2}&merge=false&padTimeSeries=true&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
  if (!r.ok) return null;
  const j = await r.json();
  const results = j?.timeseries?.result;
  if (!results) return null;
  const m = seriesMap(results);
  const out = {
    annual: { income: buildPeriods(m, 'annual', INCOME), balance: buildPeriods(m, 'annual', BALANCE), cash: buildPeriods(m, 'annual', CASH) },
    quarterly: { income: buildPeriods(m, 'quarterly', INCOME), balance: buildPeriods(m, 'quarterly', BALANCE), cash: buildPeriods(m, 'quarterly', CASH) },
  };
  const any = out.annual.income.length || out.annual.balance.length || out.annual.cash.length || out.quarterly.income.length;
  return any ? out : null;
}

async function tryQuoteSummary(ticker, cookie, crumb) {
  const modules = 'incomeStatementHistory,incomeStatementHistoryQuarterly,balanceSheetHistory,balanceSheetHistoryQuarterly,cashflowStatementHistory,cashflowStatementHistoryQuarterly';
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
  if (!r.ok) return null;
  const q = (await r.json())?.quoteSummary?.result?.[0];
  if (!q) return null;
  const pick = (s, map) => { const o = { date: num(s.endDate) }; for (const [k, yk] of Object.entries(map)) o[k] = num(s[yk]); return o; };
  const YI = { totalRevenue: 'totalRevenue', costOfRevenue: 'costOfRevenue', grossProfit: 'grossProfit', operatingIncome: 'operatingIncome', ebit: 'ebit', interestExpense: 'interestExpense', incomeBeforeTax: 'incomeBeforeTax', incomeTaxExpense: 'incomeTaxExpense', netIncome: 'netIncome' };
  const YB = { cash: 'cash', totalCurrentAssets: 'totalCurrentAssets', totalAssets: 'totalAssets', totalCurrentLiabilities: 'totalCurrentLiabilities', totalLiab: 'totalLiab', longTermDebt: 'longTermDebt', shortLongTermDebt: 'shortLongTermDebt', totalStockholderEquity: 'totalStockholderEquity' };
  const YC = { totalCashFromOperatingActivities: 'totalCashFromOperatingActivities', capitalExpenditures: 'capitalExpenditures', totalCashflowsFromInvestingActivities: 'totalCashflowsFromInvestingActivities', totalCashFromFinancingActivities: 'totalCashFromFinancingActivities', changeInCash: 'changeInCash' };
  const inc = (m) => (q[m]?.incomeStatementHistory || []).map((s) => pick(s, YI));
  const bal = (m) => (q[m]?.balanceSheetStatements || []).map((s) => pick(s, YB));
  const cf = (m) => (q[m]?.cashflowStatements || []).map((s) => pick(s, YC));
  const out = {
    annual: { income: inc('incomeStatementHistory'), balance: bal('balanceSheetHistory'), cash: cf('cashflowStatementHistory') },
    quarterly: { income: inc('incomeStatementHistoryQuarterly'), balance: bal('balanceSheetHistoryQuarterly'), cash: cf('cashflowStatementHistoryQuarterly') },
  };
  const any = out.annual.income.length || out.annual.balance.length || out.annual.cash.length;
  return any ? out : null;
}

module.exports = async (req, res) => {
  const symbol = String((req.query && req.query.symbol) || '').trim();
  if (!symbol) return res.status(400).json({ available: false, reason: 'symbol required' });
  const ticker = symbol.includes('.') ? symbol : /^\d+$/.test(symbol) ? `${symbol}.BO` : `${symbol}.NS`;
  try {
    const { cookie, crumb } = await getCrumb();
    // primary: timeseries (best India coverage); fallback: quoteSummary; then merge to fill gaps
    const ts = await tryTimeseries(ticker, cookie, crumb).catch(() => null);
    const qs = (!ts || !ts.annual.balance.length || !ts.annual.cash.length)
      ? await tryQuoteSummary(ticker, cookie, crumb).catch(() => null)
      : null;
    const merge = (a, b) => ({
      annual: { income: a?.annual.income?.length ? a.annual.income : (b?.annual.income || []), balance: a?.annual.balance?.length ? a.annual.balance : (b?.annual.balance || []), cash: a?.annual.cash?.length ? a.annual.cash : (b?.annual.cash || []) },
      quarterly: { income: a?.quarterly.income?.length ? a.quarterly.income : (b?.quarterly.income || []), balance: a?.quarterly.balance?.length ? a.quarterly.balance : (b?.quarterly.balance || []), cash: a?.quarterly.cash?.length ? a.quarterly.cash : (b?.quarterly.cash || []) },
    });
    const data = merge(ts, qs);
    const empty = !data.annual.income.length && !data.annual.balance.length && !data.annual.cash.length && !data.quarterly.income.length;
    if (empty) return res.status(200).json({ available: false, reason: 'no statements returned for ' + ticker, ticker });
    // revenue/profit trend for the chart, from annual income (oldest→newest)
    const earnings = { yearly: [...(data.annual.income || [])].reverse().map((s) => ({ date: new Date((s.date || 0) * 1000).getFullYear(), revenue: s.totalRevenue, earnings: s.netIncome })), quarterly: [] };
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ available: true, ticker, asOf: Date.now(), source: 'Yahoo Finance fundamentals (server proxy)', currency: 'INR', annual: data.annual, quarterly: data.quarterly, earnings });
  } catch (err) {
    return res.status(200).json({ available: false, reason: 'financials failed (' + ((err && err.message) || err) + ')', ticker });
  }
};
