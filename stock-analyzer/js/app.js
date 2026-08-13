// app.js — orchestration + rendering. Ties providers -> analysis -> UI.
// Keeps a clear separation: data in (providers), math (indicators/analysis), view (here).

import { STOCK_UNIVERSE, SECTORS, BENCHMARK, SECTOR_INDEX, searchStocks } from './stocks.js';
import * as P from './providers.js';
import * as A from './analysis.js';
import * as I from './indicators.js';
import * as C from './charts.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmtNum = (x, d = 2) => (x == null ? '—' : Number(x).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtPct = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmtNum(x)}%`);
const fmtPrice = (x) => (x == null ? '—' : '₹' + fmtNum(x));
const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

let CURRENT = null; // last analysis result
let CHART_RANGE = '1Y';

// ---------------- boot ----------------
window.addEventListener('DOMContentLoaded', () => {
  I._selfTest();
  wireSearch();
  wireTabs();
  renderRelayFooter();
  renderWatchlist();
  wireQuickButtons();
  const params = new URLSearchParams(location.search);
  if (params.get('s')) runAnalysis(params.get('s').toUpperCase());
});

function wireQuickButtons() {
  document.querySelectorAll('.quick-btn').forEach((b) => {
    b.onclick = () => { $('#search').value = b.dataset.s; history.replaceState(null, '', '?s=' + b.dataset.s); runAnalysis(b.dataset.s); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  });
}

// ---------------- search ----------------
function wireSearch() {
  const input = $('#search');
  const box = $('#suggestions');
  input.addEventListener('input', () => {
    const results = searchStocks(input.value);
    box.innerHTML = '';
    if (!results.length) { box.style.display = 'none'; return; }
    results.forEach((st) => {
      const item = el('div', 'suggestion', `<b>${st.s}</b> <span>${st.n}</span><em>${SECTORS[st.sector]}</em>`);
      item.onclick = () => { input.value = st.s; box.style.display = 'none'; runAnalysis(st.s); };
      box.appendChild(item);
    });
    box.style.display = 'block';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const r = searchStocks(input.value); if (r[0]) { box.style.display = 'none'; runAnalysis(r[0].s); } } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) box.style.display = 'none'; });
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $('#panel-' + t.dataset.tab).classList.add('active');
      if (t.dataset.tab === 'charts' && CURRENT) drawCharts();
    };
  });
  document.querySelectorAll('.range-btn').forEach((b) => {
    b.onclick = () => { CHART_RANGE = b.dataset.range; document.querySelectorAll('.range-btn').forEach((x) => x.classList.toggle('active', x === b)); if (CURRENT) drawCharts(); };
  });
}

// ---------------- main flow ----------------
async function runAnalysis(symbol) {
  const meta = STOCK_UNIVERSE.find((s) => s.s === symbol) || { s: symbol, n: symbol, sector: 'OTHER', industry: '—' };
  showLoading(meta);
  try {
    // fetch stock history, benchmark, and the (honestly unavailable) providers in parallel
    const [hist, bench, fundamentals, news, ownership] = await Promise.allSettled([
      P.getHistory(symbol, '5y', '1d'),
      fetchBenchmark(),
      P.getFundamentals(symbol),
      P.getNews(symbol),
      P.getOwnership(symbol),
    ]);

    if (hist.status !== 'fulfilled') throw hist.reason || new Error('history failed');
    const data = hist.value;
    let benchBars = null, benchSource = null;
    if (bench.status === 'fulfilled' && bench.value) { benchBars = bench.value.bars; benchSource = bench.value; }

    const bars = data.bars;
    const tech = A.technical(bars);
    const tr = A.trend(bars);
    const perf = A.performance(bars);
    const rk = A.risk(bars, benchBars);
    const rs = A.relativeStrength(bars, benchBars);
    const fu = fundamentals.value, nw = news.value, ow = ownership.value;

    const score = A.buildScore({ technical: tech, trend: tr, relStrength: rs, risk: rk, fundamentals: fu, ownership: ow, news: nw, sector: meta.sector });
    const rf = A.redFlags({ technical: tech, trend: tr, risk: rk, perf });
    const decision = A.decide(score, rk, rf.flags);

    CURRENT = { meta, data, bars, tech, tr, perf, rk, rs, score, rf, decision, fu, nw, ow, benchSource };
    renderAll(CURRENT);
  } catch (e) {
    showError(meta, e);
  }
}

async function fetchBenchmark() {
  // NIFTY 50 via Yahoo index ticker (^NSEI, URL-encoded as %5ENSEI). Uses /api when
  // deployed on Vercel, otherwise public relays — same fallback logic as everything else.
  try { return await P.getIndexHistory('%5ENSEI', 'NIFTY 50', '5y'); } catch (_) { return null; }
}

// ---------------- rendering ----------------
function showLoading(meta) {
  $('#result').style.display = 'block';
  $('#result').innerHTML = `<div class="loading"><div class="spinner"></div><p>Fetching live data for <b>${meta.s}</b> — ${meta.n}…</p><small>Routing through public CORS relays. If all relays are busy this can take a few seconds.</small></div>`;
}

function showError(meta, e) {
  $('#result').innerHTML = `
    <div class="error-card">
      <h2>⚠️ Could not load data for ${meta.s}</h2>
      <p>${(e && e.message) || e}</p>
      <p class="muted">This browser-only build depends on public CORS relays to reach Yahoo Finance, and those relays are sometimes rate-limited or down. No data is fabricated when a fetch fails (spec §36.1). Try again in a moment, or see the README for the backend deployment that removes this dependency.</p>
    </div>`;
}

function renderAll(R) {
  const { meta, data, decision, score, rk } = R;
  const price = data.meta.regularMarketPrice ?? R.tech.price;
  const prev = data.meta.previousClose;
  const dayChg = prev ? ((price - prev) / prev) * 100 : null;

  $('#result').innerHTML = '';
  const wrap = el('div', 'result-grid');

  // ---- header / verdict card ----
  const verdict = el('div', 'card verdict');
  verdict.innerHTML = `
    <div class="verdict-head">
      <div>
        <h2>${meta.n} <span class="sym">${meta.s}.NS</span></h2>
        <div class="tags"><span class="tag">${SECTORS[meta.sector]}</span><span class="tag">${meta.industry}</span><span class="tag">${data.meta.exchange}</span></div>
      </div>
      <button class="wl-btn" id="wlToggle">${inWatchlist(meta.s) ? '★ In watchlist' : '☆ Watchlist'}</button>
    </div>
    <div class="price-row">
      <span class="price">${fmtPrice(price)}</span>
      <span class="chg ${dayChg >= 0 ? 'pos' : 'neg'}">${dayChg == null ? '' : fmtPct(dayChg)}</span>
    </div>
    <div class="verdict-boxes">
      <div class="vbox big ${scoreClass(score.overall)}"><label>Investment Score</label><b>${score.overall}<small>/100</small></b></div>
      <div class="vbox ${ratingClass(decision.rating)}"><label>Rating</label><b>${decision.emoji} ${decision.rating}</b></div>
      <div class="vbox"><label>Confidence</label><b>${score.confidence}%</b></div>
      <div class="vbox"><label>Risk</label><b>${rk.level}</b></div>
      <div class="vbox"><label>Horizon</label><b class="small">${decision.horizon}</b></div>
      <div class="vbox"><label>Data Quality</label><b>${score.dataQuality}%</b></div>
    </div>
    ${decision.overrides.length ? `<div class="overrides">${decision.overrides.map((o) => `⚠️ ${o}`).join('<br>')}</div>` : ''}
    <div class="stamp">Generated ${fmtDateTime(Date.now())} · Data as of ${fmtDateTime(data.meta.regularMarketTime || data.fetchedAt)} · Source: ${data.source} via ${data.via}${data.cached ? ' (cached)' : ''}</div>
    <div class="disclaimer">This is a quantitative analytical signal from available data — <b>not</b> a guarantee of returns or personalized financial advice.</div>
  `;
  wrap.appendChild(verdict);

  // ---- tabs content ----
  const tabsHtml = $('#tabs-template').innerHTML;
  const tabsHost = el('div');
  tabsHost.innerHTML = tabsHtml;
  wrap.appendChild(tabsHost);
  $('#result').appendChild(wrap);

  // re-wire tabs (fresh DOM)
  wireTabs();

  renderOverview(R);
  renderScorePanel(R);
  renderTechnical(R);
  renderRiskPanel(R);
  renderFundamentals(R);
  renderNewsOwnership(R);
  renderAudit(R);

  $('#wlToggle').onclick = () => { toggleWatchlist(meta); $('#wlToggle').textContent = inWatchlist(meta.s) ? '★ In watchlist' : '☆ Watchlist'; renderWatchlist(); };
  drawCharts();
}

function renderOverview(R) {
  const host = $('#panel-overview'); if (!host) return;
  const { tr, perf, rs, rf, decision, score } = R;
  const bull = [], bear = [];
  R.score.breakdown.filter((b) => b.score != null).forEach((b) => {
    b.notes.forEach((n) => { if (n.includes('(+)') || n.includes('+')) bull.push(`${label(b.key)}: ${n}`); if (n.includes('(−)') || n.includes('−')) bear.push(`${label(b.key)}: ${n}`); });
  });
  rf.flags.forEach((f) => bear.push(`${f.label}: ${f.detail}`));

  host.innerHTML = `
    <div class="grid2">
      <div class="card">
        <h3>Trend (multi-timeframe)</h3>
        <table class="kv">
          <tr><td>Short term</td><td>${badge(tr.short)}</td></tr>
          <tr><td>Medium term</td><td>${badge(tr.medium)}</td></tr>
          <tr><td>Long term</td><td>${badge(tr.long)}</td></tr>
          <tr><td>Overall strength</td><td><b>${tr.strength}</b></td></tr>
        </table>
      </div>
      <div class="card">
        <h3>Relative strength vs NIFTY 50</h3>
        ${rs ? `<table class="kv">
          ${['3M', '6M', '1Y'].map((k) => rs[k] ? `<tr><td>${k}</td><td>Stock ${fmtPct(rs[k].stock)} · NIFTY ${fmtPct(rs[k].bench)} · <b class="${rs[k].diff >= 0 ? 'pos' : 'neg'}">${fmtPct(rs[k].diff)}</b></td></tr>` : '').join('')}
        </table>` : '<p class="muted">Benchmark data unavailable — relative strength not computed.</p>'}
      </div>
    </div>
    <div class="grid2">
      <div class="card bull"><h3>✓ Bull case</h3>${list(bull, 'No clearly positive signals from available data.')}</div>
      <div class="card bear"><h3>⚠️ Bear case / risks</h3>${list(bear, 'No clearly negative signals from available data.')}</div>
    </div>
    <div class="card">
      <h3>Investment thesis</h3>
      <p><b>Final view:</b> ${decision.emoji} ${decision.rating} · <b>Confidence:</b> ${score.confidence}% · <b>Suitable for:</b> ${decision.horizon} · <b>Main risk:</b> ${R.rk.level} volatility profile.</p>
      <p class="muted">Thesis is generated from deterministic signals only. Fundamental, valuation, ownership and news inputs are not available in this browser-only build, which is why confidence is capped — see the Data & Audit tab.</p>
    </div>`;
}

function renderScorePanel(R) {
  const host = $('#panel-score'); if (!host) return;
  const rows = R.score.breakdown.map((b) => `
    <tr class="${b.unavailable ? 'na' : ''}">
      <td>${label(b.key)}</td>
      <td>${b.baseWeight}%</td>
      <td>${b.unavailable ? '—' : b.effectiveWeight + '%'}</td>
      <td>${b.score == null ? '<span class="muted">not assessable</span>' : `<b class="${scoreClass(b.score)}">${b.score}</b>`}</td>
      <td>${b.contribution == null ? '—' : b.contribution}</td>
    </tr>`).join('');
  host.innerHTML = `
    <div class="card">
      <h3>Transparent score breakdown</h3>
      <p class="muted">Weights are re-normalized across only the components that could be computed. Missing components drag <b>Data Quality</b> and <b>Confidence</b> down instead of being guessed.</p>
      <table class="score-table">
        <thead><tr><th>Component</th><th>Base weight</th><th>Effective weight</th><th>Sub-score</th><th>Points</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4"><b>Overall</b></td><td><b>${R.score.overall}/100</b></td></tr></tfoot>
      </table>
      <div class="chart-box" style="height:320px"><canvas id="chartScore"></canvas></div>
    </div>`;
  C.scoreGauge('chartScore', R.score.breakdown.filter((b) => b.score != null));
}

function renderTechnical(R) {
  const host = $('#panel-technical'); if (!host) return;
  const t = R.tech;
  const sig = t.signals.map((s) => `<span class="sig ${s.tone}" title="${s.why}">${s.k}</span>`).join('');
  host.innerHTML = `
    <div class="card">
      <h3>Technical indicators <span class="muted small">(computed from adjusted daily closes)</span></h3>
      <div class="metrics">
        ${metric('Price', fmtPrice(t.price))}
        ${metric('SMA 20', fmtPrice(t.sma20))}
        ${metric('SMA 50', fmtPrice(t.sma50))}
        ${metric('SMA 100', fmtPrice(t.sma100))}
        ${metric('SMA 200', fmtPrice(t.sma200))}
        ${metric('EMA 20', fmtPrice(t.ema20))}
        ${metric('EMA 50', fmtPrice(t.ema50))}
        ${metric('RSI 14', fmtNum(t.rsi14))}
        ${metric('MACD', t.macd ? fmtNum(t.macd.macd, 3) : '—')}
        ${metric('MACD signal', t.macd ? fmtNum(t.macd.signal, 3) : '—')}
        ${metric('ATR 14', fmtNum(t.atr14))}
        ${metric('ADX 14', fmtNum(t.adx14))}
        ${metric('Boll upper', t.bollinger ? fmtPrice(t.bollinger.upper) : '—')}
        ${metric('Boll lower', t.bollinger ? fmtPrice(t.bollinger.lower) : '—')}
        ${metric('52W high', fmtPrice(t.high52))}
        ${metric('52W low', fmtPrice(t.low52))}
        ${metric('Vol (last)', t.volLast ? Number(t.volLast).toLocaleString('en-IN') : '—')}
        ${metric('Vol avg 20', t.volAvg20 ? Math.round(t.volAvg20).toLocaleString('en-IN') : '—')}
      </div>
      <h4>Signals</h4><div class="signals">${sig || '<span class="muted">none</span>'}</div>
      <p class="muted small">Per spec §9, no single indicator drives the rating — these feed the weighted score.</p>
    </div>`;
}

function renderRiskPanel(R) {
  const host = $('#panel-risk'); if (!host) return;
  const { rk, perf } = R;
  const retRows = Object.entries(perf.returns).map(([k, v]) => `<tr><td>${k}</td><td class="${v >= 0 ? 'pos' : 'neg'}">${fmtPct(v)}</td></tr>`).join('');
  const cagrRows = Object.entries(perf.cagr).map(([k, v]) => `<tr><td>${k} CAGR</td><td class="${v >= 0 ? 'pos' : 'neg'}">${fmtPct(v)}</td></tr>`).join('');
  host.innerHTML = `
    <div class="grid2">
      <div class="card">
        <h3>Returns & CAGR</h3>
        <table class="kv">${retRows}${cagrRows}</table>
      </div>
      <div class="card">
        <h3>Risk metrics</h3>
        <table class="kv">
          <tr><td>Annualized volatility</td><td>${fmtNum(rk.volatility)}%</td></tr>
          <tr><td>Downside volatility</td><td>${fmtNum(rk.downside)}%</td></tr>
          <tr><td>Max drawdown (5Y)</td><td class="neg">${fmtNum(rk.maxDrawdown)}%</td></tr>
          <tr><td>Sharpe (rf 6.5%)</td><td>${fmtNum(rk.sharpe)}</td></tr>
          <tr><td>Beta vs NIFTY 50</td><td>${fmtNum(rk.beta)}</td></tr>
          <tr><td>Risk score</td><td><b>${rk.riskScore ?? '—'}/100 (${rk.level})</b></td></tr>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Red-flag engine</h3>
      ${R.rf.flags.length ? `<div class="signals">${R.rf.flags.map((f) => `<span class="sig ${f.severity === 'critical' ? 'neg' : f.severity === 'warn' ? 'warn' : 'neu'}" title="${f.detail}">${f.label}</span>`).join('')}</div>` : '<p class="muted">No price/volatility-based red flags triggered.</p>'}
      <h4>Not assessable in this build <span class="muted small">(absence ≠ clean — spec §36.13)</span></h4>
      <div class="signals">${R.rf.notAssessable.map((n) => `<span class="sig na-flag">${n}</span>`).join('')}</div>
    </div>`;
}

function renderFundamentals(R) {
  const host = $('#panel-fundamentals'); if (!host) return;
  const fu = R.fu;
  if (!fu || !fu.available) {
    host.innerHTML = `
      <div class="card unavailable">
        <h3>Fundamentals, valuation & growth</h3>
        <div class="na-banner">⚠️ Not available on this deployment</div>
        <p>${fu ? fu.reason : 'No fundamentals returned.'}</p>
        ${fu && fu.fields ? `<p class="muted">Fields the server proxy would populate: ${fu.fields.map((f) => `<span class="chip">${f}</span>`).join(' ')}</p>` : ''}
        <p class="muted small">Per spec §36.1-2 these are shown as <b>unavailable</b> rather than filled with invented numbers. Deploy on Vercel (with the <code>/api/quote</code> function) to enable them.</p>
      </div>`;
    return;
  }
  const pc = (d) => (d == null ? '—' : fmtNum(d * 100) + '%');
  const cr = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 2 }));
  const v = fu.valuation || {}, p = fu.profitability || {}, g = fu.growth || {}, h = fu.health || {};
  host.innerHTML = `
    <div class="grid2">
      <div class="card"><h3>Valuation</h3><table class="kv">
        <tr><td>Trailing P/E</td><td>${fmtNum(v.trailingPE)}</td></tr>
        <tr><td>Forward P/E</td><td>${fmtNum(v.forwardPE)}</td></tr>
        <tr><td>P/B</td><td>${fmtNum(v.priceToBook)}</td></tr>
        <tr><td>PEG</td><td>${fmtNum(v.pegRatio)}</td></tr>
        <tr><td>Price / Sales</td><td>${fmtNum(v.priceToSales)}</td></tr>
        <tr><td>EV / EBITDA</td><td>${fmtNum(v.enterpriseToEbitda)}</td></tr>
        <tr><td>Dividend yield</td><td>${pc(v.dividendYield)}</td></tr>
        <tr><td>Market cap</td><td>${cr(v.marketCap)}</td></tr>
      </table></div>
      <div class="card"><h3>Profitability</h3><table class="kv">
        <tr><td>ROE</td><td>${pc(p.returnOnEquity)}</td></tr>
        <tr><td>ROA</td><td>${pc(p.returnOnAssets)}</td></tr>
        <tr><td>Gross margin</td><td>${pc(p.grossMargins)}</td></tr>
        <tr><td>Operating margin</td><td>${pc(p.operatingMargins)}</td></tr>
        <tr><td>Net margin</td><td>${pc(p.profitMargins)}</td></tr>
      </table></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Growth</h3><table class="kv">
        <tr><td>Revenue growth (YoY)</td><td>${pc(g.revenueGrowth)}</td></tr>
        <tr><td>Earnings growth (YoY)</td><td>${pc(g.earningsGrowth)}</td></tr>
        <tr><td>Earnings growth (Qtr YoY)</td><td>${pc(g.earningsQuarterlyGrowth)}</td></tr>
      </table></div>
      <div class="card"><h3>Financial health</h3><table class="kv">
        <tr><td>Debt / Equity</td><td>${h.debtToEquity == null ? '—' : fmtNum(h.debtToEquity / 100) + 'x'}</td></tr>
        <tr><td>Current ratio</td><td>${fmtNum(h.currentRatio)}</td></tr>
        <tr><td>Total cash</td><td>${cr(h.totalCash)}</td></tr>
        <tr><td>Total debt</td><td>${cr(h.totalDebt)}</td></tr>
        <tr><td>Free cash flow</td><td class="${h.freeCashflow > 0 ? 'pos' : h.freeCashflow < 0 ? 'neg' : ''}">${cr(h.freeCashflow)}</td></tr>
        <tr><td>Operating cash flow</td><td>${cr(h.operatingCashflow)}</td></tr>
      </table></div>
    </div>
    <p class="stamp">Source: ${fu.source} · fetched ${fmtDateTime(fu.asOf)}${fu.cached ? ' (cached)' : ''}. Values are as reported by the data vendor; ratios that were not returned show “—”, never a guess.</p>`;
}

function renderNewsOwnership(R) {
  const host = $('#panel-news'); if (!host) return;
  host.innerHTML = `
    <div class="grid2">
      <div class="card unavailable"><h3>News & sentiment</h3><div class="na-banner">⚠️ Requires backend</div><p>${R.nw.reason}</p></div>
      <div class="card unavailable"><h3>Promoter & ownership</h3><div class="na-banner">⚠️ Requires backend</div><p>${R.ow.reason}</p></div>
    </div>`;
}

function renderAudit(R) {
  const host = $('#panel-audit'); if (!host) return;
  const { data, score } = R;
  host.innerHTML = `
    <div class="card">
      <h3>Data & audit trail (spec §35)</h3>
      <table class="kv">
        <tr><td>Recommendation generated</td><td>${fmtDateTime(Date.now())}</td></tr>
        <tr><td>Price data as of</td><td>${fmtDateTime(data.meta.regularMarketTime || data.fetchedAt)}</td></tr>
        <tr><td>Primary source</td><td>${data.source}</td></tr>
        <tr><td>Fetched via relay</td><td>${data.via}${data.cached ? ' (served from cache)' : ''}</td></tr>
        <tr><td>Bars analyzed</td><td>${R.bars.length} daily bars (${new Date(R.bars[0].t).toLocaleDateString('en-IN')} → ${new Date(R.bars[R.bars.length - 1].t).toLocaleDateString('en-IN')})</td></tr>
        <tr><td>Benchmark</td><td>${R.benchSource ? R.benchSource.name + ' via ' + R.benchSource.via : 'unavailable'}</td></tr>
        <tr><td>Data quality</td><td><b>${score.dataQuality}%</b> (share of intended scoring weight that was computable)</td></tr>
        <tr><td>Confidence</td><td><b>${score.confidence}%</b></td></tr>
      </table>
      <h4>Why the score is ${score.overall}?</h4>
      <p class="muted">Expand the "Score" tab — every component's sub-score, base weight, re-normalized weight and point contribution is listed. Overall = Σ(sub-score × effective weight).</p>
      <div class="honesty">
        <h4>Honesty ledger</h4>
        <ul>
          <li>No price or ratio is fabricated; failed fetches show an error, not a guess.</li>
          <li>Data is delayed (Yahoo India), never presented as real-time — timestamps shown above.</li>
          <li>Fundamentals come from the <code>/api/quote</code> server proxy when deployed; news / ownership / backtesting still need further integrations and are marked unavailable.</li>
          <li>All indicators computed by <code>indicators.js</code> (deterministic), verified by a console self-test.</li>
        </ul>
      </div>
    </div>`;
}

function drawCharts() {
  if (!CURRENT) return;
  if ($('#chartPrice')) C.priceChart(CURRENT.bars, CHART_RANGE);
  if ($('#chartVolume')) C.volumeChart(CURRENT.bars, CHART_RANGE);
  if ($('#chartRsi')) C.rsiChart(CURRENT.bars, CHART_RANGE);
}

// ---------------- watchlist (localStorage, spec §27) ----------------
const WL_KEY = 'sa_watchlist';
const getWL = () => { try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; } catch (_) { return []; } };
const setWL = (a) => localStorage.setItem(WL_KEY, JSON.stringify(a));
const inWatchlist = (s) => getWL().some((x) => x.s === s);
function toggleWatchlist(meta) {
  let wl = getWL();
  if (inWatchlist(meta.s)) wl = wl.filter((x) => x.s !== meta.s);
  else wl.push({ s: meta.s, n: meta.n });
  setWL(wl);
}
function renderWatchlist() {
  const host = $('#watchlist'); if (!host) return;
  const wl = getWL();
  if (!wl.length) { host.innerHTML = '<p class="muted small">Your watchlist is empty. Analyze a stock and tap ☆ Watchlist to add it.</p>'; return; }
  host.innerHTML = wl.map((x) => `<span class="wl-chip" data-s="${x.s}"><b>${x.s}</b> ${x.n} <i data-del="${x.s}">✕</i></span>`).join('');
  host.querySelectorAll('.wl-chip').forEach((c) => {
    c.onclick = (e) => {
      if (e.target.dataset.del) { setWL(getWL().filter((x) => x.s !== e.target.dataset.del)); renderWatchlist(); return; }
      runAnalysis(c.dataset.s); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
}

// ---------------- footer / helpers ----------------
function renderRelayFooter() {
  const f = $('#relays'); if (f) f.textContent = P.relayNames().join(' → ');
}
const label = (k) => ({ fundamentals: 'Fundamentals', growth: 'Growth quality', financialHealth: 'Financial health', valuation: 'Valuation', technical: 'Technical trend', relativeStrength: 'Relative strength', ownership: 'Management / ownership', news: 'News & events', risk: 'Risk adjustment' }[k] || k);
const metric = (l, v) => `<div class="metric"><label>${l}</label><b>${v}</b></div>`;
const list = (arr, empty) => (arr.length ? `<ul>${arr.slice(0, 8).map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`);
const badge = (v) => (v ? `<span class="badge ${v.toLowerCase()}">${v}</span>` : '—');
const scoreClass = (s) => (s == null ? '' : s >= 60 ? 'pos' : s >= 45 ? 'warn' : 'neg');
const ratingClass = (r) => (r.includes('BUY') ? 'pos' : r.includes('HOLD') || r.includes('WATCH') ? 'warn' : 'neg');
