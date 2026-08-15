#!/usr/bin/env node
/*
 * BSK Stock Analyser — functional + accessibility test suite.
 *
 * Runs fully offline: it serves the app locally and MOCKS the network layer
 * (Yahoo / /api responses + a local Chart.js) via Playwright request interception,
 * then drives the real app (search -> fetch -> analyse -> render -> charts -> watchlist)
 * and asserts on the results. Also runs an axe-core accessibility audit.
 *
 *   cd tests && npm install && npm test
 *
 * `npm install` fetches Playwright's Chromium automatically (postinstall). On a
 * pre-provisioned machine you can point at an existing build via PW_EXECUTABLE=/path/to/chrome.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..'); // the app root (stock-analyzer/)
const CHARTJS = fs.readFileSync(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), 'utf8');
const AXE = fs.readFileSync(require.resolve('axe-core'), 'utf8');
const EXE = process.env.PW_EXECUTABLE || undefined; // optional pre-installed chromium

const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra: cond ? '' : (extra || '') });

// ---------- tiny static server ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// ---------- mock market data ----------
function chartJSON(ticker, opts = {}) {
  const { days = 1300, start = 100, drift = 0.0007, exch = /\.BO$/i.test(ticker) ? 'BSE' : 'NSI', currency = 'INR' } = opts;
  const now = Math.floor(Date.now() / 1000), day = 86400;
  const ts = [], open = [], high = [], low = [], close = [], vol = [], adj = [];
  let p = start;
  for (let i = days - 1; i >= 0; i--) { ts.push(now - i * day); p = Math.max(1, p * (1 + drift) + Math.sin(i / 7) * 0.5); const c = +p.toFixed(2); open.push(+(c * 0.995).toFixed(2)); high.push(+(c * 1.01).toFixed(2)); low.push(+(c * 0.99).toFixed(2)); close.push(c); adj.push(c); vol.push(1000000 + ((days - i) % 40) * 10000); }
  return { chart: { result: [{ meta: { currency, exchangeName: exch, regularMarketPrice: close.at(-1), chartPreviousClose: close.at(-2), fiftyTwoWeekHigh: Math.max(...high), fiftyTwoWeekLow: Math.min(...low), regularMarketTime: now }, timestamp: ts, indicators: { quote: [{ open, high, low, close, volume: vol }], adjclose: [{ adjclose: adj }] } }], error: null } };
}
const FUND = (ticker) => ({ available: true, ticker, asOf: Date.now(), source: 'Yahoo quoteSummary (mock)', profile: { sector: 'Energy', industry: 'Oil & Gas' }, valuation: { trailingPE: 22.4, forwardPE: 19.1, priceToBook: 2.1, pegRatio: 1.1, priceToSales: 1.8, enterpriseToEbitda: 12.3, dividendYield: 0.006, marketCap: 1.7e13 }, profitability: { returnOnEquity: 0.142, returnOnAssets: 0.061, profitMargins: 0.093, operatingMargins: 0.131, grossMargins: 0.352 }, growth: { revenueGrowth: 0.121, earningsGrowth: 0.104, earningsQuarterlyGrowth: 0.09 }, health: { debtToEquity: 52, currentRatio: 1.21, totalCash: 2e11, totalDebt: 3e11, freeCashflow: 5e10, operatingCashflow: 9e10 } });
const SEARCH = { quotes: [
  { symbol: 'RELIANCE.NS', shortname: 'Reliance Industries', longname: 'Reliance Industries Limited', quoteType: 'EQUITY', exchange: 'NSI' },
  { symbol: 'RELIANCE.BO', shortname: 'Reliance Industries', longname: 'Reliance Industries Limited', quoteType: 'EQUITY', exchange: 'BSE' },
] };

async function makeContext(browser, base, scenario = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', baseURL: base });
  await ctx.route(/cdn\.jsdelivr\.net\/.*chart\.umd\.min\.js/, (r) => r.fulfill({ contentType: 'application/javascript', body: CHARTJS }));
  await ctx.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route(/fonts\.gstatic\.com/, (r) => r.abort());
  await ctx.route(/\/api\/history/, async (route) => {
    if (scenario.slowMs) await new Promise((r) => setTimeout(r, scenario.slowMs)); // simulate slow load
    const sym = new URL(route.request().url()).searchParams.get('symbol') || '';
    if (scenario.histFail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mock fail"}' });
    if (scenario.bseOnly && /\.NS$/i.test(sym)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
    return route.fulfill({ json: chartJSON(sym) });
  });
  await ctx.route(/\/api\/quote/, (route) => scenario.noFund
    ? route.fulfill({ json: { available: false, reason: 'mock unavailable' } })
    : route.fulfill({ json: FUND(new URL(route.request().url()).searchParams.get('symbol') || '') }));
  await ctx.route(/\/api\/search/, (route) => route.fulfill({ json: SEARCH }));
  await ctx.route(/\/api\/movers/, (route) => {
    if (scenario.moversFail) return route.fulfill({ json: { available: false, reason: 'mock unavailable' } });
    const syms = (new URL(route.request().url()).searchParams.get('symbols') || '').split(',').filter(Boolean);
    const quotes = syms.map((y, i) => { const pct = +(((i % 7) - 3) * 1.3 + (i % 3 ? 0.4 : -0.6)).toFixed(2); const price = 100 + i * 7; return { symbol: y.replace(/\.(NS|BO)$/i, ''), yahoo: y, name: y.replace(/\.(NS|BO)$/i, ''), price, change: +(price * pct / 100).toFixed(2), changePct: pct, volume: 1e6 * (1 + (i % 5)), avgVolume: 1e6 * (1 + ((i * 3) % 5)), high52: price * (1 + (i % 4) * 0.05), low52: price * (0.6 + (i % 3) * 0.05), marketCap: 1e11 * (1 + (i % 9)) }; });
    route.fulfill({ json: { available: true, asOf: Date.now(), source: 'mock v7/quote', quotes } });
  });
  await ctx.route(/\/api\/financials/, (route) => {
    if (scenario.noFin) return route.fulfill({ json: { available: false, reason: 'mock' } });
    const inc = (rev, ni) => ({ date: 1700000000, totalRevenue: rev, costOfRevenue: rev * 0.6, grossProfit: rev * 0.4, operatingIncome: rev * 0.25, ebit: rev * 0.24, interestExpense: rev * 0.02, incomeBeforeTax: rev * 0.22, incomeTaxExpense: rev * 0.05, netIncome: ni });
    const bal = (a) => ({ date: 1700000000, cash: a * 0.1, totalCurrentAssets: a * 0.4, totalAssets: a, totalCurrentLiabilities: a * 0.2, totalLiab: a * 0.5, longTermDebt: a * 0.1, shortLongTermDebt: a * 0.05, totalStockholderEquity: a * 0.5 });
    const cf = (o) => ({ date: 1700000000, totalCashFromOperatingActivities: o, capitalExpenditures: -o * 0.3, totalCashflowsFromInvestingActivities: -o * 0.4, totalCashFromFinancingActivities: -o * 0.2, changeInCash: o * 0.1 });
    route.fulfill({ json: { available: true, asOf: Date.now(), source: 'mock', currency: 'INR', annual: { income: [inc(1e11, 1.2e10), inc(9e10, 1e10), inc(8e10, 9e9)], balance: [bal(2e11), bal(1.8e11)], cash: [cf(2e10), cf(1.8e10)] }, quarterly: { income: [inc(2.6e10, 3e9), inc(2.5e10, 2.9e9)], balance: [bal(2e11)], cash: [cf(5e9)] }, earnings: { yearly: [{ date: 2021, revenue: 8e10, earnings: 9e9 }, { date: 2022, revenue: 9e10, earnings: 1e10 }, { date: 2023, revenue: 1e11, earnings: 1.2e10 }], quarterly: [] } } });
  });
  await ctx.route(/\/api\/peers/, (route) => {
    if (scenario.noPeers) return route.fulfill({ json: { available: false, reason: 'mock' } });
    const mk = (sym, roe, rev, de, pe) => ({ symbol: sym, name: sym + ' Ltd', available: true, valuation: { trailingPE: pe, priceToBook: 3, pegRatio: 1.2, enterpriseToEbitda: 14, dividendYield: 0.006, marketCap: 1e12 }, profitability: { returnOnEquity: roe, returnOnAssets: roe * 0.5, profitMargins: 0.12, operatingMargins: 0.18 }, growth: { revenueGrowth: rev, earningsGrowth: rev * 0.9 }, health: { debtToEquity: de, currentRatio: 1.4, freeCashflow: 5e9, totalCash: 2e10, totalDebt: 1e10 } });
    const syms = (new URL(route.request().url()).searchParams.get('symbols') || '').split(',').filter(Boolean).map((s) => s.replace(/\.(NS|BO)$/i, ''));
    route.fulfill({ json: { available: true, asOf: Date.now(), source: 'mock', peers: syms.map((s, i) => mk(s, 0.1 + i * 0.03, 0.08 + i * 0.02, 60 - i * 8, 30 - i * 3)) } });
  });
  await ctx.route(/corsproxy\.io|allorigins\.win|thingproxy/, (r) => r.abort());
  return ctx;
}

async function axeAudit(page, label) {
  await page.evaluate(AXE);
  const res = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ['violations'] }));
  const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (serious.length && process.env.AXE_DEBUG) serious.forEach((v) => v.nodes.slice(0, 4).forEach((n) => console.log('   AXE', label, v.id, '|', n.target.join(' '), '|', (n.any[0] && n.any[0].message) || '')));
  check(`a11y: ${label} — no serious/critical axe violations`, serious.length === 0, serious.map((v) => v.id).join(', '));
  return res.violations;
}

(async () => {
  const { srv, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: EXE });
  const errs = [];
  const track = (page) => { page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); }); page.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); };

  try {
    // ===== Scenario A: full analysis via search =====
    {
      const ctx = await makeContext(browser, base); const page = await ctx.newPage(); track(page);
      await page.goto('/index.html', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);
      await axeAudit(page, 'landing');

      // Google sign-in: disabled by default (no client id) -> hidden, no GIS script loaded
      check('gsync: account hidden when unconfigured', await page.$eval('#account', (n) => n.hidden === true));
      check('gsync: no external GIS script when disabled', (await page.$$('script[src*="gsi/client"]')).length === 0);
      const merged = await page.evaluate(async () => { const G = await import('/js/gsync.js'); return G.mergeData({ watchlist: [{ s: 'A' }], theme: 'dark', updatedAt: 1 }, { watchlist: [{ s: 'B' }], theme: 'light', updatedAt: 2 }); });
      check('gsync: mergeData unions watchlist + takes newer theme', merged.watchlist.length === 2 && merged.watchlist.some((x) => x.s === 'A') && merged.watchlist.some((x) => x.s === 'B') && merged.theme === 'light', JSON.stringify(merged));

      await page.fill('#search', 'reliance'); await page.waitForTimeout(700);
      check('search: dropdown shows options', (await page.$$('#suggestions .suggestion')).length >= 1);
      check('search: BSE dual-listing surfaced', (await page.$$('#suggestions .exch.bse')).length >= 1);
      check('search: combobox aria-expanded', (await page.getAttribute('#search', 'aria-expanded')) === 'true');

      await page.click('#suggestions .suggestion');
      await page.waitForSelector('.verdict', { timeout: 8000 }); await page.waitForTimeout(400);

      const overall = await page.$eval('.gauge-wrap .g-num', (n) => parseInt(n.textContent, 10));
      check('verdict: score 0–100 integer', Number.isInteger(overall) && overall >= 0 && overall <= 100, 'score=' + overall);
      check('verdict: rating pill', /BUY|HOLD|WATCH|AVOID/.test((await page.$eval('.rating-pill', (n) => n.textContent))));
      check('verdict: price with ₹', /₹[\d]/.test((await page.$eval('.verdict-price .price', (n) => n.textContent)).replace(/\s/g, '')));
      check('verdict: accessible gauge svg', !!(await page.$('.gauge-wrap svg[aria-label^="Overall score"]')));
      check('verdict: 4 stat tiles', (await page.$$('.verdict-boxes .vbox')).length === 4);
      check('verdict: data quality high w/ fundamentals', /8\d%|9\d%|100%/.test(await page.$eval('.verdict-boxes', (n) => n.textContent)));

      check('overview: trend badges', (await page.$$('#panel-overview .badge')).length >= 3);
      check('overview: bull case', (await page.$$('#panel-overview .card.bull li')).length >= 1);

      await page.click('#tab-score'); await page.waitForTimeout(200);
      check('score: 9 component rows', (await page.$$('#panel-score .score-table tbody tr')).length === 9);
      check('score: progress bars', (await page.$$('#panel-score .bar > i')).length >= 4);
      check('score: footer total matches gauge', (await page.$eval('#panel-score .score-table tfoot', (n) => n.textContent)).includes(String(overall)));

      await page.click('#tab-technical'); await page.waitForTimeout(200);
      check('technical: ≥16 indicator tiles', (await page.$$('#panel-technical .metric')).length >= 16);
      check('technical: signals rendered', (await page.$$('#panel-technical .signals .sig')).length >= 3);
      check('technical: RSI computed', await page.$$eval('#panel-technical .metric', (ns) => ns.some((n) => /RSI 14/.test(n.textContent) && /\d/.test(n.textContent))));

      await page.click('#tab-risk'); await page.waitForTimeout(200);
      const riskTxt = await page.$eval('#panel-risk', (n) => n.textContent);
      check('risk: volatility computed', /volatility/i.test(riskTxt) && /%/.test(riskTxt));
      check('risk: beta vs NIFTY shown', /Beta vs NIFTY 50/.test(riskTxt));

      await page.click('#tab-charts'); await page.waitForTimeout(600);
      const charts = await page.evaluate(() => ({ p: !!window.Chart?.getChart?.('chartPrice'), v: !!window.Chart?.getChart?.('chartVolume'), r: !!window.Chart?.getChart?.('chartRsi') }));
      check('charts: price/volume/rsi instances created', charts.p && charts.v && charts.r, JSON.stringify(charts));
      await page.click('.range-btn[data-range="5Y"]'); await page.waitForTimeout(300);
      check('charts: range toggles aria-pressed', (await page.getAttribute('.range-btn[data-range="5Y"]', 'aria-pressed')) === 'true');

      await page.click('#tab-fundamentals'); await page.waitForTimeout(200);
      const fTxt = await page.$eval('#panel-fundamentals', (n) => n.textContent);
      check('fundamentals: P/E populated', /Trailing P\/E/.test(fTxt) && /22\.4/.test(fTxt));
      check('fundamentals: ROE populated', /ROE/.test(fTxt) && /14\.2/.test(fTxt));

      await page.click('#tab-audit'); await page.waitForTimeout(200);
      check('audit: quality + confidence shown', /Data quality/i.test(await page.$eval('#panel-audit', (n) => n.textContent)));

      // financials tab (lazy)
      await page.click('#tab-financials'); await page.waitForSelector('#panel-financials .fin-table', { timeout: 8000 });
      check('financials: P&L/BS/CF tables render', (await page.$$('#panel-financials .fin-table')).length >= 3 && /Revenue/.test(await page.$eval('#panel-financials', (n) => n.textContent)));
      await page.click('#panel-financials .seg-btn[data-fp="quarterly"]'); await page.waitForTimeout(200);
      check('financials: annual/quarterly toggle works', (await page.getAttribute('#panel-financials .seg-btn[data-fp="quarterly"]', 'aria-pressed')) === 'true');

      // peers tab (lazy)
      await page.click('#tab-peers'); await page.waitForSelector('#panel-peers .pc-table', { timeout: 8000 });
      check('peers: comparison table has peer rows', (await page.$$('#panel-peers .pc-table tbody tr')).length >= 2);
      check('peers: best-in-column highlighted', (await page.$$('#panel-peers .pc-table td.best')).length >= 1);
      check('peers: analysed stock emphasised + rank shown', !!(await page.$('#panel-peers tr.me')) && /ranks/.test(await page.$eval('#panel-peers', (n) => n.textContent)));

      await axeAudit(page, 'dashboard');

      // keyboard tab nav
      await page.$eval('#tab-overview', (el) => el.focus());
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
      check('a11y: ArrowRight moves tab selection', (await page.getAttribute('#tab-score', 'aria-selected')) === 'true');

      // watchlist add / persist / remove
      await page.click('#tab-overview'); await page.click('#wlToggle'); await page.waitForTimeout(150);
      check('watchlist: item added', (await page.$$('#watchlist .wl-chip')).length >= 1);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);
      check('watchlist: persists across reload', (await page.$$('#watchlist .wl-chip')).length >= 1);
      await page.click('#watchlist .wl-chip .del'); await page.waitForTimeout(150);
      check('watchlist: item removed', (await page.$$('#watchlist .wl-chip')).length === 0);

      // theme toggle + persist
      const before = await page.getAttribute('html', 'data-theme');
      await page.click('#themeToggle'); await page.waitForTimeout(150);
      const after = await page.getAttribute('html', 'data-theme');
      check('theme: toggle changes data-theme', before !== after, `${before}->${after}`);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(300);
      check('theme: persists across reload', (await page.getAttribute('html', 'data-theme')) === after);

      await ctx.close();
    }

    // ===== Scenario B: BSE fallback =====
    {
      const ctx = await makeContext(browser, base, { bseOnly: true }); const page = await ctx.newPage(); track(page);
      await page.goto('/index.html?s=SOMEBSECO', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.verdict', { timeout: 8000 }); await page.waitForTimeout(300);
      check('BSE fallback: resolves to .BO', /\.BO$/.test(await page.$eval('.verdict-id .sym', (n) => n.textContent)));
      check('BSE fallback: exchange tag = BSE', /BSE/.test(await page.$eval('.verdict-id .tags', (n) => n.textContent)));
      await ctx.close();
    }

    // ===== Scenario C: error path (no fabrication) =====
    {
      const ctx = await makeContext(browser, base, { histFail: true }); const page = await ctx.newPage(); track(page);
      await page.goto('/index.html?s=FAILCO', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.error-card', { timeout: 8000 });
      check('error path: error card shown', !!(await page.$('.error-card')));
      check('error path: no fabricated verdict', !(await page.$('.verdict')));
      await ctx.close();
    }

    // ===== Scenario D: fundamentals unavailable =====
    {
      const ctx = await makeContext(browser, base, { noFund: true }); const page = await ctx.newPage(); track(page);
      await page.goto('/index.html?s=RELIANCE', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.verdict', { timeout: 8000 }); await page.waitForTimeout(300);
      check('no-fund: fundamentals unavailable (not fabricated)', /Not available|unavailable/i.test(await page.$eval('#panel-fundamentals', (n) => n.innerHTML)));
      check('no-fund: data quality reduced', /[1-6]\d%|20%/.test(await page.$eval('.verdict-boxes', (n) => n.textContent)));
      await ctx.close();
    }

    // ===== Scenario F: Markets home page =====
    {
      const ctx = await makeContext(browser, base); const page = await ctx.newPage(); track(page);
      await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#home .home-grid', { timeout: 8000 });
      check('home: eight mover cards (gainers/losers/active×2/shockers/valuable/52w×2)', (await page.$$('#home .mv-card')).length === 8);
      check('home: mover rows populated', (await page.$$('#home .mv-row')).length >= 8);
      check('home: sector heatmap rendered', (await page.$$('#home .sector-chip')).length >= 1);
      check('home: indices strip rendered', (await page.$$('#home .idx')).length >= 1);
      check('home: market breadth bar rendered', (await page.$$('#home .breadth-bar .adv')).length === 1);
      check('home: market status badge rendered', !!(await page.$('#home .mkt-status')));
      check('home: refresh button present', !!(await page.$('#homeRefresh')));
      // 52-week + most-valuable cards present by heading text
      const headings = await page.$$eval('#home .mv-card h3', (ns) => ns.map((n) => n.textContent));
      check('home: 52-week high & low screens', headings.some((h) => /52-wk high/.test(h)) && headings.some((h) => /52-wk low/.test(h)), headings.join(' | '));
      check('home: most-valuable + most-active-by-volume screens', headings.some((h) => /Most valuable/.test(h)) && headings.filter((h) => /Most active/.test(h)).length === 2);
      await page.click('#home .mv-row');
      await page.waitForSelector('.verdict', { timeout: 8000 });
      check('home: clicking a mover opens analysis', !!(await page.$('.verdict')));
      check('home: hidden after selecting a stock', (await page.$eval('#home', (n) => getComputedStyle(n).display)) === 'none');
      await page.click('#wlToggle'); await page.waitForTimeout(120); // save for live-watchlist check
      await page.click('.brand');
      await page.waitForSelector('#home .home-grid', { timeout: 8000 });
      await page.waitForTimeout(300);
      check('home: brand click returns to markets', (await page.$eval('#home', (n) => getComputedStyle(n).display)) !== 'none');
      check('home: watchlist shows live price', (await page.$$('#watchlist .wl-chip .wl-px')).length >= 1);
      await ctx.close();
    }

    // ===== Scenario G: home unavailable (no backend) =====
    {
      const ctx = await makeContext(browser, base, { moversFail: true }); const page = await ctx.newPage(); track(page);
      await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#home .home-unavailable', { timeout: 8000 });
      check('home: honest unavailable state when backend missing', /Not available/i.test(await page.$eval('#home', (n) => n.textContent)));
      await ctx.close();
    }

    // ===== Scenario E: loading lock (no concurrent analyses / no race) =====
    {
      const ctx = await makeContext(browser, base, { slowMs: 1200 }); const page = await ctx.newPage(); track(page);
      await page.goto('/index.html?s=RELIANCE', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#search') && document.querySelector('#search').disabled === true, { timeout: 4000 }).catch(() => {});
      check('loading lock: search disabled during load', await page.$eval('#search', (n) => n.disabled));
      // try to start a different analysis mid-load — the guard must ignore it
      await page.click('.quick-btn[data-s="INFY"]').catch(() => {});
      await page.waitForSelector('.verdict', { timeout: 10000 }); await page.waitForTimeout(200);
      check('loading lock: second request ignored (no race)', /RELIANCE/.test(await page.$eval('.verdict-id .sym', (n) => n.textContent)));
      check('loading lock: search re-enabled after load', (await page.$eval('#search', (n) => n.disabled)) === false);
      await ctx.close();
    }

    // ===== Scenario H: Google sign-in + Drive sync (fully mocked Google) =====
    {
      const ctx = await makeContext(browser, base);
      // seed a local watchlist + old timestamp so the merge + newer-remote-theme are observable
      await ctx.addInitScript(() => { try { localStorage.setItem('sa_watchlist', JSON.stringify([{ s: 'TCS', n: 'Tata Consultancy Services' }])); localStorage.setItem('sa_updatedAt', '1'); } catch (e) {} });
      // enable the feature by returning a dummy client id from config.js
      await ctx.route(/\/js\/config\.js$/, (r) => r.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID='test.apps.googleusercontent.com';" }));
      // stub Google Identity Services: requestAccessToken immediately returns a token
      await ctx.route(/accounts\.google\.com\/gsi\/client/, (r) => r.fulfill({ contentType: 'text/javascript', body: "window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c.callback({access_token:'FAKE'})}),revoke:(t,cb)=>cb&&cb()}}};" }));
      await ctx.route(/oauth2\/v3\/userinfo/, (r) => r.fulfill({ json: { name: 'Test User', email: 'test@example.com', picture: '' } }));
      await ctx.route(/\/drive\/v3\/files\/FILEID\?alt=media/, (r) => r.fulfill({ json: { watchlist: [{ s: 'INFY', n: 'Infosys' }], theme: 'light', updatedAt: 9999999999999 } }));
      await ctx.route(/\/drive\/v3\/files\?/, (r) => r.fulfill({ json: { files: [{ id: 'FILEID', modifiedTime: '2030-01-01T00:00:00Z' }] } }));
      let uploads = 0;
      await ctx.route(/\/upload\/drive\/v3\/files/, (r) => { uploads++; r.fulfill({ json: { id: 'FILEID' } }); });

      const page = await ctx.newPage(); track(page);
      await page.goto('/index.html', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
      check('gsync(mock): sign-in button shown when configured', !!(await page.$('#googleSignIn')));
      await page.click('#googleSignIn');
      await page.waitForSelector('#accountBtn', { timeout: 8000 }); await page.waitForTimeout(500);
      check('gsync(mock): signed-in shows profile name', /Test User/.test(await page.$eval('#accountBtn', (n) => n.textContent)));
      const wl = await page.$$eval('#watchlist .wl-chip b', (ns) => ns.map((n) => n.textContent));
      check('gsync(mock): watchlist merged (local TCS + remote INFY)', wl.includes('TCS') && wl.includes('INFY'), wl.join(','));
      check('gsync(mock): newer remote theme applied (light)', (await page.getAttribute('html', 'data-theme')) === 'light');
      check('gsync(mock): merged data pushed to Drive', uploads >= 1, 'uploads=' + uploads);
      await page.click('#accountBtn'); await page.waitForTimeout(100); await page.click('#amOut'); await page.waitForTimeout(300);
      check('gsync(mock): sign out returns to Sign in', !!(await page.$('#googleSignIn')));
      await ctx.close();
    }

    check('global: no uncaught console/page errors', errs.length === 0, errs.slice(0, 8).join(' | '));
  } catch (e) {
    check('harness completed without throwing', false, e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.close();
  }

  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log('\n==================== BSK Stock Analyser — TEST RESULTS ====================');
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '   [' + r.extra + ']' : ''}`));
  console.log(`\n${pass}/${results.length} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
