// indicators.js — deterministic financial calculations.
// EVERY number the app shows about price/technical/risk is computed here in plain,
// testable code (spec §31: never let an LLM compute critical metrics). No fabrication:
// functions return null when there is insufficient data instead of guessing.

// ---------- helpers ----------
export const round = (x, d = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const last = (a) => (a && a.length ? a[a.length - 1] : null);

// ---------- moving averages ----------
export function sma(values, period) {
  if (!values || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// full SMA series (aligned to input length; leading entries null)
export function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // seed with SMA of first `period`
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export const ema = (values, period) => last(emaSeries(values, period));

// ---------- RSI (Wilder's smoothing) ----------
export function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ---------- MACD ----------
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal) return null;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null,
  );
  const valid = macdLine.filter((v) => v != null);
  const signalSeries = emaSeries(valid, signal);
  const macdVal = last(valid);
  const signalVal = last(signalSeries);
  if (macdVal == null || signalVal == null) return null;
  return { macd: macdVal, signal: signalVal, histogram: macdVal - signalVal };
}

// ---------- Bollinger Bands ----------
export function bollinger(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const price = last(closes);
  const upper = mean + mult * sd, lower = mean - mult * sd;
  return { upper, middle: mean, lower, percentB: (price - lower) / (upper - lower || 1) };
}

// ---------- ATR (Average True Range, Wilder) ----------
export function atr(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

// ---------- ADX (trend strength) ----------
export function adx(highs, lows, closes, period = 14) {
  if (!highs || highs.length < 2 * period) return null;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < highs.length; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const trS = smooth(tr), pS = smooth(plusDM), mS = smooth(minusDM);
  const dx = [];
  for (let i = 0; i < trS.length; i++) {
    const pDI = (100 * pS[i]) / (trS[i] || 1);
    const mDI = (100 * mS[i]) / (trS[i] || 1);
    dx.push((100 * Math.abs(pDI - mDI)) / (pDI + mDI || 1));
  }
  if (dx.length < period) return last(dx);
  let a = dx.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < dx.length; i++) a = (a * (period - 1) + dx[i]) / period;
  return a;
}

// ---------- returns / performance ----------
// Return over the last N trading sessions (absolute %). Uses actual bar count so
// weekends/holidays are naturally handled.
export function pctReturn(closes, sessionsBack) {
  if (!closes || closes.length <= sessionsBack) return null;
  const p0 = closes[closes.length - 1 - sessionsBack];
  const p1 = last(closes);
  if (!p0) return null;
  return ((p1 - p0) / p0) * 100;
}

export function cagr(closes, years) {
  if (!closes || closes.length < 2 || years <= 0) return null;
  const p0 = closes[0], p1 = last(closes);
  if (p0 <= 0) return null;
  return ((p1 / p0) ** (1 / years) - 1) * 100;
}

// annualized volatility from daily closes (252 trading days)
export function annualVolatility(closes) {
  const r = dailyReturns(closes);
  if (r.length < 2) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}

export function maxDrawdown(closes) {
  if (!closes || closes.length < 2) return null;
  let peak = closes[0], mdd = 0;
  for (const p of closes) { if (p > peak) peak = p; const dd = (p - peak) / peak; if (dd < mdd) mdd = dd; }
  return mdd * 100; // negative %
}

// beta vs benchmark daily returns (aligned by trimming to common length)
export function beta(stockCloses, benchCloses) {
  const rs = dailyReturns(stockCloses), rb = dailyReturns(benchCloses);
  const n = Math.min(rs.length, rb.length);
  if (n < 30) return null;
  const a = rs.slice(-n), b = rb.slice(-n);
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); varb += (b[i] - mb) ** 2; }
  if (varb === 0) return null;
  return cov / varb;
}

// annualized Sharpe using a supplied annual risk-free rate (default 6.5% ~ India)
export function sharpe(closes, rfAnnual = 0.065) {
  const r = dailyReturns(closes);
  if (r.length < 30) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return null;
  const rfDaily = rfAnnual / 252;
  return ((mean - rfDaily) / sd) * Math.sqrt(252);
}

// downside (semi-)volatility, annualized
export function downsideVolatility(closes) {
  const r = dailyReturns(closes).filter((x) => x < 0);
  if (r.length < 2) return null;
  const mean = 0; // deviations below zero
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

// ---------- tiny self-test (runs in console; guards against regressions, spec §36.15) ----------
export function _selfTest() {
  const out = [];
  const eq = (name, got, want, tol = 0.01) => out.push({ name, ok: got != null && Math.abs(got - want) <= tol, got, want });
  eq('sma', sma([1, 2, 3, 4, 5], 5), 3);
  eq('emaLast>seed', ema([1, 2, 3, 4, 5, 6, 7, 8], 3) > 3 ? 1 : 0, 1);
  // RSI of a strictly rising series -> 100
  eq('rsi-up', rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14), 100, 0.5);
  eq('cagr-double-1y', cagr([100, 200], 1), 100, 0.5);
  eq('mdd', maxDrawdown([100, 80, 120]), -20, 0.5);
  const fails = out.filter((t) => !t.ok);
  if (fails.length) console.warn('[indicators self-test] FAILED', fails);
  else console.info('[indicators self-test] all', out.length, 'checks passed');
  return out;
}
