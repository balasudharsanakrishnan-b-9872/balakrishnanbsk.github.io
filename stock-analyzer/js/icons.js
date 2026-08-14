// icons.js — a small, cohesive, hand-built icon set (no emoji, no icon-font dependency).
// All icons live on a 24×24 grid, monoline, 1.75 stroke, round caps/joins, and inherit
// color via `currentColor`. Filled variants set fill explicitly on their inner nodes.

export const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  starFilled: '<path fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.9A8.5 8.5 0 1 1 11.1 3 6.7 6.7 0 0 0 21 12.9Z"/>',
  trendUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M16 7h5v5"/>',
  trendDown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M16 17h5v-5"/>',
  gauge: '<path d="M4.5 18a8 8 0 1 1 15 0"/><path d="M12 18l4-5"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  shield: '<path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  activity: '<path d="M3 12h4l2.5 7 4-14 2.5 7H21"/>',
  scale: '<path d="M12 4v16M7 20h10M4 9h16"/><path d="M4 9l-2 5a3 3 0 0 0 6 0zM20 9l-2 5a3 3 0 0 0 6 0z"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3.5 12.5 8.5 4.7 8.5-4.7M3.5 16.5 12 21l8.5-4.5"/>',
  growth: '<path d="M12 21v-7"/><path d="M12 14c-1-3-3.5-4.5-7-4 .3 3.4 2.7 5.3 7 4z"/><path d="M12 12c.7-3.4 3-5.2 7-5 .2 3.6-2.4 5.6-7 5z"/>',
  health: '<path d="M20.5 8.6a4.6 4.6 0 0 0-8.5-2.4A4.6 4.6 0 0 0 3.5 8.6c0 1.2.4 2.3 1 3.3H8l1.5-2.4 2 5 1.6-3.3.9 1.7h5.5c.6-1 1-2.1 1-3.7z"/>',
  chartLine: '<path d="M4 4v15a1 1 0 0 0 1 1h15"/><path d="m7.5 14 3-3.2 3 2 4.5-5.3"/>',
  barChart: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-9"/>',
  newspaper: '<path d="M4 5h13v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/><path d="M8 9h5M8 12.5h5M8 16h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  alert: '<path d="M12 4 2.7 20h18.6L12 4z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  database: '<path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 12 12"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  compare: '<path d="M8 6H5a2 2 0 0 0-2 2v11"/><path d="M16 18h3a2 2 0 0 0 2-2V5"/><path d="M8 3 5 6l3 3M16 21l3-3-3-3"/>',
  briefcase: '<path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8z"/><path d="M8.5 8V6.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V8M4 13h16"/>',
  bolt: '<path d="M13 3 5 13h5l-1 8 8-11h-5z"/>',
  dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

// Return an <svg> string for an icon. `cls` sets a class; `size` overrides px size.
export function icon(name, cls = 'ic', size) {
  const s = size ? ` style="width:${size}px;height:${size}px"` : '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${s}>${ICON[name] || ''}</svg>`;
}

// The brand logo mark — an "aperture/lens" (analysis) holding three rising candlesticks
// (the market) with a gold spark at the peak (the signal/insight). Duotone via gradients.
// `id` keeps gradient ids unique if the mark is embedded more than once.
export function logoMark(px = 34, id = 'lg') {
  return `
<svg width="${px}" height="${px}" viewBox="0 0 40 40" fill="none" role="img" aria-label="BSK Stock Analyser logo">
  <defs>
    <linearGradient id="${id}-a" x1="6" y1="34" x2="34" y2="6" gradientUnits="userSpaceOnUse">
      <stop stop-color="#12b886"/><stop offset="1" stop-color="#4ff0be"/>
    </linearGradient>
    <linearGradient id="${id}-b" x1="8" y1="30" x2="30" y2="10" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3ddc97"/><stop offset="1" stop-color="#8ef7cf"/>
    </linearGradient>
  </defs>
  <rect x="3.2" y="3.2" width="33.6" height="33.6" rx="10.5" stroke="url(#${id}-a)" stroke-width="2.4"/>
  <path d="M11 26.5c3.2 0 4.2-4 7.2-4s3.4 4 7 4" opacity="0"/>
  <g stroke="url(#${id}-b)" stroke-width="2.6" stroke-linecap="round">
    <path d="M13.5 27.5v-7"/>
    <path d="M20 27.5V15.5"/>
    <path d="M26.5 27.5v-9"/>
  </g>
  <g stroke="url(#${id}-b)" stroke-width="1.6" stroke-linecap="round" opacity=".9">
    <path d="M13.5 15.5v1.5"/>
    <path d="M13.5 30.5v1.5"/>
    <path d="M20 11.5V13"/>
    <path d="M20 30.5V32"/>
    <path d="M26.5 13v1.5"/>
    <path d="M26.5 30.5V32"/>
  </g>
  <circle cx="26.5" cy="12" r="2.4" fill="#ffcf70"/>
</svg>`;
}

// Compact favicon variant as a data: URI (used in <link rel=icon>).
export function faviconDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="f" x1="6" y1="34" x2="34" y2="6" gradientUnits="userSpaceOnUse"><stop stop-color="#12b886"/><stop offset="1" stop-color="#4ff0be"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="11" fill="#0b1210"/><g stroke="#4ff0be" stroke-width="2.8" stroke-linecap="round"><path d="M13.5 27.5v-7"/><path d="M20 27.5V15.5"/><path d="M26.5 27.5v-9"/></g><circle cx="26.5" cy="12" r="2.6" fill="#ffcf70"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
