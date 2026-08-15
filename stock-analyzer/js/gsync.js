// gsync.js — OPTIONAL Google Sign-In + per-user sync to the user's OWN Google Drive.
//
// No database, no server, no client secret. Uses Google Identity Services (GIS) token
// flow entirely in the browser to obtain a short-lived access token, then reads/writes a
// single JSON file in the Drive **appDataFolder** (a hidden, per-app folder only this app
// can see). Inert unless `GOOGLE_CLIENT_ID` is set in config.js.
//
// What syncs: the watchlist and theme preference. Nothing else leaves the browser.

import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'bsk-stock-analyser.json';

let tokenClient = null;
let accessToken = null;
let profile = null;      // { name, email, picture }
let fileId = null;
let onStateCb = () => {};
let onSignedInCb = null;

export function isEnabled() { return !!GOOGLE_CLIENT_ID; }
export function getState() { return { enabled: isEnabled(), signedIn: !!accessToken, profile }; }
export function setOnSignedIn(fn) { onSignedInCb = fn; }
function emit() { try { onStateCb(getState()); } catch (_) {} }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = resolve; s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

export async function initGoogle(onState) {
  onStateCb = onState || (() => {});
  if (!isEnabled()) { emit(); return; }
  try {
    await loadScript('https://accounts.google.com/gsi/client');
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: async (resp) => {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          try { localStorage.setItem('sa_g_signed', '1'); } catch (_) {}
          await fetchProfile();
          emit();
          if (onSignedInCb) { try { await onSignedInCb(); } catch (_) {} }
        }
      },
    });
    // Try to silently resume a previous session (no popup) so sync "just works" on reload.
    let was = false; try { was = localStorage.getItem('sa_g_signed') === '1'; } catch (_) {}
    if (was) { try { tokenClient.requestAccessToken({ prompt: '' }); } catch (_) {} }
  } catch (_) { /* GIS unavailable — stay signed out, app still works */ }
  emit();
}

export function signIn() {
  if (!tokenClient) return;
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}
export function signOut() {
  const t = accessToken;
  accessToken = null; profile = null; fileId = null;
  try { localStorage.removeItem('sa_g_signed'); } catch (_) {}
  try { if (t && window.google) window.google.accounts.oauth2.revoke(t, () => {}); } catch (_) {}
  emit();
}

async function fetchProfile() {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (r.ok) profile = await r.json();
  } catch (_) {}
}

// ---- Drive appDataFolder read/write ----
async function driveJSON(path) {
  const r = await fetch('https://www.googleapis.com' + path, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) { if (r.status === 401) signOut(); return null; }
  return r.json();
}

async function findFile() {
  const j = await driveJSON(`/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${FILE_NAME}'`)}&fields=files(id,modifiedTime)`);
  const f = j && j.files && j.files[0];
  fileId = f ? f.id : null;
  return f || null;
}

export async function pull() {
  if (!accessToken) return null;
  await findFile();
  if (!fileId) return null;
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

export async function push(data) {
  if (!accessToken) return false;
  const boundary = '-------bsk-sync-boundary';
  const metadata = fileId ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  try {
    const r = await fetch(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!r.ok) { if (r.status === 401) signOut(); return false; }
    const j = await r.json();
    if (j && j.id) fileId = j.id;
    return true;
  } catch (_) { return false; }
}

// Pure merge (unit-tested): union watchlists by symbol (no data loss); theme = newer side.
export function mergeData(local, remote) {
  local = local || {}; remote = remote || {};
  const seen = new Map();
  [...(remote.watchlist || []), ...(local.watchlist || [])].forEach((x) => { if (x && x.s && !seen.has(x.s)) seen.set(x.s, x); });
  const newerRemote = (remote.updatedAt || 0) > (local.updatedAt || 0);
  const theme = newerRemote ? (remote.theme || local.theme) : (local.theme || remote.theme);
  return { watchlist: [...seen.values()], theme: theme || null, updatedAt: Date.now() };
}
