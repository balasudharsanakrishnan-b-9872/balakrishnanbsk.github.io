// analysis.js — turns raw bars into technical/trend/price/risk analysis, then into a
// transparent, weighted, re-normalizable score and a decision (spec §9-13, §17-19, §23-24).
//
// Design rules honored here:
//  * Deterministic: every number comes from indicators.js.
//  * Transparent: the score is a sum of labeled sub-scores with explicit weights.
//  * Honest under missing data: components that can't be computed are dropped and the
//    remaining weights re-normalized; the CONFIDENCE and DATA-QUALITY scores fall
//    accordingly instead of pretending. No fabrication.
//  * No single indicator triggers a BUY (spec §9). The score blends many.

import * as I from './indicators.js';

const closesOf = (bars) => bars.map((b) => b.adj ?? b.c);
const rawClosesOf = (bars) => bars.map((b) => b.c);

// approx trading sessions per calendar window
const SESSIONS = { '1W': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '3Y': 756, '5Y': 1260 };

// ---------------- Technical analysis ----------------
export function technical(bars) {
  const closes = closesOf(bars);
  const highs = bars.map((b) => b.h ?? b.c);
  const lows = bars.map((b) => b.l ?? b.c);
  const vols = bars.map((b) => b.v ?? 0);
  const price = closes[closes.length - 1];

  const t = {
    price,
    sma20: I.sma(closes, 20), sma50: I.sma(closes, 50),
    sma100: I.sma(closes, 100), sma200: I.sma(closes, 200),
    ema20: I.ema(closes, 20), ema50: I.ema(closes, 50),
    rsi14: I.rsi(closes, 14),
    macd: I.macd(closes),
    bollinger: I.bollinger(closes, 20, 2),
    atr14: I.atr(highs, lows, closes, 14),
    adx14: I.adx(highs, lows, closes, 14),
    volAvg20: I.sma(vols, 20),
    volLast: vols[vols.length - 1] || null,
    high52: bars.length >= 252 ? Math.max(...highs.slice(-252)) : Math.max(...highs),
    low52: bars.length >= 252 ? Math.min(...lows.slice(-252)) : Math.min(...lows),
  };

  const signals = [];
  // Golden / death cross on SMA50 vs SMA200
  if (t.sma50 != null && t.sma200 != null) {
    if (t.sma50 > t.sma200) signals.push({ k: 'Golden Cross regime', tone: 'pos', why: 'SMA50 above SMA200' });
    else signals.push({ k: 'Death Cross regime', tone: 'neg', why: 'SMA50 below SMA200' });
  }
  if (price != null && t.sma200 != null)
    signals.push({ k: price > t.sma200 ? 'Above 200-DMA' : 'Below 200-DMA', tone: price > t.sma200 ? 'pos' : 'neg', why: `Price ${I.round(price)} vs 200-DMA ${I.round(t.sma200)}` });
  if (t.rsi14 != null) {
    if (t.rsi14 >= 70) signals.push({ k: 'Overbought (RSI≥70)', tone: 'warn', why: `RSI ${I.round(t.rsi14)}` });
    else if (t.rsi14 <= 30) signals.push({ k: 'Oversold (RSI≤30)', tone: 'warn', why: `RSI ${I.round(t.rsi14)}` });
    else signals.push({ k: `RSI neutral (${I.round(t.rsi14)})`, tone: 'neu', why: 'RSI between 30 and 70' });
  }
  if (t.macd) signals.push({ k: t.macd.histogram > 0 ? 'MACD bullish' : 'MACD bearish', tone: t.macd.histogram > 0 ? 'pos' : 'neg', why: `Hist ${I.round(t.macd.histogram, 3)}` });
  if (t.adx14 != null) signals.push({ k: t.adx14 >= 25 ? `Trending (ADX ${I.round(t.adx14)})` : `Weak/no trend (ADX ${I.round(t.adx14)})`, tone: t.adx14 >= 25 ? 'pos' : 'neu', why: 'ADX ≥ 25 = trend present' });
  if (t.volAvg20 && t.volLast) {
    const ratio = t.volLast / t.volAvg20;
    if (ratio > 1.5) signals.push({ k: 'Volume surge', tone: 'pos', why: `${I.round(ratio)}× 20-day avg volume` });
  }
  if (price != null && t.high52) {
    const off = ((t.high52 - price) / t.high52) * 100;
    if (off <= 3) signals.push({ k: 'Near 52-week high', tone: 'pos', why: `${I.round(off)}% below 52W high` });
  }
  t.signals = signals;
  return t;
}

// ---------------- Trend (multi-timeframe) ----------------
export function trend(bars) {
  const closes = closesOf(bars);
  const price = closes[closes.length - 1];
  const label = (fast, slow) => {
    if (fast == null || slow == null) return null;
    if (price > fast && fast > slow) return 'Bullish';
    if (price < fast && fast < slow) return 'Bearish';
    return 'Sideways';
  };
  const shortT = label(I.sma(closes, 20), I.sma(closes, 50));
  const medT = label(I.sma(closes, 50), I.sma(closes, 100));
  const longT = label(I.sma(closes, 100), I.sma(closes, 200));
  const bulls = [shortT, medT, longT].filter((x) => x === 'Bullish').length;
  const bears = [shortT, medT, longT].filter((x) => x === 'Bearish').length;
  let strength = 'Mixed';
  if (bulls === 3) strength = 'Strong Bullish';
  else if (bears === 3) strength = 'Strong Bearish';
  else if (bulls >= 2) strength = 'Moderately Bullish';
  else if (bears >= 2) strength = 'Moderately Bearish';
  return { short: shortT, medium: medT, long: longT, strength };
}

// ---------------- Price & performance ----------------
export function performance(bars) {
  const closes = closesOf(bars);
  const out = { returns: {}, cagr: {}, price: closes[closes.length - 1] };
  for (const [k, n] of Object.entries(SESSIONS)) out.returns[k] = I.round(I.pctReturn(closes, n));
  // CAGR needs actual elapsed years; derive from bar timestamps
  const spanYears = (bars[bars.length - 1].t - bars[0].t) / (365.25 * 24 * 3600 * 1000);
  for (const y of [1, 3, 5]) {
    if (spanYears >= y - 0.1) {
      const n = Math.min(bars.length - 1, Math.round(y * 252));
      const slice = closes.slice(closes.length - 1 - n);
      out.cagr[`${y}Y`] = I.round(I.cagr(slice, y));
    }
  }
  return out;
}

// ---------------- Risk ----------------
export function risk(bars, benchBars) {
  const closes = closesOf(bars);
  const r = {
    volatility: I.round(I.annualVolatility(closes)),
    downside: I.round(I.downsideVolatility(closes)),
    maxDrawdown: I.round(I.maxDrawdown(closes)),
    sharpe: I.round(I.sharpe(closes)),
    beta: benchBars ? I.round(I.beta(closes, closesOf(benchBars))) : null,
  };
  // 0-100 risk score (higher = riskier). Blend of volatility, drawdown, beta.
  const parts = [];
  if (r.volatility != null) parts.push(Math.min(100, (r.volatility / 60) * 100)); // 60% vol -> max
  if (r.maxDrawdown != null) parts.push(Math.min(100, (Math.abs(r.maxDrawdown) / 70) * 100));
  if (r.beta != null) parts.push(Math.min(100, (r.beta / 2) * 100));
  r.riskScore = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  r.level = r.riskScore == null ? 'Unknown' : r.riskScore < 30 ? 'Low' : r.riskScore < 55 ? 'Moderate' : r.riskScore < 75 ? 'High' : 'Very High';
  return r;
}

// ---------------- Relative strength vs benchmark ----------------
export function relativeStrength(bars, benchBars) {
  if (!benchBars) return null;
  const s = closesOf(bars), b = closesOf(benchBars);
  const win = (n) => {
    const rs = I.pctReturn(s, n), rb = I.pctReturn(b, n);
    if (rs == null || rb == null) return null;
    return { stock: I.round(rs), bench: I.round(rb), diff: I.round(rs - rb) };
  };
  return { '3M': win(63), '6M': win(126), '1Y': win(252) };
}

// ================= SCORING ENGINE (spec §18) =================
// Transparent, weighted. Components that can't be computed are dropped and the
// remaining weights renormalized to 100 — with a confidence penalty (spec §24).
const BASE_WEIGHTS = {
  fundamentals: 25,
  growth: 15,
  financialHealth: 15,
  valuation: 15,
  technical: 10,
  relativeStrength: 5,
  ownership: 5,
  news: 5,
  risk: 5,
};

// Each scorer returns { score: 0-100 | null, notes: [...] }. null = "cannot assess".
function scoreTechnical(t, tr) {
  if (!t) return { score: null, notes: [] };
  let s = 50; const notes = [];
  if (t.price != null && t.sma200 != null) { if (t.price > t.sma200) { s += 12; notes.push('Above 200-DMA (+)'); } else { s -= 12; notes.push('Below 200-DMA (−)'); } }
  if (t.sma50 != null && t.sma200 != null) { if (t.sma50 > t.sma200) { s += 8; notes.push('Golden-cross regime (+)'); } else { s -= 8; notes.push('Death-cross regime (−)'); } }
  if (t.macd) { if (t.macd.histogram > 0) { s += 6; notes.push('MACD bullish (+)'); } else { s -= 6; notes.push('MACD bearish (−)'); } }
  if (t.rsi14 != null) { if (t.rsi14 >= 70) { s -= 6; notes.push('Overbought (−)'); } else if (t.rsi14 <= 30) { s += 4; notes.push('Oversold bounce potential (+)'); } }
  if (t.adx14 != null && t.adx14 >= 25 && t.price > (t.sma50 ?? Infinity)) { s += 6; notes.push('Strong up-trend (+)'); }
  if (tr) { if (tr.strength.includes('Strong Bullish')) { s += 8; notes.push('All timeframes bullish (+)'); } else if (tr.strength.includes('Strong Bearish')) { s -= 8; notes.push('All timeframes bearish (−)'); } }
  return { score: clamp(s), notes };
}

function scoreRelStrength(rs) {
  if (!rs || !rs['1Y']) return { score: null, notes: [] };
  const d = rs['1Y'].diff;
  let s = 50 + Math.max(-40, Math.min(40, d)); // +1 pt per 1% outperformance, capped
  return { score: clamp(s), notes: [`1Y vs NIFTY: ${d > 0 ? '+' : ''}${d}%`] };
}

function scoreRisk(rk) {
  if (!rk || rk.riskScore == null) return { score: null, notes: [] };
  // lower risk -> higher score
  return { score: clamp(100 - rk.riskScore), notes: [`Risk level: ${rk.level}`] };
}

const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
const pct = (d) => (d == null ? null : d * 100); // Yahoo decimals -> percent

// ---- fundamental scorers (only run when the /api/quote proxy supplied real data) ----
// Each returns {score, notes} or {score:null} when the needed fields are absent.
function scoreFundamentals(f) {
  if (!f || !f.available) return { score: null, notes: [] };
  const p = f.profitability || {};
  const roe = pct(p.returnOnEquity), margin = pct(p.profitMargins), roa = pct(p.returnOnAssets);
  const parts = [], notes = [];
  if (roe != null) { parts.push(band(roe, [[20, 95], [15, 80], [10, 62], [5, 45], [0, 28], [-1e9, 12]])); notes.push(`ROE ${I.round(roe)}%`); }
  if (margin != null) { parts.push(band(margin, [[20, 92], [12, 75], [6, 58], [2, 42], [0, 30], [-1e9, 12]])); notes.push(`Net margin ${I.round(margin)}%`); }
  if (roa != null) { parts.push(band(roa, [[12, 90], [7, 72], [3, 55], [0, 38], [-1e9, 18]])); notes.push(`ROA ${I.round(roa)}%`); }
  if (!parts.length) return { score: null, notes: [] };
  return { score: clamp(avg(parts)), notes };
}

function scoreGrowth(f) {
  if (!f || !f.available) return { score: null, notes: [] };
  const g = f.growth || {};
  const rev = pct(g.revenueGrowth), earn = pct(g.earningsGrowth ?? g.earningsQuarterlyGrowth);
  const parts = [], notes = [];
  if (rev != null) { parts.push(band(rev, [[25, 92], [15, 78], [8, 62], [3, 48], [0, 35], [-1e9, 18]])); notes.push(`Revenue growth ${I.round(rev)}%`); }
  if (earn != null) { parts.push(band(earn, [[25, 92], [15, 78], [8, 62], [0, 45], [-1e9, 20]])); notes.push(`Earnings growth ${I.round(earn)}%`); }
  if (!parts.length) return { score: null, notes: [] };
  return { score: clamp(avg(parts)), notes };
}

function scoreHealth(f) {
  if (!f || !f.available) return { score: null, notes: [] };
  const h = f.health || {};
  const parts = [], notes = [];
  if (h.debtToEquity != null) { const de = h.debtToEquity / 100; parts.push(band(de, [[0.25, 92], [0.5, 78], [1, 60], [2, 40], [1e9, 20]], true)); notes.push(`D/E ${I.round(de)}x`); }
  if (h.currentRatio != null) { parts.push(band(h.currentRatio, [[2, 88], [1.5, 75], [1, 58], [0.8, 42], [-1e9, 25]])); notes.push(`Current ratio ${I.round(h.currentRatio)}`); }
  if (h.freeCashflow != null) { parts.push(h.freeCashflow > 0 ? 80 : 25); notes.push(h.freeCashflow > 0 ? 'Positive FCF' : 'Negative FCF'); }
  if (h.totalCash != null && h.totalDebt != null) { parts.push(h.totalCash >= h.totalDebt ? 85 : 55); notes.push(h.totalCash >= h.totalDebt ? 'Net cash' : 'Net debt'); }
  if (!parts.length) return { score: null, notes: [] };
  return { score: clamp(avg(parts)), notes };
}

function scoreValuation(f, sector) {
  if (!f || !f.available) return { score: null, notes: [] };
  const v = f.valuation || {};
  const parts = [], notes = [];
  const isBank = sector === 'BANK';
  if (v.pegRatio != null && v.pegRatio > 0) { parts.push(band(v.pegRatio, [[1, 88], [1.5, 72], [2, 55], [3, 38], [1e9, 22]], true)); notes.push(`PEG ${I.round(v.pegRatio)}`); }
  if (isBank && v.priceToBook != null) { parts.push(band(v.priceToBook, [[1, 88], [2, 72], [3, 55], [5, 38], [1e9, 22]], true)); notes.push(`P/B ${I.round(v.priceToBook)} (bank)`); }
  else if (v.trailingPE != null && v.trailingPE > 0) { parts.push(band(v.trailingPE, [[15, 85], [25, 68], [40, 50], [60, 34], [1e9, 20]], true)); notes.push(`P/E ${I.round(v.trailingPE)}`); }
  if (v.dividendYield != null) { const dy = pct(v.dividendYield); if (dy > 0) { parts.push(band(dy, [[3, 80], [1.5, 65], [0.5, 55], [-1e9, 48]])); notes.push(`Div yield ${I.round(dy)}%`); } }
  if (!parts.length) return { score: null, notes: [] };
  return { score: clamp(avg(parts)), notes };
}

// band(value, [[threshold, score], ...]) — descending thresholds; `invert` for
// "lower is better" metrics (thresholds ascending, first match wins).
function band(v, table, invert = false) {
  if (invert) { for (const [th, sc] of table) if (v <= th) return sc; return table[table.length - 1][1]; }
  for (const [th, sc] of table) if (v >= th) return sc; return table[table.length - 1][1];
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
// flag a component "unavailable" when it couldn't be scored (so the UI shows why)
const mark = (res, f) => ({ ...res, unavailable: res.score == null });

export function buildScore({ technical: t, trend: tr, relStrength: rs, risk: rk, fundamentals, ownership, news, sector }) {
  const components = {
    technical: scoreTechnical(t, tr),
    relativeStrength: scoreRelStrength(rs),
    risk: scoreRisk(rk),
    fundamentals: mark(scoreFundamentals(fundamentals), fundamentals),
    growth: mark(scoreGrowth(fundamentals), fundamentals),
    financialHealth: mark(scoreHealth(fundamentals), fundamentals),
    valuation: mark(scoreValuation(fundamentals, sector), fundamentals),
    ownership: { score: null, notes: [], unavailable: !(ownership && ownership.available) },
    news: { score: null, notes: [], unavailable: !(news && news.available) },
  };

  // Renormalize weights over the components we could actually score.
  const available = Object.keys(BASE_WEIGHTS).filter((k) => components[k].score != null);
  const availWeightSum = available.reduce((a, k) => a + BASE_WEIGHTS[k], 0);
  let total = 0;
  const breakdown = [];
  for (const k of Object.keys(BASE_WEIGHTS)) {
    const c = components[k];
    const effWeight = c.score != null ? (BASE_WEIGHTS[k] / availWeightSum) * 100 : 0;
    if (c.score != null) total += (c.score / 100) * effWeight;
    breakdown.push({
      key: k,
      baseWeight: BASE_WEIGHTS[k],
      effectiveWeight: I.round(effWeight, 1),
      score: c.score,
      contribution: c.score != null ? I.round((c.score / 100) * effWeight, 1) : null,
      notes: c.notes,
      unavailable: c.score == null,
    });
  }
  const overall = Math.round(total);

  // Data-quality & confidence (spec §23-24): both driven by how much we could assess.
  const dataQuality = Math.round((availWeightSum / 100) * 100); // % of intended weight covered
  const confidence = Math.max(20, Math.round(dataQuality * 0.9)); // capped; browser build is signal-limited

  return { overall, breakdown, dataQuality, confidence, coveredWeight: availWeightSum };
}

// ================= DECISION ENGINE (spec §19) =================
export function decide({ overall, dataQuality }, risk, redFlags) {
  let rating, emoji;
  if (overall >= 85) { rating = 'STRONG BUY'; emoji = '🟢'; }
  else if (overall >= 75) { rating = 'BUY'; emoji = '🟢'; }
  else if (overall >= 60) { rating = 'WATCH / HOLD'; emoji = '🟡'; }
  else if (overall >= 45) { rating = 'AVOID'; emoji = '🔴'; }
  else { rating = 'STRONG AVOID'; emoji = '🔴'; }

  const overrides = [];
  // Critical-risk overrides — never let a high score hide risk (spec §19).
  const critical = redFlags.filter((f) => f.severity === 'critical');
  if (critical.length) {
    if (rank(rating) > rank('AVOID')) { rating = 'AVOID'; emoji = '🔴'; }
    overrides.push('Critical risk flag(s) cap the rating at AVOID.');
  }
  if (dataQuality < 45) {
    overrides.push('Data quality is low — treat this as a preliminary signal only.');
    if (rank(rating) > rank('WATCH / HOLD')) { rating = 'WATCH / HOLD'; emoji = '🟡'; }
  }

  // Horizon suggestion from risk + trend-driven score.
  let horizon;
  if (risk.level === 'Very High') horizon = 'Short term / Swing (high volatility)';
  else if (overall >= 70 && (risk.level === 'Low' || risk.level === 'Moderate')) horizon = 'Long term (6-12m+)';
  else horizon = '6-12 months';

  return { rating, emoji, overrides, horizon };
}
const RANK = ['STRONG AVOID', 'AVOID', 'WATCH / HOLD', 'BUY', 'STRONG BUY'];
const rank = (r) => RANK.indexOf(r);

// ================= RED FLAGS (spec §17) =================
// Only flags derivable from price/volume/risk are asserted here — everything else is
// listed as "not assessable in this build" so the absence of a flag is never read as
// "clean" (spec §36.13). Wording avoids accusing companies of fraud (spec §17).
export function redFlags({ technical: t, trend: tr, risk: rk, perf }) {
  const flags = [];
  const add = (severity, label, detail) => flags.push({ severity, label, detail });

  if (rk?.maxDrawdown != null && rk.maxDrawdown <= -60)
    add('warn', 'Deep historical drawdown', `Peak-to-trough fall of ${rk.maxDrawdown}% in the sample.`);
  if (rk?.volatility != null && rk.volatility >= 45)
    add('warn', 'High volatility', `Annualized volatility ${rk.volatility}% — large price swings.`);
  if (rk?.beta != null && rk.beta >= 1.5)
    add('info', 'High beta', `Beta ${rk.beta} — amplifies market moves.`);
  if (t?.rsi14 != null && t.rsi14 >= 75)
    add('info', 'Short-term overbought', `RSI ${I.round(t.rsi14)} — stretched near-term.`);
  if (tr?.strength?.includes('Strong Bearish'))
    add('warn', 'Broad down-trend', 'Price below key moving averages across timeframes.');
  if (perf?.returns?.['1Y'] != null && perf.returns['1Y'] <= -40)
    add('warn', 'Sharp 1-year decline', `Down ${perf.returns['1Y']}% over 1Y — investigate cause.`);

  const notAssessable = [
    'Promoter pledge / promoter selling', 'Rising debt / interest coverage',
    'Negative or weak free cash flow', 'Profit growth without cash-flow growth',
    'Receivables / working-capital stress', 'Equity dilution', 'Auditor / governance issues',
    'Regulatory investigation or litigation', 'Related-party transactions',
  ];
  return { flags, notAssessable };
}
