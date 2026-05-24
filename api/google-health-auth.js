/**
 * Google Health OAuth flow — run once to connect your account.
 *
 * Step 1 — visit in browser:
 *   GET /api/google-health-auth
 *   → redirects to Google consent screen
 *
 * Step 2 — Google redirects back here with ?code=...:
 *   GET /api/google-health-auth?code=...
 *   → exchanges code for tokens, stores refresh_token in Supabase, done.
 *
 * After this you never need to visit this endpoint again unless you
 * revoke access or the refresh token expires.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CLIENT_ID    = process.env.GOOGLE_HEALTH_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_HEALTH_CLIENT_SECRET
const REDIRECT_URI = process.env.GOOGLE_HEALTH_REDIRECT_URI
const USER_ID      = process.env.HEALTH_IMPORT_USER_ID
const TOKENS_KEY   = 'google-health-tokens'

const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
].join(' ')

export default async function handler(req, res) {
  const { code, error } = req.query ?? {}

  // ── Error returned by Google ────────────────────────────────────────────
  if (error) {
    return res.status(400).send(`Google OAuth error: ${error}`)
  }

  // ── Step 1: no code — redirect to Google consent screen ─────────────────
  if (!code) {
    const params = new URLSearchParams({
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         SCOPES,
      access_type:   'offline',
      prompt:        'consent', // always return refresh_token
    })
    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  }

  // ── Step 2: exchange auth code for tokens ────────────────────────────────
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  })

  const tokens = await tokenRes.json()

  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error('[google-health-auth] Token exchange failed:', tokens)
    return res.status(500).send(
      `Token exchange failed: ${JSON.stringify(tokens)}<br><br>` +
      `If refresh_token is missing, you may need to revoke app access at ` +
      `<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> ` +
      `and try again.`
    )
  }

  // ── Store refresh token in Supabase ──────────────────────────────────────
  const { error: dbErr } = await supabase
    .from('user_data')
    .upsert(
      {
        key:        TOKENS_KEY,
        user_id:    USER_ID,
        value: {
          refresh_token: tokens.refresh_token,
          scope:         tokens.scope,
          stored_at:     new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key,user_id' }
    )

  if (dbErr) {
    console.error('[google-health-auth] Supabase write failed:', dbErr)
    return res.status(500).send(`Connected to Google but failed to save token: ${dbErr.message}`)
  }

  return res.status(200).send(
    '✅ Google Health connected successfully! You can close this tab.<br>' +
    'The daily sync cron will run automatically at 00:30 UTC each night.'
  )
}
