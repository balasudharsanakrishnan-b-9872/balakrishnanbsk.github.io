// charts.js — thin wrappers over Chart.js (loaded via CDN in index.html as global `Chart`).
// Charts are visual aids only; every plotted value comes from live data / indicators.

const registry = {};
function make(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return null;
  if (registry[canvasId]) registry[canvasId].destroy();
  registry[canvasId] = new Chart(el.getContext('2d'), config);
  return registry[canvasId];
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const GRID = 'rgba(148,163,184,0.15)';

function baseOpts(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: css('--text-dim'), boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: css('--text-dim'), maxTicksLimit: 8, font: { size: 10 } }, grid: { color: GRID } },
      y: { ticks: { color: css('--text-dim'), font: { size: 10 } }, grid: { color: GRID } },
    },
    ...extra,
  };
}

function slice(bars, range) {
  const map = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '3Y': 756, '5Y': 1260, MAX: Infinity };
  const n = map[range] ?? 252;
  return bars.slice(Math.max(0, bars.length - n));
}

function smaLine(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) { sum += closes[i]; if (i >= period) sum -= closes[i - period]; if (i >= period - 1) out[i] = sum / period; }
  return out;
}

export function priceChart(bars, range = '1Y') {
  const b = slice(bars, range);
  const labels = b.map((x) => new Date(x.t).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }));
  const closes = b.map((x) => x.adj ?? x.c);
  make('chartPrice', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Price', data: closes, borderColor: css('--accent'), borderWidth: 1.6, pointRadius: 0, tension: 0.1 },
        { label: 'SMA 50', data: smaLine(closes, 50), borderColor: '#f59e0b', borderWidth: 1, pointRadius: 0, borderDash: [4, 3] },
        { label: 'SMA 200', data: smaLine(closes, 200), borderColor: '#ef4444', borderWidth: 1, pointRadius: 0, borderDash: [4, 3] },
      ],
    },
    options: baseOpts(),
  });
}

export function volumeChart(bars, range = '1Y') {
  const b = slice(bars, range);
  make('chartVolume', {
    type: 'bar',
    data: {
      labels: b.map((x) => new Date(x.t).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })),
      datasets: [{ label: 'Volume', data: b.map((x) => x.v || 0), backgroundColor: 'rgba(56,189,248,0.4)' }],
    },
    options: baseOpts(),
  });
}

export function rsiChart(bars, range = '1Y') {
  const b = slice(bars, range);
  const closes = b.map((x) => x.adj ?? x.c);
  // rolling RSI(14)
  const rsis = new Array(closes.length).fill(null);
  const period = 14;
  for (let end = period; end < closes.length; end++) {
    let g = 0, l = 0;
    for (let i = end - period + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
    const rs = l === 0 ? 100 : g / l; rsis[end] = l === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  make('chartRsi', {
    type: 'line',
    data: {
      labels: b.map((x) => new Date(x.t).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })),
      datasets: [{ label: 'RSI 14', data: rsis, borderColor: '#a78bfa', borderWidth: 1.4, pointRadius: 0 }],
    },
    options: baseOpts({ scales: { y: { min: 0, max: 100, ticks: { color: css('--text-dim'), stepSize: 25 }, grid: { color: GRID } }, x: { ticks: { color: css('--text-dim'), maxTicksLimit: 8 }, grid: { color: GRID } } } }),
  });
}

export function scoreGauge(canvasId, breakdown) {
  make(canvasId, {
    type: 'bar',
    data: {
      labels: breakdown.map((b) => b.key),
      datasets: [{
        label: 'Score (0-100)',
        data: breakdown.map((b) => b.score),
        backgroundColor: breakdown.map((b) => (b.score == null ? '#475569' : b.score >= 60 ? '#22c55e' : b.score >= 45 ? '#eab308' : '#ef4444')),
      }],
    },
    options: baseOpts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: { color: css('--text-dim') }, grid: { color: GRID } }, y: { ticks: { color: css('--text-dim'), font: { size: 10 } }, grid: { display: false } } } }),
  });
}

export function destroyAll() { Object.values(registry).forEach((c) => c && c.destroy()); }
