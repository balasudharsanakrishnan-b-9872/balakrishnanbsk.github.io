// app.js — orchestration + rendering. Ties providers -> analysis -> UI.
// Keeps a clear separation: data in (providers), math (indicators/analysis), view (here).

import { STOCK_UNIVERSE, SECTORS, BENCHMARK, SECTOR_INDEX, searchStocks } from './stocks.js';
import * as P from './providers.js';
import * as A from './analysis.js';
import * as I from './indicators.js';
import * as C from './charts.js';
import { icon, logoMark, faviconDataUri } from './icons.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmtNum = (x, d = 2) => (x == null ? '—' : Number(x).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtPct = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmtNum(x)}%`);
const fmtPrice = (x) => (x == null ? '—' : '₹' + fmtNum(x));
const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

let CURRENT = null; // last analysis result
let CHART_RANGE = '1Y';

// Testing seam: with ?e2e=1 expose render internals so an automated harness can render
// a fixture offline (it exposes no data of its own — the caller supplies everything).
try {
  if (new URLSearchParams(location.search).get('e2e') === '1') {
    window.__e2e = { renderAll, setCurrent: (r) => { CURRENT = r; } };
  }
} catch (_) {}

// ---------------- boot ----------------
window.addEventListener('DOMContentLoaded', () => {
  I._selfTest();
  setupChrome();
  wireSearch();
  wireTabs();
  renderRelayFooter();
  renderWatchlist();
  wireQuickButtons();
  const params = new URLSearchParams(location.search);
  if (params.get('s')) runAnalysis(params.get('s').toUpperCase());
});

// Inject brand logo, favicon, static icons, and wire the theme toggle.
function setupChrome() {
  const set = (sel, html) => { const n = $(sel); if (n) n.innerHTML = html; };
  set('#logoMark', logoMark(34, 'top'));
  set('#footMark', logoMark(22, 'foot'));
  set('#searchIcon', icon('search', 'ic'));
  set('#noticeIcon', icon('shield', 'ic'));
  set('#wlHeadIcon', icon('star', 'ic'));
  set('#introEyebrow', icon('bolt', 'ic') + ' Decision support, not predictions');
  const fav = $('#favicon'); if (fav) fav.setAttribute('href', faviconDataUri());

  const btn = $('#themeToggle');
  const apply = (mode) => {
    if (mode) document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    const dark = mode ? mode === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    if (btn) { btn.innerHTML = icon(dark ? 'sun' : 'moon', 'ic'); btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); }
  };
  let stored = null; try { stored = localStorage.getItem('sa_theme'); } catch (_) {}
  apply(stored === 'light' || stored === 'dark' ? stored : null);
  if (btn) btn.onclick = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    try { localStorage.setItem('sa_theme', next); } catch (_) {}
    apply(next);
    if (CURRENT) { drawCharts(); if ($('#chartScore')) renderScorePanel(CURRENT); }
  };
}

function wireQuickButtons() {
  document.querySelectorAll('.quick-btn').forEach((b) => {
    b.onclick = () => { $('#search').value = b.dataset.s; history.replaceState(null, '', '?s=' + b.dataset.s); runAnalysis(b.dataset.s); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  });
}

// ---------------- search ----------------
function wireSearch() {
  const input = $('#search');
  const box = $('#suggestions');
  let seq = 0, timer = null;

  const row = (it) => {
    const badge = it.exch ? `<em class="exch ${it.exch.toLowerCase()}">${it.exch}</em>` : '';
    const item = el('div', 'suggestion', `<b>${it.s}</b> <span>${it.n}</span>${badge}`);
    item.setAttribute('role', 'option');
    item.onclick = () => { input.value = it.s; close(); runAnalysis(it.query || it.s, { n: it.n, sector: it.sector, industry: it.industry }); };
    return item;
  };
  const open = () => { box.style.display = 'block'; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { box.style.display = 'none'; input.setAttribute('aria-expanded', 'false'); };
  const paint = (items, note) => {
    box.innerHTML = '';
    if (note) box.appendChild(el('div', 'suggestion note', `<span class="muted">${note}</span>`));
    items.forEach((it) => box.appendChild(row(it)));
    if (items.length || note) open(); else close();
  };

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    // 1) instant local shortlist
    const local = searchStocks(q).map((st) => ({ s: st.s, n: st.n, exch: 'NSE', sector: st.sector, industry: st.industry, query: st.s }));
    paint(local, 'Searching all NSE / BSE listings…');
    // 2) live directory search (debounced; ignore stale responses)
    const mySeq = ++seq;
    const live = await P.searchSymbols(q);
    if (mySeq !== seq) return;
    const merged = [...local];
    live.forEach((r) => { if (!merged.some((m) => (m.query || m.s) === r.yahoo)) merged.push({ s: r.s, n: r.name, exch: r.exch, query: r.yahoo }); });
    if (!merged.length) {
      const up = q.toUpperCase();
      paint([{ s: up, n: 'Analyze this symbol directly', exch: /^\d+$/.test(up) ? 'BSE' : 'NSE', query: up }], 'No name match — try the raw symbol/code:');
    } else {
      paint(merged.slice(0, 12), null);
    }
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 250); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Enter') return;
    const q = input.value.trim();
    if (!q) return;
    close();
    const r = searchStocks(q);
    runAnalysis(r[0] ? r[0].s : q.toUpperCase()); // known name if matched, else analyze the raw symbol/code
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) close(); });
}

function wireTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const select = (t, focus) => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', on ? 'true' : 'false');
      x.tabIndex = on ? 0 : -1;
      const panel = $('#panel-' + x.dataset.tab);
      if (panel) { panel.classList.toggle('active', on); panel.hidden = !on; }
    });
    if (focus) t.focus();
    if (t.dataset.tab === 'charts' && CURRENT) drawCharts();
  };
  tabs.forEach((t, i) => {
    t.onclick = () => select(t);
    t.onkeydown = (e) => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j != null) { e.preventDefault(); select(tabs[j], true); }
    };
  });
  document.querySelectorAll('.range-btn').forEach((b) => {
    b.onclick = () => { CHART_RANGE = b.dataset.range; document.querySelectorAll('.range-btn').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); if (CURRENT) drawCharts(); };
  });
}

// ---------------- main flow ----------------
async function runAnalysis(symbol, override) {
  const meta =
    STOCK_UNIVERSE.find((s) => s.s === symbol) ||
    { s: symbol, n: (override && override.n) || symbol, sector: (override && override.sector) || 'OTHER', industry: (override && override.industry) || '—' };
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
  $('#result').innerHTML = `<div class="loading"><div class="spinner"></div><p>Fetching live data for <b>${meta.s}</b> — ${meta.n}…</p><small class="muted">Live market data, fetched per-symbol. This can take a few seconds.</small></div>`;
}

function showError(meta, e) {
  $('#result').innerHTML = `
    <div class="error-card">
      <h2>${icon('alert', 'ic')} Could not load data for ${meta.s}</h2>
      <p>${(e && e.message) || e}</p>
      <p class="muted">The market-data source may be momentarily rate-limited, or this ticker may not be covered. No data is fabricated when a fetch fails — try again in a moment, or check the exact NSE symbol / BSE code.</p>
    </div>`;
}

function renderAll(R) {
  const { meta, data, decision, score, rk } = R;
  const price = data.meta.regularMarketPrice ?? R.tech.price;
  const prev = data.meta.previousClose;
  const dayChg = prev ? ((price - prev) / prev) * 100 : null;

  const result = $('#result');
  result.style.display = 'block'; // ensure visible even if render is invoked directly
  result.innerHTML = '';
  const wrap = el('div', 'result-grid');

  // ---- header / verdict card ----
  const rc = ratingClass(decision.rating);
  const verdict = el('div', 'card verdict');
  verdict.innerHTML = `
    <div class="verdict-top">
      <div class="gauge-wrap">${gaugeSVG(score.overall)}
        <div class="g-label"><div class="g-num ${scoreClass(score.overall)}">${score.overall}</div><div class="g-cap">Score / 100</div></div>
      </div>
      <div class="verdict-id">
        <h2>${meta.n} <span class="sym">${data.yahoo || meta.s}</span></h2>
        <div class="tags"><span class="tag">${SECTORS[meta.sector]}</span><span class="tag">${meta.industry}</span><span class="tag">${data.exchange || data.meta.exchange}</span></div>
        <div class="rating-pill ${rc}">${icon(ratingIcon(decision.rating), 'ic')} ${decision.rating}</div>
      </div>
      <div class="verdict-price">
        <div class="price">${fmtPrice(price)}</div>
        <div class="chg ${dayChg >= 0 ? 'pos' : 'neg'}">${dayChg == null ? '' : icon(dayChg >= 0 ? 'trendUp' : 'trendDown', 'ic') + ' ' + fmtPct(dayChg)}</div>
        <button class="wl-btn ${inWatchlist(meta.s) ? 'on' : ''}" id="wlToggle" aria-pressed="${inWatchlist(meta.s)}">${icon(inWatchlist(meta.s) ? 'starFilled' : 'star', 'ic')} ${inWatchlist(meta.s) ? 'Saved' : 'Watchlist'}</button>
      </div>
    </div>
    <div class="verdict-boxes">
      ${vbox('gauge', 'Confidence', score.confidence + '%')}
      ${vbox('shield', 'Risk', rk.level)}
      ${vbox('clock', 'Horizon', decision.horizon, true)}
      ${vbox('database', 'Data Quality', score.dataQuality + '%')}
    </div>
    ${decision.overrides.length ? `<div class="overrides">${decision.overrides.map((o) => `<div>${icon('alert', 'ic')} <span>${o}</span></div>`).join('')}</div>` : ''}
    <div class="stamp">Generated ${fmtDateTime(Date.now())} · Data as of ${fmtDateTime(data.meta.regularMarketTime || data.fetchedAt)} · ${data.source}${data.cached ? ' (cached)' : ''}</div>
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

  $('#wlToggle').onclick = () => {
    toggleWatchlist(meta);
    const on = inWatchlist(meta.s);
    const btn = $('#wlToggle');
    btn.className = 'wl-btn ' + (on ? 'on' : '');
    btn.setAttribute('aria-pressed', on);
    btn.innerHTML = icon(on ? 'starFilled' : 'star', 'ic') + ' ' + (on ? 'Saved' : 'Watchlist');
    renderWatchlist();
  };
  drawCharts();
}

// Circular score gauge as inline SVG (band-colored ring + track). Animated stroke unless
// the user prefers reduced motion. Accessible number is rendered separately in .g-label.
function gaugeSVG(score) {
  const r = 56, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
  const col = score >= 60 ? 'var(--pos)' : score >= 45 ? 'var(--warn)' : 'var(--neg)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dash = reduce ? `${c * pct} ${c}` : '';
  const anim = reduce ? '' : `<animate attributeName="stroke-dasharray" from="0 ${c}" to="${c * pct} ${c}" dur="0.9s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1"/>`;
  return `<svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label="Overall score ${score} out of 100">
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round"
      transform="rotate(-90 66 66)" stroke-dasharray="${dash || '0 ' + c}">${anim}</circle>
  </svg>`;
}

const vbox = (ic, label, val, small) =>
  `<div class="vbox">${icon(ic, 'ic')}<div class="vb-txt"><label>${label}</label><b class="${small ? 'small' : ''}">${val}</b></div></div>`;

function renderOverview(R) {
  const host = $('#panel-overview'); if (!host) return;
  const { tr, perf, rs, rf, decision, score } = R;
  const bull = [], bear = [];
  R.score.breakdown.filter((b) => b.score != null).forEach((b) => {
    b.notes.forEach((n) => { if (n.includes('(+)') || n.includes('+')) bull.push(`${label(b.key)}: ${n}`); if (n.includes('(−)') || n.includes('−')) bear.push(`${label(b.key)}: ${n}`); });
  });
  rf.flags.forEach((f) => bear.push(`${f.label}: ${f.detail}`));

  const dqNote = score.dataQuality < 60
    ? 'Some inputs (e.g. news, ownership, backtesting) are not available on this deployment, which is why confidence is capped'
    : 'Confidence reflects how much of the intended scoring weight was computable from available data';
  host.innerHTML = `
    <div class="grid2">
      <div class="card">
        <h3>${icon('activity', 'ic')} Trend (multi-timeframe)</h3>
        <table class="kv">
          <tr><td>Short term</td><td>${badge(tr.short)}</td></tr>
          <tr><td>Medium term</td><td>${badge(tr.medium)}</td></tr>
          <tr><td>Long term</td><td>${badge(tr.long)}</td></tr>
          <tr><td>Overall strength</td><td><b>${tr.strength}</b></td></tr>
        </table>
      </div>
      <div class="card">
        <h3>${icon('trendUp', 'ic')} Relative strength vs NIFTY 50</h3>
        ${rs ? `<table class="kv">
          ${['3M', '6M', '1Y'].map((k) => rs[k] ? `<tr><td>${k}</td><td>Stock ${fmtPct(rs[k].stock)} · NIFTY ${fmtPct(rs[k].bench)} · <b class="${rs[k].diff >= 0 ? 'pos' : 'neg'}">${fmtPct(rs[k].diff)}</b></td></tr>` : '').join('')}
        </table>` : '<p class="muted">Benchmark data unavailable — relative strength not computed.</p>'}
      </div>
    </div>
    <div class="grid2">
      <div class="card bull"><h3>${icon('check', 'ic')} Bull case</h3>${list(bull, 'No clearly positive signals from available data.')}</div>
      <div class="card bear"><h3>${icon('alert', 'ic')} Bear case / risks</h3>${list(bear, 'No clearly negative signals from available data.')}</div>
    </div>
    <div class="card">
      <h3>${icon('bolt', 'ic')} Investment thesis</h3>
      <p><b>Final view:</b> <span class="${ratingClass(decision.rating)}">${decision.rating}</span> · <b>Confidence:</b> ${score.confidence}% · <b>Suitable for:</b> ${decision.horizon} · <b>Main risk:</b> ${R.rk.level} volatility profile.</p>
      <p class="muted">Thesis is generated from deterministic signals only. ${dqNote} — see the Data &amp; Audit tab.</p>
    </div>`;
}

function renderScorePanel(R) {
  const host = $('#panel-score'); if (!host) return;
  const barColor = (s) => (s >= 60 ? 'var(--pos)' : s >= 45 ? 'var(--warn)' : 'var(--neg)');
  const rows = R.score.breakdown.map((b) => `
    <tr class="${b.unavailable ? 'na' : ''}">
      <td>${label(b.key)}</td>
      <td>${b.baseWeight}%</td>
      <td>${b.unavailable ? '—' : b.effectiveWeight + '%'}</td>
      <td>${b.score == null ? '<span class="muted">n/a</span>' : `<span class="bar" aria-hidden="true"><i style="width:${b.score}%;background:${barColor(b.score)}"></i></span> <b class="${scoreClass(b.score)}">${b.score}</b>`}</td>
      <td>${b.contribution == null ? '—' : b.contribution}</td>
    </tr>`).join('');
  host.innerHTML = `
    <div class="card">
      <h3>${icon('layers', 'ic')} Transparent score breakdown</h3>
      <p class="muted">Weights are re-normalized across only the components that could be computed. Missing components drag <b>Data Quality</b> and <b>Confidence</b> down instead of being guessed.</p>
      <div class="table-scroll"><table class="score-table">
        <thead><tr><th>Component</th><th>Base wt</th><th>Eff. wt</th><th>Sub-score</th><th>Points</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4"><b>Overall</b></td><td><b>${R.score.overall}/100</b></td></tr></tfoot>
      </table></div>
      <div class="chart-box" style="height:320px"><canvas id="chartScore" aria-label="Score by component"></canvas></div>
    </div>`;
  C.scoreGauge('chartScore', R.score.breakdown.filter((b) => b.score != null));
}

function renderTechnical(R) {
  const host = $('#panel-technical'); if (!host) return;
  const t = R.tech;
  const sigIcon = (tone) => ({ pos: 'trendUp', neg: 'trendDown', warn: 'alert', neu: 'info' }[tone] || 'info');
  const sig = t.signals.map((s) => `<span class="sig ${s.tone === 'neu' ? '' : s.tone}" title="${s.why}">${icon(sigIcon(s.tone), 'ic')} ${s.k}</span>`).join('');
  host.innerHTML = `
    <div class="card">
      <h3>${icon('activity', 'ic')} Technical indicators <span class="muted small">(from adjusted daily closes)</span></h3>
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
        <h3>${icon('barChart', 'ic')} Returns & CAGR</h3>
        <table class="kv">${retRows}${cagrRows}</table>
      </div>
      <div class="card">
        <h3>${icon('shield', 'ic')} Risk metrics</h3>
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
      <h3>${icon('alert', 'ic')} Red-flag engine</h3>
      ${R.rf.flags.length ? `<div class="signals">${R.rf.flags.map((f) => `<span class="sig ${f.severity === 'critical' ? 'neg' : f.severity === 'warn' ? 'warn' : ''}" title="${f.detail}">${icon(f.severity === 'info' ? 'info' : 'alert', 'ic')} ${f.label}</span>`).join('')}</div>` : `<p class="muted">${icon('check', 'ic')} No price/volatility-based red flags triggered.</p>`}
      <h4>Not assessable here <span class="muted small">(absence ≠ clean)</span></h4>
      <div class="signals">${R.rf.notAssessable.map((n) => `<span class="sig na-flag">${n}</span>`).join('')}</div>
    </div>`;
}

function renderFundamentals(R) {
  const host = $('#panel-fundamentals'); if (!host) return;
  const fu = R.fu;
  if (!fu || !fu.available) {
    host.innerHTML = `
      <div class="card unavailable">
        <h3>${icon('layers', 'ic')} Fundamentals, valuation & growth</h3>
        <div class="na-banner">${icon('alert', 'ic')} Not available on this deployment</div>
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
      <div class="card"><h3>${icon('scale', 'ic')} Valuation</h3><table class="kv">
        <tr><td>Trailing P/E</td><td>${fmtNum(v.trailingPE)}</td></tr>
        <tr><td>Forward P/E</td><td>${fmtNum(v.forwardPE)}</td></tr>
        <tr><td>P/B</td><td>${fmtNum(v.priceToBook)}</td></tr>
        <tr><td>PEG</td><td>${fmtNum(v.pegRatio)}</td></tr>
        <tr><td>Price / Sales</td><td>${fmtNum(v.priceToSales)}</td></tr>
        <tr><td>EV / EBITDA</td><td>${fmtNum(v.enterpriseToEbitda)}</td></tr>
        <tr><td>Dividend yield</td><td>${pc(v.dividendYield)}</td></tr>
        <tr><td>Market cap</td><td>${cr(v.marketCap)}</td></tr>
      </table></div>
      <div class="card"><h3>${icon('growth', 'ic')} Profitability</h3><table class="kv">
        <tr><td>ROE</td><td>${pc(p.returnOnEquity)}</td></tr>
        <tr><td>ROA</td><td>${pc(p.returnOnAssets)}</td></tr>
        <tr><td>Gross margin</td><td>${pc(p.grossMargins)}</td></tr>
        <tr><td>Operating margin</td><td>${pc(p.operatingMargins)}</td></tr>
        <tr><td>Net margin</td><td>${pc(p.profitMargins)}</td></tr>
      </table></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>${icon('trendUp', 'ic')} Growth</h3><table class="kv">
        <tr><td>Revenue growth (YoY)</td><td>${pc(g.revenueGrowth)}</td></tr>
        <tr><td>Earnings growth (YoY)</td><td>${pc(g.earningsGrowth)}</td></tr>
        <tr><td>Earnings growth (Qtr YoY)</td><td>${pc(g.earningsQuarterlyGrowth)}</td></tr>
      </table></div>
      <div class="card"><h3>${icon('health', 'ic')} Financial health</h3><table class="kv">
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
      <div class="card unavailable"><h3>${icon('newspaper', 'ic')} News & sentiment</h3><div class="na-banner">${icon('alert', 'ic')} Requires backend</div><p>${R.nw.reason}</p></div>
      <div class="card unavailable"><h3>${icon('briefcase', 'ic')} Promoter & ownership</h3><div class="na-banner">${icon('alert', 'ic')} Requires backend</div><p>${R.ow.reason}</p></div>
    </div>`;
}

function renderAudit(R) {
  const host = $('#panel-audit'); if (!host) return;
  const { data, score } = R;
  host.innerHTML = `
    <div class="card">
      <h3>${icon('database', 'ic')} Data & audit trail</h3>
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
  if (!wl.length) { host.innerHTML = `<p class="muted small">Your watchlist is empty. Analyze a stock and tap ${icon('star', 'ic')} Watchlist to save it.</p>`; return; }
  host.innerHTML = wl.map((x) => `<span class="wl-chip" data-s="${x.s}" role="button" tabindex="0"><b>${x.s}</b> <span class="muted">${x.n}</span> <span class="del" data-del="${x.s}" role="button" aria-label="Remove ${x.s}">${icon('close', 'ic')}</span></span>`).join('');
  const open = (c) => { runAnalysis(c.dataset.s); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  host.querySelectorAll('.wl-chip').forEach((c) => {
    c.onclick = (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); setWL(getWL().filter((x) => x.s !== del.dataset.del)); renderWatchlist(); return; }
      open(c);
    };
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(c); } };
  });
}

// ---------------- footer / helpers ----------------
function renderRelayFooter() {
  const f = $('#relays'); if (f) f.textContent = P.relayNames().join(' → ');
}
const label = (k) => ({ fundamentals: 'Fundamentals', growth: 'Growth quality', financialHealth: 'Financial health', valuation: 'Valuation', technical: 'Technical trend', relativeStrength: 'Relative strength', ownership: 'Management / ownership', news: 'News & events', risk: 'Risk adjustment' }[k] || k);
const metric = (l, v) => `<div class="metric"><label>${l}</label><b>${v}</b></div>`;
const list = (arr, empty) => (arr.length ? `<ul>${arr.slice(0, 8).map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`);
const badge = (v) => {
  if (!v) return '—';
  const ic = v === 'Bullish' ? 'trendUp' : v === 'Bearish' ? 'trendDown' : 'arrowRight';
  return `<span class="badge ${v.toLowerCase()}">${icon(ic, 'ic')} ${v}</span>`;
};
const scoreClass = (s) => (s == null ? '' : s >= 60 ? 'pos' : s >= 45 ? 'warn' : 'neg');
const ratingClass = (r) => (r.includes('BUY') ? 'pos' : r.includes('HOLD') || r.includes('WATCH') ? 'warn' : 'neg');
const ratingIcon = (r) => (r.includes('BUY') ? 'trendUp' : r.includes('HOLD') || r.includes('WATCH') ? 'info' : 'trendDown');
