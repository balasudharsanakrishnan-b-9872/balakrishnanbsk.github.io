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
  await ctx.route(/\/api\/history/, (route) => {
    const sym = new URL(route.request().url()).searchParams.get('symbol') || '';
    if (scenario.histFail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mock fail"}' });
    if (scenario.bseOnly && /\.NS$/i.test(sym)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
    return route.fulfill({ json: chartJSON(sym) });
  });
  await ctx.route(/\/api\/quote/, (route) => scenario.noFund
    ? route.fulfill({ json: { available: false, reason: 'mock unavailable' } })
    : route.fulfill({ json: FUND(new URL(route.request().url()).searchParams.get('symbol') || '') }));
  await ctx.route(/\/api\/search/, (route) => route.fulfill({ json: SEARCH }));
  await ctx.route(/corsproxy\.io|allorigins\.win|thingproxy/, (r) => r.abort());
  return ctx;
}

async function axeAudit(page, label) {
  await page.evaluate(AXE);
  const res = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ['violations'] }));
  const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
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
