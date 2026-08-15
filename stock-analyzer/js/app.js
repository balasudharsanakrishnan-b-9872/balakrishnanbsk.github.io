// app.js — orchestration + rendering. Ties providers -> analysis -> UI.
// Keeps a clear separation: data in (providers), math (indicators/analysis), view (here).

import { STOCK_UNIVERSE, SECTORS, BENCHMARK, SECTOR_INDEX, searchStocks, toYahoo } from './stocks.js';
import * as P from './providers.js';
import * as A from './analysis.js';
import * as I from './indicators.js';
import * as C from './charts.js';
import { icon, logoMark, faviconDataUri } from './icons.js';
import * as G from './gsync.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmtNum = (x, d = 2) => (x == null ? '—' : Number(x).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtPct = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmtNum(x)}%`);
const fmtPrice = (x) => (x == null ? '—' : '₹' + fmtNum(x));
const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

let CURRENT = null; // last analysis result
let CHART_RANGE = '1Y';
let loading = false; // true while an analysis is in flight — blocks new requests
let FIN_PERIOD = 'annual'; // Financials tab: 'annual' | 'quarterly'
let lastQuotes = new Map(); // symbol -> latest quote (from the home movers fetch) for the live watchlist

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
  else loadHome();
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

  // clicking the brand returns to the Markets home
  const brand = $('.brand');
  if (brand) {
    brand.setAttribute('role', 'button'); brand.setAttribute('tabindex', '0'); brand.setAttribute('aria-label', 'BSK Stock Analyser — home');
    const goHome = () => { if (loading) return; showHome(); loadHome(); };
    brand.onclick = goHome;
    brand.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } };
  }

  let stored = null; try { stored = localStorage.getItem('sa_theme'); } catch (_) {}
  applyThemeMode(stored === 'light' || stored === 'dark' ? stored : null);
  const btn = $('#themeToggle');
  if (btn) btn.onclick = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    try { localStorage.setItem('sa_theme', next); localStorage.setItem('sa_updatedAt', String(Date.now())); } catch (_) {}
    applyThemeMode(next);
    if (CURRENT) { drawCharts(); if ($('#chartScore')) renderScorePanel(CURRENT); }
    schedulePush();
  };

  // Google Sign-In (optional; inert unless a client ID is configured in config.js)
  setupAccount();
}

// Module-level so Google-sync can re-apply a synced theme too.
function applyThemeMode(mode) {
  if (mode) document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
  const dark = mode ? mode === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const btn = $('#themeToggle');
  if (btn) { btn.innerHTML = icon(dark ? 'sun' : 'moon', 'ic'); btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); }
}
const currentTheme = () => { const t = document.documentElement.getAttribute('data-theme'); return t === 'light' || t === 'dark' ? t : null; };

// ---------------- Google Sign-In + Drive sync (optional) ----------------
const googleG = () => '<svg class="ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-2 3.2-4.9 3.2-7.8z"/><path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.6-2.7c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.1-1.9-6-4.4H2.3v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M6 14.4a6.6 6.6 0 0 1 0-4.2V7.4H2.3a11 11 0 0 0 0 9.8L6 14.4z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 12 1 11 11 0 0 0 2.3 7.4L6 10.2c.9-2.6 3.2-4.8 6-4.8z"/></svg>';

function getLocalData() {
  let ts = 0; try { ts = Number(localStorage.getItem('sa_updatedAt')) || 0; } catch (_) {}
  return { watchlist: getWL(), theme: currentTheme(), updatedAt: ts };
}

let pushTimer = null;
function schedulePush() {
  if (!G.getState().signedIn) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { G.push(getLocalData()); }, 1200);
}

async function onGoogleSignedIn() {
  const remote = await G.pull();
  const merged = G.mergeData(getLocalData(), remote);
  setWL(merged.watchlist);
  try { if (merged.theme) localStorage.setItem('sa_theme', merged.theme); localStorage.setItem('sa_updatedAt', String(merged.updatedAt)); } catch (_) {}
  applyThemeMode(merged.theme || currentTheme());
  renderWatchlist();
  const home = $('#home');
  if (home && home.style.display !== 'none') loadHome(true);
  if (CURRENT) { drawCharts(); if ($('#chartScore')) renderScorePanel(CURRENT); }
  await G.push(merged);
  renderAccount(G.getState());
}

function setupAccount() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('#account')) return;
    const m = $('#accountMenu'), b = $('#accountBtn');
    if (m) m.hidden = true; if (b) b.setAttribute('aria-expanded', 'false');
  });
  G.setOnSignedIn(onGoogleSignedIn);
  G.initGoogle((state) => renderAccount(state));
}

function renderAccount(state) {
  const host = $('#account'); if (!host) return;
  if (!state.enabled) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  if (!state.signedIn) {
    host.innerHTML = `<button class="gbtn" id="googleSignIn" type="button">${googleG()}<span>Sign in</span></button>`;
    $('#googleSignIn').onclick = () => G.signIn();
    return;
  }
  const p = state.profile || {};
  const initial = String(p.name || p.email || '?').trim().charAt(0).toUpperCase();
  const av = p.picture ? `<img class="avatar" src="${escAttr(p.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar init">${initial}</span>`;
  host.innerHTML = `
    <div class="account-wrap">
      <button class="gbtn signed" id="accountBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">${av}<span class="gname">${escAttr(p.name || p.email || 'Account')}</span>${icon('chevronDown', 'ic')}</button>
      <div class="account-menu" id="accountMenu" role="menu" hidden>
        <div class="am-head">${av}<div class="am-id"><b>${escAttr(p.name || '')}</b><small>${escAttr(p.email || '')}</small></div></div>
        <button role="menuitem" id="amSync" type="button">${icon('refresh', 'ic')} Sync now</button>
        <button role="menuitem" id="amOut" type="button">${icon('close', 'ic')} Sign out</button>
        <p class="am-note">Synced to your Google Drive app data. No database, private to you.</p>
      </div>
    </div>`;
  const menu = $('#accountMenu'), abtn = $('#accountBtn');
  abtn.onclick = () => { const open = menu.hidden; menu.hidden = !open; abtn.setAttribute('aria-expanded', String(open)); };
  $('#amSync').onclick = async () => { menu.hidden = true; await onGoogleSignedIn(); };
  $('#amOut').onclick = () => { menu.hidden = true; G.signOut(); };
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
  let seq = 0, timer = null, activeIdx = -1;

  const options = () => [...box.querySelectorAll('.suggestion:not(.note)')];
  const pick = (it) => { input.value = it.s; close(); runAnalysis(it.query || it.s, { n: it.n, sector: it.sector, industry: it.industry }); };
  const row = (it, i) => {
    const badge = it.exch ? `<em class="exch ${it.exch.toLowerCase()}">${it.exch}</em>` : '';
    const item = el('div', 'suggestion', `<b>${it.s}</b> <span>${it.n}</span>${badge}`);
    item.id = 'sugg-' + i;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.idx = String(i);
    item.__it = it;
    item.onmousemove = () => setActive(i);
    item.onclick = () => pick(it);
    return item;
  };
  const setActive = (i) => {
    const opts = options();
    if (!opts.length) { activeIdx = -1; return; }
    activeIdx = (i + opts.length) % opts.length;
    opts.forEach((o, k) => o.setAttribute('aria-selected', k === activeIdx ? 'true' : 'false'));
    opts.forEach((o) => o.classList.remove('active'));
    const cur = opts[activeIdx];
    cur.classList.add('active');
    cur.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', cur.id);
  };
  const open = () => { box.style.display = 'block'; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { box.style.display = 'none'; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); activeIdx = -1; };
  const paint = (items, note) => {
    box.innerHTML = '';
    activeIdx = -1; input.removeAttribute('aria-activedescendant');
    if (note) box.appendChild(el('div', 'suggestion note', `<span class="muted">${note}</span>`));
    items.forEach((it, i) => box.appendChild(row(it, i)));
    if (items.length || note) open(); else close();
  };

  const doSearch = async () => {
    if (loading) { close(); return; } // don't surface results while an analysis is loading
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
    const opts = options();
    const isOpen = box.style.display === 'block';
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { if (isOpen && opts.length) { e.preventDefault(); setActive(activeIdx < 0 ? 0 : activeIdx + 1); } return; }
    if (e.key === 'ArrowUp') { if (isOpen && opts.length) { e.preventDefault(); setActive(activeIdx <= 0 ? opts.length - 1 : activeIdx - 1); } return; }
    if (e.key !== 'Enter') return;
    // Enter: use the highlighted suggestion if any…
    if (isOpen && activeIdx >= 0 && opts[activeIdx]) { e.preventDefault(); pick(opts[activeIdx].__it); return; }
    // …otherwise analyze what was typed (known name if matched, else the raw symbol/code)
    const q = input.value.trim();
    if (!q) return;
    close();
    const r = searchStocks(q);
    runAnalysis(r[0] ? r[0].s : q.toUpperCase());
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
    if (t.dataset.tab === 'financials' && CURRENT) ensureFinancials();
    if (t.dataset.tab === 'peers' && CURRENT) ensurePeers();
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
  if (loading) return; // one analysis at a time — ignore clicks/search until it finishes
  loading = true;
  setSearchBusy(true);
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
  } finally {
    loading = false;
    setSearchBusy(false);
  }
}

// Lock the search box while an analysis loads, so a second stock can't be started
// mid-load (which would race the first). Swaps the search glyph for a spinner.
function setSearchBusy(busy) {
  const input = $('#search');
  if (input) { input.disabled = busy; input.setAttribute('aria-busy', busy ? 'true' : 'false'); }
  const box = $('#suggestions');
  if (box && busy) { box.innerHTML = ''; box.style.display = 'none'; input && input.setAttribute('aria-expanded', 'false'); }
  const icon0 = $('#searchIcon');
  if (icon0) icon0.innerHTML = busy ? '<span class="mini-spin" aria-hidden="true"></span>' : icon('search', 'ic');
  document.body.classList.toggle('is-loading', busy);
}

async function fetchBenchmark() {
  // NIFTY 50 via Yahoo index ticker (^NSEI, URL-encoded as %5ENSEI). Uses /api when
  // deployed on Vercel, otherwise public relays — same fallback logic as everything else.
  try { return await P.getIndexHistory('%5ENSEI', 'NIFTY 50', '5y'); } catch (_) { return null; }
}

// ---------------- rendering ----------------
function showLoading(meta) {
  hideHome();
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

// ================= Financials (lazy) =================
const crore = (n) => (n == null ? '—' : (n < 0 ? '-' : '') + '₹' + Math.abs(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr');
const finLabel = (sec, annual) => { if (!sec) return '—'; const d = new Date((sec > 1e12 ? sec : sec * 1000)); return annual ? 'FY' + String(d.getFullYear()).slice(2) : d.toLocaleDateString('en-IN', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2); };
const unavailableCard = (title, reason) => `<div class="card unavailable"><h3>${icon('alert', 'ic')} ${title}</h3><div class="na-banner">${icon('alert', 'ic')} Not available on this deployment</div><p>${reason || 'Not available.'}</p><p class="muted small">Enable by deploying on Vercel (server <code>/api</code> functions). Nothing is fabricated.</p></div>`;

const INCOME_ROWS = [['totalRevenue', 'Revenue'], ['costOfRevenue', 'Cost of revenue'], ['grossProfit', 'Gross profit'], ['operatingIncome', 'Operating income'], ['ebit', 'EBIT'], ['interestExpense', 'Interest'], ['incomeBeforeTax', 'Profit before tax'], ['incomeTaxExpense', 'Tax'], ['netIncome', 'Net profit']];
const BALANCE_ROWS = [['cash', 'Cash & equivalents'], ['totalCurrentAssets', 'Current assets'], ['totalAssets', 'Total assets'], ['totalCurrentLiabilities', 'Current liabilities'], ['totalLiab', 'Total liabilities'], ['longTermDebt', 'Long-term debt'], ['shortLongTermDebt', 'Short-term debt'], ['totalStockholderEquity', "Shareholders' equity"]];
const CASH_ROWS = [['totalCashFromOperatingActivities', 'Operating cash flow'], ['capitalExpenditures', 'Capex'], ['totalCashflowsFromInvestingActivities', 'Investing cash flow'], ['totalCashFromFinancingActivities', 'Financing cash flow'], ['changeInCash', 'Net change in cash']];

async function ensureFinancials() {
  if (!CURRENT) return;
  if (CURRENT.financials !== undefined) { renderFinancials(CURRENT); return; }
  if (CURRENT._finLoading) return;
  CURRENT._finLoading = true;
  const host = $('#panel-financials'); if (host) host.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading financial statements…</p></div>';
  CURRENT.financials = await P.getFinancials(CURRENT.data.yahoo || CURRENT.meta.s);
  CURRENT._finLoading = false;
  renderFinancials(CURRENT);
}

function stmtTable(title, ic, periods, defs, annual) {
  if (!periods || !periods.length) return `<div class="card"><h3>${icon(ic, 'ic')} ${title}</h3><p class="muted small">Not available for this period.</p></div>`;
  const cols = periods.slice(0, 6);
  return `<div class="card"><h3>${icon(ic, 'ic')} ${title}</h3><div class="table-scroll"><table class="fin-table">
    <thead><tr><th>₹ crore</th>${cols.map((p) => `<th>${finLabel(p.date, annual)}</th>`).join('')}</tr></thead>
    <tbody>${defs.map(([k, label]) => `<tr><td>${label}</td>${cols.map((p) => `<td>${crore(p[k])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></div>`;
}

function renderFinancials(R) {
  const host = $('#panel-financials'); if (!host) return;
  const f = R.financials;
  if (!f || !f.available) { host.innerHTML = unavailableCard('Financial statements', f && f.reason); return; }
  const annual = FIN_PERIOD === 'annual';
  const set = f[FIN_PERIOD] || {};
  host.innerHTML = `
    <div class="card">
      <h3>${icon('layers', 'ic')} Financial statements <span class="muted small">${f.source}</span></h3>
      <div class="seg" role="group" aria-label="Statement period">
        <button class="seg-btn" data-fp="annual" aria-pressed="${annual}">Annual</button>
        <button class="seg-btn" data-fp="quarterly" aria-pressed="${!annual}">Quarterly</button>
      </div>
      <div class="chart-box" style="height:220px"><canvas id="chartFin" aria-label="Revenue and net profit trend"></canvas></div>
    </div>
    ${stmtTable('Profit & Loss', 'activity', set.income, INCOME_ROWS, annual)}
    ${stmtTable('Balance Sheet', 'scale', set.balance, BALANCE_ROWS, annual)}
    ${stmtTable('Cash Flow', 'health', set.cash, CASH_ROWS, annual)}
    <p class="home-note muted small">${icon('info', 'ic')} Figures in ₹ crore, as reported by the data vendor (${FIN_PERIOD}). Yahoo typically provides ~4 recent periods — this is not a substitute for the audited annual report. Missing lines show “—”, never a guess.</p>`;
  host.querySelectorAll('[data-fp]').forEach((b) => { b.onclick = () => { FIN_PERIOD = b.dataset.fp; renderFinancials(R); }; });
  // trend chart from the earnings series (fallback to annual income)
  let series = f.earnings && f.earnings.yearly && f.earnings.yearly.length
    ? f.earnings.yearly.map((x) => ({ label: x.date, rev: x.revenue, prof: x.earnings }))
    : (f.annual.income || []).slice().reverse().map((x) => ({ label: finLabel(x.date, true), rev: x.totalRevenue, prof: x.netIncome }));
  if (series.length && $('#chartFin')) {
    const toCr = (v) => (v == null ? null : v / 1e7);
    C.financialsBar('chartFin', series.map((s) => String(s.label)), series.map((s) => toCr(s.rev)), series.map((s) => toCr(s.prof)));
  }
}

// ================= Peer comparison (lazy) =================
async function ensurePeers() {
  if (!CURRENT) return;
  if (CURRENT.peers !== undefined) { renderPeers(CURRENT); return; }
  if (CURRENT._peersLoading) return;
  CURRENT._peersLoading = true;
  const host = $('#panel-peers'); if (host) host.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading peer comparison…</p></div>';
  const sector = CURRENT.meta.sector;
  const peerStocks = STOCK_UNIVERSE.filter((s) => s.sector === sector && s.s !== CURRENT.meta.s).slice(0, 6);
  const syms = [...new Set([CURRENT.data.yahoo || toYahoo(CURRENT.meta.s), ...peerStocks.map((s) => toYahoo(s.s))])];
  CURRENT.peers = syms.length > 1 ? await P.getPeers(syms) : { available: false, reason: 'No same-sector peers available for this stock in the tracked universe.' };
  CURRENT._peersLoading = false;
  renderPeers(CURRENT);
}

function renderPeers(R) {
  const host = $('#panel-peers'); if (!host) return;
  const pr = R.peers;
  if (!pr || !pr.available) { host.innerHTML = unavailableCard('Peer comparison', pr && pr.reason); return; }
  const sector = R.meta.sector, me = R.meta.s;
  const gv = (r, path) => path.split('.').reduce((o, k) => (o ? o[k] : null), r);
  const pctv = (r, path) => { const v = gv(r, path); return v == null ? null : v * 100; };
  const F = { pct: (v) => (v == null ? '—' : fmtNum(v) + '%'), num: (v) => (v == null ? '—' : fmtNum(v)), x: (v) => (v == null ? '—' : fmtNum(v) + 'x'), int: (v) => (v == null ? '—' : String(v)) };
  const cols = [
    { label: 'Rev growth', get: (r) => pctv(r, 'growth.revenueGrowth'), better: 'max', fmt: F.pct },
    { label: 'Profit growth', get: (r) => pctv(r, 'growth.earningsGrowth'), better: 'max', fmt: F.pct },
    { label: 'ROE', get: (r) => pctv(r, 'profitability.returnOnEquity'), better: 'max', fmt: F.pct },
    { label: 'Net margin', get: (r) => pctv(r, 'profitability.profitMargins'), better: 'max', fmt: F.pct },
    { label: 'D/E', get: (r) => (r.health && r.health.debtToEquity != null ? r.health.debtToEquity / 100 : null), better: 'min', fmt: F.x },
    { label: 'P/E', get: (r) => gv(r, 'valuation.trailingPE'), better: 'min', fmt: F.num },
    { label: 'EV/EBITDA', get: (r) => gv(r, 'valuation.enterpriseToEbitda'), better: 'min', fmt: F.num },
    { label: 'Div yield', get: (r) => pctv(r, 'valuation.dividendYield'), better: 'max', fmt: F.pct },
    { label: 'Score', get: (r) => r.score, better: 'max', fmt: F.int },
  ];
  const rows = pr.peers.map((x) => ({ ...x, score: A.peerScore(x, sector) }));
  const ranked = [...rows].filter((r) => r.score != null).sort((a, b) => b.score - a.score);
  const myRank = (() => { const i = ranked.findIndex((r) => r.symbol === me); return i < 0 ? null : i + 1; })();
  const bests = cols.map((c) => { const vals = rows.map(c.get).filter((v) => v != null); if (!vals.length) return null; return c.better === 'max' ? Math.max(...vals) : Math.min(...vals); });
  rows.sort((a, b) => (a.symbol === me ? -1 : b.symbol === me ? 1 : (b.score || 0) - (a.score || 0)));
  const body = rows.map((r) => {
    const cells = cols.map((c, ci) => { const v = c.get(r); const best = bests[ci] != null && v != null && Math.abs(v - bests[ci]) < 1e-9; return `<td class="${best ? 'best' : ''}">${c.fmt(v)}</td>`; }).join('');
    return `<tr class="${r.symbol === me ? 'me' : ''}"><td class="pc-name"><b>${r.symbol}</b><span class="muted">${escAttr(r.name || '')}</span></td>${cells}</tr>`;
  }).join('');
  host.innerHTML = `
    <div class="card">
      <h3>${icon('compare', 'ic')} Peer comparison <span class="muted small">${SECTORS[sector] || ''}</span></h3>
      ${myRank ? `<p><b>${me}</b> ranks <b class="${myRank <= Math.ceil(ranked.length / 2) ? 'pos' : 'warn'}">${myRank} / ${ranked.length}</b> among these sector peers on a composite of growth, profitability, financial health &amp; valuation.</p>` : ''}
      <div class="table-scroll"><table class="pc-table">
        <thead><tr><th>Company</th>${cols.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <p class="home-note muted small">${icon('info', 'ic')} Peers are same-sector stocks from the tracked universe (not an exhaustive peer set). Best value per column is highlighted; your stock's row is emphasised. Ratios as reported by the data vendor.</p>
    </div>`;
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

// ================= Markets home page =================
function showHome() {
  const h = $('#home'); if (h) h.style.display = 'block';
  const r = $('#result'); if (r) { r.style.display = 'none'; r.innerHTML = ''; }
  const s = $('#search'); if (s && !s.disabled) s.value = '';
  history.replaceState(null, '', location.pathname);
}
function hideHome() { const h = $('#home'); if (h) h.style.display = 'none'; }

async function loadHome(force) {
  const host = $('#home'); if (!host) return;
  showHome();
  if (!force) host.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading market movers…</p></div>`;
  // Fetch quotes for the tracked universe PLUS any watchlist symbols, so the watchlist
  // can show live prices without a second request.
  const wlSyms = getWL().map((w) => toYahoo(w.s));
  const syms = [...new Set([...STOCK_UNIVERSE.map((s) => toYahoo(s.s)), ...wlSyms])];
  const [movers, indices] = await Promise.all([P.getMovers(syms, { force }), loadIndices()]);
  lastQuotes = new Map((movers && movers.quotes ? movers.quotes : []).map((q) => [q.symbol, q]));
  renderHome(movers, indices);
  renderWatchlist(); // refresh with live prices now available
}

// NSE cash-market hours: Mon–Fri 09:15–15:30 IST. Purely client-side (a display badge).
function marketStatus() {
  try {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = ist.getDay(), mins = ist.getHours() * 60 + ist.getMinutes();
    const open = day >= 1 && day <= 5 && mins >= 555 && mins <= 930;
    return { open };
  } catch (_) { return { open: false }; }
}
const volFmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 }));

async function loadIndices() {
  const out = [];
  for (const [tk, nm] of [['%5ENSEI', 'NIFTY 50'], ['%5EBSESN', 'SENSEX']]) {
    try {
      const r = await P.getIndexHistory(tk, nm, '1mo');
      const c = r.bars.at(-1).c, p = r.bars.at(-2).c;
      if (c != null && p) out.push({ nm, price: c, pct: ((c - p) / p) * 100 });
    } catch (_) {}
  }
  return out;
}

function computeScreens(quotes) {
  const bySym = new Map(STOCK_UNIVERSE.map((s) => [s.s, s]));
  // Screens are computed from the TRACKED universe only (watchlist-only symbols are
  // fetched too, but excluded here so the screens stay "our tracked stocks").
  const rows = quotes.filter((q) => bySym.has(q.symbol)).map((q) => {
    const u = bySym.get(q.symbol);
    return { ...q, name: (u && u.n) || q.name, sector: u && u.sector,
      value: q.price != null && q.volume != null ? q.price * q.volume : null,
      volRatio: q.avgVolume > 0 && q.volume != null ? q.volume / q.avgVolume : null,
      pctFromHigh: q.high52 > 0 && q.price != null ? (q.price / q.high52 - 1) * 100 : null,
      pctAboveLow: q.low52 > 0 && q.price != null ? (q.price / q.low52 - 1) * 100 : null };
  });
  const withPct = rows.filter((r) => r.changePct != null);
  const adv = withPct.filter((r) => r.changePct > 0).length;
  const dec = withPct.filter((r) => r.changePct < 0).length;
  const map = new Map();
  rows.forEach((r) => { if (!r.sector || r.changePct == null) return; const m = map.get(r.sector) || { sum: 0, n: 0 }; m.sum += r.changePct; m.n++; map.set(r.sector, m); });
  const sectors = [...map.entries()].map(([k, v]) => ({ sector: k, label: SECTORS[k] || k, avg: v.sum / v.n, n: v.n })).sort((a, b) => b.avg - a.avg);
  return {
    breadth: { adv, dec, unch: withPct.length - adv - dec, total: withPct.length },
    gainers: [...withPct].sort((a, b) => b.changePct - a.changePct),
    losers: [...withPct].sort((a, b) => a.changePct - b.changePct),
    active: rows.filter((r) => r.value != null).sort((a, b) => b.value - a.value),
    activeVol: rows.filter((r) => r.volume != null).sort((a, b) => b.volume - a.volume),
    shockers: rows.filter((r) => r.volRatio != null).sort((a, b) => b.volRatio - a.volRatio),
    high52: rows.filter((r) => r.pctFromHigh != null).sort((a, b) => b.pctFromHigh - a.pctFromHigh),
    low52: rows.filter((r) => r.pctAboveLow != null).sort((a, b) => a.pctAboveLow - b.pctAboveLow),
    valuable: rows.filter((r) => r.marketCap > 0).sort((a, b) => b.marketCap - a.marketCap),
    sectors,
  };
}

const crFmt = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 2 }));
const escAttr = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');

function moverRow(r, extra) {
  return `<button class="mv-row" data-s="${escAttr(r.symbol)}" data-n="${escAttr(r.name)}" data-sec="${escAttr(r.sector || '')}">
    <span class="mv-sym">${r.symbol}</span>
    <span class="mv-name">${r.name}</span>
    ${extra || '<span class="mv-extra"></span>'}
    <span class="mv-price">${fmtPrice(r.price)}</span>
    <span class="mv-chg ${r.changePct >= 0 ? 'pos' : 'neg'}">${fmtPct(r.changePct)}</span>
  </button>`;
}

function renderHome(movers, indices) {
  const host = $('#home'); if (!host) return;
  if (!movers || !movers.available) {
    host.innerHTML = `
      <div class="card unavailable home-unavailable">
        <h3>${icon('barChart', 'ic')} Markets overview</h3>
        <div class="na-banner">${icon('alert', 'ic')} Not available on this deployment</div>
        <p>${movers ? movers.reason : 'Market movers could not be loaded.'}</p>
        <p class="muted small">Deploy on Vercel (with the <code>/api/movers</code> function) to enable gainers, losers, most-active, volume shockers and sector trends. You can still search and analyse any stock from the box above.</p>
      </div>`;
    return;
  }
  const N = computeScreens.__n = movers.quotes.filter((q) => STOCK_UNIVERSE.some((u) => u.s === q.symbol)).length;
  const s = computeScreens(movers.quotes);
  const mkt = marketStatus();
  const b = s.breadth;
  const advPct = b.total ? (b.adv / b.total) * 100 : 0;
  const idx = indices.map((i) => `<div class="idx"><span class="idx-nm">${i.nm}</span><span class="idx-px mono">${fmtNum(i.price)}</span><span class="idx-chg ${i.pct >= 0 ? 'pos' : 'neg'}">${fmtPct(i.pct)}</span></div>`).join('');
  const sectorChips = s.sectors.map((x) => `<span class="sector-chip ${x.avg >= 0 ? 'pos' : 'neg'}" title="${x.n} stocks">${x.label} <b>${fmtPct(x.avg)}</b></span>`).join('');

  host.innerHTML = `
    <div class="home-head">
      <div class="home-title-row">
        <h2 class="home-title">Markets</h2>
        <span class="mkt-status ${mkt.open ? 'open' : 'closed'}"><span class="dot"></span>${mkt.open ? 'Market open' : 'Market closed'}</span>
        <button class="icon-btn sm" id="homeRefresh" aria-label="Refresh market data" title="Refresh">${icon('refresh', 'ic')}</button>
      </div>
      ${idx ? `<div class="indices-strip">${idx}</div>` : ''}
    </div>

    <div class="card breadth-card">
      <div class="breadth-head"><span>${icon('activity', 'ic')} Market breadth</span><span class="muted small">${b.adv} up · ${b.dec} down · ${b.unch} flat</span></div>
      <div class="breadth-bar"><i class="adv" style="width:${advPct}%"></i><i class="dec" style="width:${100 - advPct}%"></i></div>
    </div>

    ${s.sectors.length ? `<div class="card sector-card"><h3>${icon('activity', 'ic')} Trending sectors</h3><div class="sector-heat">${sectorChips}</div></div>` : ''}

    <div class="home-grid">
      ${SCREEN_DEFS.map((c) => mvCard(c, s[c.key])).join('')}
    </div>
    <p class="home-note muted small">${icon('info', 'ic')} Screens are computed from the ${N} stocks this tool tracks (a curated cross-sector sample), not the entire market. Prices are delayed. Source: ${movers.source}${movers.cached ? ' · cached' : ''}, as of ${fmtDateTime(movers.asOf)}.</p>`;

  // stash full lists so the "Show all" dialog can list every entry
  HOME_SCREENS = {};
  SCREEN_DEFS.forEach((c) => { HOME_SCREENS[c.key] = { ...c, rows: s[c.key] || [] }; });

  const rf = $('#homeRefresh'); if (rf) rf.onclick = () => loadHome(true);
  host.querySelectorAll('.show-all').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); openScreenDialog(b.dataset.screen); }; });
  host.querySelectorAll('.mv-row').forEach((btn) => {
    btn.onclick = () => runAnalysis(btn.dataset.s, { n: btn.dataset.n, sector: btn.dataset.sec || 'OTHER' });
  });
}

// One definition per home screen — drives the cards AND the "Show all" dialog.
const SCREEN_DEFS = [
  { key: 'gainers', ic: 'trendUp', title: 'Top gainers', sub: '', extra: () => '' },
  { key: 'losers', ic: 'trendDown', title: 'Top losers', sub: '', extra: () => '' },
  { key: 'active', ic: 'activity', title: 'Most active', sub: 'by value', extra: (r) => `<span class="mv-extra">${crFmt(r.value)}</span>` },
  { key: 'activeVol', ic: 'barChart', title: 'Most active', sub: 'by volume', extra: (r) => `<span class="mv-extra">${volFmt(r.volume)}</span>` },
  { key: 'shockers', ic: 'bolt', title: 'Volume shockers', sub: '', extra: (r) => `<span class="mv-extra">${fmtNum(r.volRatio, 1)}× avg</span>` },
  { key: 'valuable', ic: 'target', title: 'Most valuable', sub: 'by m-cap', extra: (r) => `<span class="mv-extra">${crFmt(r.marketCap)}</span>` },
  { key: 'high52', ic: 'trendUp', title: 'Near 52-wk high', sub: '', extra: (r) => `<span class="mv-extra">${fmtNum(r.pctFromHigh, 1)}%</span>` },
  { key: 'low52', ic: 'trendDown', title: 'Near 52-wk low', sub: '', extra: (r) => `<span class="mv-extra">+${fmtNum(r.pctAboveLow, 1)}%</span>` },
];
let HOME_SCREENS = {};

function mvCard(cfg, rows) {
  rows = rows || [];
  const shown = rows.slice(0, 6);
  const body = shown.length ? shown.map((r) => moverRow(r, cfg.extra(r))).join('') : '<p class="muted small" style="padding:.6rem .2rem">No data.</p>';
  const more = rows.length > 6 ? `<button class="show-all" data-screen="${cfg.key}" type="button">Show all ${rows.length}</button>` : '';
  return `<div class="card mv-card"><h3>${icon(cfg.ic, 'ic')} ${cfg.title}${cfg.sub ? ` <span class="muted small">${cfg.sub}</span>` : ''}${more}</h3><div class="mv-list">${body}</div></div>`;
}

// Full-list dialog (native <dialog>: Escape closes, focus trapped, focus restored).
function openScreenDialog(key) {
  const cfg = HOME_SCREENS[key]; const dlg = $('#screenDialog');
  if (!cfg || !dlg) return;
  dlg.innerHTML = `
    <div class="modal-head">
      <h3>${icon(cfg.ic, 'ic')} ${cfg.title}${cfg.sub ? ` <span class="muted small">${cfg.sub}</span>` : ''} <span class="muted small">(${cfg.rows.length})</span></h3>
      <button class="icon-btn sm" id="dlgClose" type="button" aria-label="Close">${icon('close', 'ic')}</button>
    </div>
    <div class="modal-body mv-list">${cfg.rows.map((r) => moverRow(r, cfg.extra(r))).join('')}</div>`;
  dlg.querySelectorAll('.mv-row').forEach((b) => { b.onclick = () => { dlg.close(); runAnalysis(b.dataset.s, { n: b.dataset.n, sector: b.dataset.sec || 'OTHER' }); }; });
  $('#dlgClose').onclick = () => dlg.close();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); }; // backdrop click
  dlg.showModal();
}

// ---------------- watchlist (localStorage, spec §27) ----------------
const WL_KEY = 'sa_watchlist';
const getWL = () => { try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; } catch (_) { return []; } };
const setWL = (a) => { localStorage.setItem(WL_KEY, JSON.stringify(a)); try { localStorage.setItem('sa_updatedAt', String(Date.now())); } catch (_) {} schedulePush(); };
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
  host.innerHTML = wl.map((x) => {
    const q = lastQuotes.get(x.s) || lastQuotes.get(String(x.s).replace(/\.(NS|BO)$/i, ''));
    const live = q && q.price != null ? `<span class="wl-px mono">${fmtPrice(q.price)}</span><span class="wl-chg ${q.changePct >= 0 ? 'pos' : 'neg'}">${fmtPct(q.changePct)}</span>` : '';
    return `<span class="wl-chip" data-s="${escAttr(x.s)}" role="button" tabindex="0"><b>${x.s}</b> <span class="muted wl-nm">${x.n}</span> ${live} <span class="del" data-del="${escAttr(x.s)}" role="button" aria-label="Remove ${escAttr(x.s)}">${icon('close', 'ic')}</span></span>`;
  }).join('');
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
