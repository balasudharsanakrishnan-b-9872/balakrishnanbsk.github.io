// config.js — client-side configuration.
//
// GOOGLE SIGN-IN (optional). Paste your Google OAuth **Web** client ID here to enable
// "Sign in with Google" + syncing the watchlist/theme to the user's own Google Drive
// (no database, no client secret). Leave it empty to keep sign-in disabled — the app
// works fully without it.
//
// How to get a client ID (one-time, free):
//  1. https://console.cloud.google.com/  → create/select a project.
//  2. "APIs & Services" → "Enabled APIs" → enable **Google Drive API**.
//  3. "OAuth consent screen" → External → add your email as a Test user; add scopes
//     openid, email, profile, and .../auth/drive.appdata.
//  4. "Credentials" → Create credentials → OAuth client ID → **Web application**.
//     Authorized JavaScript origins: your site origin(s), e.g.
//       http://localhost:8000  and  https://<your-project>.vercel.app
//  5. Copy the "Client ID" (ends with .apps.googleusercontent.com) into the value below.
//
// NOTE: a client ID is NOT a secret — it is safe to ship in the browser. There is no
// client secret in this flow.
export const GOOGLE_CLIENT_ID = '';
