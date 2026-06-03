/**
 * Google Health API sync.
 *
 * Pulls health data directly from Google Health API (Fitbit syncs there automatically).
 *
 * Two modes, triggered by Vercel cron:
 *
 *   overnight  (00:30 UTC)  — finalises steps + weight for yesterday only
 *   daytime    (08:00–21:00 UTC)  — fetches all metrics attributed to TODAY
 *       (Google Health attributes overnight metrics — sleep, resting HR, HRV,
 *        SpO2, resp rate — to the date you WOKE UP, not when you fell asleep)
 *
 * The 08:00 run also re-finalises yesterday's steps in case of late sync.
 *
 * Manual triggers:
 *   POST /api/google-health-sync                     (x-health-secret header)
 *   GET  /api/google-health-sync?date=YYYY-MM-DD     (overnight/backfill mode)
 *   GET  /api/google-health-sync?debug=true          (inspect raw API responses)
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CLIENT_ID      = process.env.GOOGLE_HEALTH_CLIENT_ID
const CLIENT_SECRET  = process.env.GOOGLE_HEALTH_CLIENT_SECRET
const USER_ID        = process.env.HEALTH_IMPORT_USER_ID
const TOKENS_KEY     = 'google-health-tokens'
const LIFE_LOGS_KEY  = 'lifetracker-life-logs'
const FITBIT_RAW_KEY = 'lifetracker-fitbit-raw'
const BASE_URL       = 'https://health.googleapis.com/v4/users/me'

// ── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorised(req) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers['authorization'] === `Bearer ${cronSecret}`) return true
  const secret = req.headers['x-health-secret']
  if (secret && secret === process.env.HEALTH_IMPORT_SECRET) return true
  return false
}

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
  return data.access_token
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function utcDateString(offsetDays = 0) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

// Build a CivilDateTime object for the dailyRollUp POST body
function civilDateTime(dateStr, hours = 0, minutes = 0, seconds = 0) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { date: { year, month, day }, time: { hours, minutes, seconds, nanos: 0 } }
}

// Check whether a CivilDate object {year, month, day} matches a YYYY-MM-DD string
function civilDateMatches(civilDate, dateStr) {
  if (!civilDate || !dateStr) return false
  const [year, month, day] = dateStr.split('-').map(Number)
  return civilDate.year === year && civilDate.month === month && civilDate.day === day
}

// ── Google Health API fetch helpers ──────────────────────────────────────────

/**
 * Thrown when Google returns MISSING_OAUTH_SCOPE — needs re-auth, not a retry.
 */
class ScopeError extends Error {
  constructor(dataType, required) {
    super(`OAuth scope missing for ${dataType}: requires ${required}. Re-auth needed: /api/google-health-auth`)
    this.name = 'ScopeError'
  }
}

function checkForScopeError(dataType, status, body) {
  if (status !== 403) return
  let parsed
  try { parsed = JSON.parse(body) } catch { return }
  const reason = parsed?.error?.details?.[0]?.reason
  if (reason === 'MISSING_OAUTH_SCOPE') {
    const required = parsed?.error?.details?.[0]?.metadata?.any_of_required ?? 'unknown'
    throw new ScopeError(dataType, required)
  }
}

/**
 * POST .../dataPoints:dailyRollUp — used for steps (and total-calories once tested).
 * Body uses CivilDateTime, NOT ISO timestamp strings.
 */
async function fetchDailyRollup(accessToken, dataType, dateStr, debugErrors) {
  const url = `${BASE_URL}/dataTypes/${dataType}/dataPoints:dailyRollUp`
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      range: {
        start: civilDateTime(dateStr, 0,  0,  0),
        end:   civilDateTime(dateStr, 23, 59, 59),
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`[google-health-sync] ${dataType} rollup ${res.status}:`, text)
    if (debugErrors) debugErrors[dataType] = { status: res.status, url, body: text }
    checkForScopeError(dataType, res.status, text)
    return null
  }
  return res.json()
}

/**
 * GET .../dataPoints — used for all list-based metrics.
 * No date filter param exists; we filter client-side by date field.
 */
async function listDataPoints(accessToken, dataType, pageSize = 10, debugErrors) {
  const url = `${BASE_URL}/dataTypes/${dataType}/dataPoints?pageSize=${pageSize}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) {
    const text = await res.text()
    console.error(`[google-health-sync] ${dataType} list ${res.status}:`, text)
    if (debugErrors) debugErrors[dataType] = { status: res.status, url, body: text }
    checkForScopeError(dataType, res.status, text)
    return null
  }
  return res.json()
}

/**
 * Paginated list fetch — follows nextPageToken until data reaches untilDate or no more pages.
 * Returns a synthetic response with all dataPoints merged into one array.
 */
async function listDataPointsUntil(accessToken, dataType, untilDate, pageSize = 20) {
  const allPoints = []
  let pageToken = null

  while (true) {
    const urlParams = new URLSearchParams({ pageSize })
    if (pageToken) urlParams.set('pageToken', pageToken)
    const url = `${BASE_URL}/dataTypes/${dataType}/dataPoints?${urlParams}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      console.error(`[google-health-sync] ${dataType} paginated list ${res.status}`)
      break
    }
    const data = await res.json()
    const points = data.dataPoints ?? []
    allPoints.push(...points)

    // Check if oldest point in this page is already before our target date
    // (Sleep uses endTime; other types use civil date fields — stop when we have enough)
    const oldest = points[points.length - 1]
    const oldestDate = oldest?.sleep?.interval?.endTime?.slice(0, 10)
                    ?? oldest?.dailyRestingHeartRate?.date
                    ?? oldest?.heartRateVariability?.sampleTime?.civilTime?.date
                    ?? oldest?.dailyOxygenSaturation?.date
                    ?? oldest?.dailyRespiratoryRate?.date
                    ?? oldest?.dailySleepTemperatureDerivations?.date
    if (!data.nextPageToken || (oldestDate && oldestDate <= untilDate)) break
    pageToken = data.nextPageToken
  }

  return { dataPoints: allPoints }
}

// ── Value parsers — based on confirmed API response shapes ───────────────────

// Steps from dailyRollUp: rollupDataPoints[0].steps.countSum (string)
function parseSteps(data) {
  const val = data?.rollupDataPoints?.[0]?.steps?.countSum
  return val != null ? parseInt(val) : null
}

/**
 * Sleep: find the session whose endTime falls on targetDate (UTC).
 * Google Health attributes sleep to the date you woke up, not when you fell asleep.
 *
 * summary.minutesAsleep        = time actually asleep (excl. awake periods)
 * summary.minutesInSleepPeriod = total time in bed (incl. awake periods)
 * summary.stagesSummary[]      = [{ type: "REM"|"DEEP"|"LIGHT"|"AWAKE", minutes, count }]
 *                                only present for STAGES-type sleep (Fitbit with stage tracking)
 */
function parseSleepForDate(data, targetDate) {
  const points = data?.dataPoints
  if (!points?.length) return { sleep_minutes: null, in_bed_minutes: null }

  const session = points.find(p => p.sleep?.interval?.endTime?.startsWith(targetDate))
  if (!session) return { sleep_minutes: null, in_bed_minutes: null }

  const summary = session.sleep?.summary

  // Stage breakdown (only available on STAGES-type sessions)
  const stageLookup = {}
  for (const s of summary?.stagesSummary ?? []) {
    if (s.type && s.minutes != null) stageLookup[s.type] = parseInt(s.minutes)
  }
  const rem_minutes   = stageLookup['REM']   ?? null
  const deep_minutes  = stageLookup['DEEP']  ?? null
  const light_minutes = stageLookup['LIGHT'] ?? null
  const awake_minutes = stageLookup['AWAKE'] ?? null

  return {
    sleep_minutes:  summary?.minutesAsleep        ? parseInt(summary.minutesAsleep)        : null,
    in_bed_minutes: summary?.minutesInSleepPeriod ? parseInt(summary.minutesInSleepPeriod) : null,
    rem_minutes,
    deep_minutes,
    light_minutes,
    awake_minutes,
  }
}

// Resting HR: find daily entry where date matches; value is beatsPerMinute (string)
function parseRestingHR(data, dateStr) {
  const p = data?.dataPoints?.find(p => civilDateMatches(p.dailyRestingHeartRate?.date, dateStr))
  const bpm = p?.dailyRestingHeartRate?.beatsPerMinute
  return bpm != null ? parseInt(bpm) : null
}

// HRV: average RMSSD across all samples attributed to dateStr
// (Fitbit records 5-min interval readings throughout the night)
function parseHRV(data, dateStr) {
  const points = data?.dataPoints?.filter(p =>
    civilDateMatches(p.heartRateVariability?.sampleTime?.civilTime?.date, dateStr)
  )
  if (!points?.length) return null
  const avg = points.reduce((sum, p) =>
    sum + (p.heartRateVariability?.rootMeanSquareOfSuccessiveDifferencesMilliseconds ?? 0), 0
  ) / points.length
  return Math.round(avg * 10) / 10  // 1 decimal
}

// SpO2: daily-oxygen-saturation gives Fitbit's overnight computed average
// Field path TBD — log raw point if null so we can inspect the shape
function parseSpO2(data, dateStr) {
  const points = data?.dataPoints
  if (!points?.length) return null
  // Try daily format first (date-keyed, like resting HR)
  const daily = points.find(p => civilDateMatches(p.dailyOxygenSaturation?.date, dateStr))
  if (daily) {
    const val = daily.dailyOxygenSaturation?.averagePercentage
              ?? daily.dailyOxygenSaturation?.percentage
    return val != null ? Math.round(val * 10) / 10 : null
  }
  // Fallback: intraday sample format
  const intraday = points.filter(p =>
    civilDateMatches(p.oxygenSaturation?.sampleTime?.civilTime?.date, dateStr)
  )
  if (!intraday.length) {
    console.log('[google-health-sync] SpO2 raw point for inspection:', JSON.stringify(points[0]))
    return null
  }
  const avg = intraday.reduce((sum, p) => sum + (p.oxygenSaturation?.percentage ?? 0), 0) / intraday.length
  return Math.round(avg * 10) / 10
}

// Respiratory rate: find daily entry where date matches
function parseRespRate(data, dateStr) {
  const p = data?.dataPoints?.find(p => civilDateMatches(p.dailyRespiratoryRate?.date, dateStr))
  return p?.dailyRespiratoryRate?.breathsPerMinute ?? null
}

// Weight: most recent reading, convert grams → kg
function parseWeight(data) {
  const grams = data?.dataPoints?.[0]?.weight?.weightGrams
  return grams != null ? Math.round(grams / 100) / 10 : null  // e.g. 63900g → 63.9kg
}

// Total calories from dailyRollUp — response shape to be confirmed from debug probe.
// Fitbit reports a single "total calories" figure (resting + active combined).
// Try common field paths and log the raw point if none match.
// Total calories from dailyRollUp: rollupDataPoints[0].totalCalories.kcalSum
function parseTotalCalories(data) {
  const val = data?.rollupDataPoints?.[0]?.totalCalories?.kcalSum
  return val != null ? Math.round(val) : null
}

/**
 * Skin temperature deviation: nightly skin temp minus 30-day personal baseline.
 * Type: daily-sleep-temperature-derivations (list endpoint).
 * Positive = warmer than usual (inflammation signal); negative = cooler.
 * Falls back to null if no baseline yet (< 30 days of data).
 */
function parseSkinTempDeviation(data, dateStr) {
  const p = data?.dataPoints?.find(pt =>
    civilDateMatches(pt.dailySleepTemperatureDerivations?.date, dateStr)
  )
  if (!p) return null
  const d = p.dailySleepTemperatureDerivations
  const nightly  = d?.nightlyTemperatureCelsius
  const baseline = d?.baselineTemperatureCelsius
  if (nightly == null) return null
  if (baseline == null) return null               // no baseline yet — don't return raw temp
  return Math.round((nightly - baseline) * 100) / 100  // 2 decimal places (e.g. +0.23°C)
}

// ── Metric fetchers ───────────────────────────────────────────────────────────

/**
 * All metrics for a given date (daytime and overnight).
 * Overnight metrics (sleep, resting HR, HRV, SpO2, resp rate) are attributed
 * by Google/Fitbit to the date you woke up — so pass TODAY as dateStr.
 */
async function fetchAllMetrics(accessToken, dateStr) {
  const [
    stepsData, sleepData, hrData, hrvData, spo2Data, respData, weightData,
    caloriesData, skinTempData,
  ] = await Promise.all([
    fetchDailyRollup(accessToken, 'steps',                              dateStr),
    listDataPoints(  accessToken, 'sleep',                              10),  // find session ending on dateStr
    listDataPoints(  accessToken, 'daily-resting-heart-rate',           5),
    listDataPoints(  accessToken, 'heart-rate-variability',             500), // many 5-min samples per night
    listDataPoints(  accessToken, 'daily-oxygen-saturation',            5),   // daily computed avg
    listDataPoints(  accessToken, 'daily-respiratory-rate',             5),
    listDataPoints(  accessToken, 'weight',                             3),   // most recent
    fetchDailyRollup(accessToken, 'total-calories',                     dateStr),
    listDataPoints(  accessToken, 'daily-sleep-temperature-derivations', 5),  // nightly temp deviation
  ])

  return {
    steps:               parseSteps(stepsData),
    resting_hr:          parseRestingHR(hrData, dateStr),
    hrv:                 parseHRV(hrvData, dateStr),
    spo2:                parseSpO2(spo2Data, dateStr),
    respiratory_rate:    parseRespRate(respData, dateStr),
    weight_kg:           parseWeight(weightData),
    total_calories_kcal: parseTotalCalories(caloriesData),
    skin_temp_deviation: parseSkinTempDeviation(skinTempData, dateStr),
    ...parseSleepForDate(sleepData, dateStr),
  }
}

/**
 * Daytime-only metrics (steps + weight) for finalising a previous day.
 * Used by: overnight cron (finalise yesterday's steps/weight).
 */
async function fetchDaytimeMetrics(accessToken, dateStr) {
  const [stepsData, weightData, caloriesData] = await Promise.all([
    fetchDailyRollup(accessToken, 'steps',          dateStr),
    listDataPoints(  accessToken, 'weight',          3),
    fetchDailyRollup(accessToken, 'total-calories',  dateStr),
  ])
  return {
    steps:               parseSteps(stepsData),
    weight_kg:           parseWeight(weightData),
    total_calories_kcal: parseTotalCalories(caloriesData),
  }
}

// ── Sleep score ───────────────────────────────────────────────────────────────

/**
 * Compute a 0–100 sleep score from available metrics + personal baselines.
 *
 * Components (when all present):
 *   Duration  30 pts  — 7–9h optimal; scaled below; slight penalty for >9h
 *   HRV       35 pts  — z-score vs personal 30-day median (highly individual)
 *   SpO2      20 pts  — ≥95% = full marks; linear penalty below
 *   Resting HR 15 pts — vs personal 30-day average; lower = better recovery
 *   Skin temp  modifier — penalty if nightly temp significantly above baseline
 *
 * Missing components are excluded and remaining ones are scaled to 100.
 * Returns null if fewer than 2 components are available.
 *
 * @param {object} metrics  — today's parsed metrics
 * @param {object} rawAll   — full lifetracker-fitbit-raw object (for baselines)
 * @param {string} writeDate — YYYY-MM-DD being written (excluded from baseline)
 */
function computeSleepScore(metrics, rawAll, writeDate) {
  const {
    sleep_minutes, hrv, spo2, resting_hr, skin_temp_deviation,
    rem_minutes, deep_minutes, light_minutes,
  } = metrics

  const hasStages = rem_minutes != null && deep_minutes != null && light_minutes != null

  // ── Build 30-day baseline arrays (exclude today) ───────────────────────────
  const cutoff = new Date(writeDate + 'T00:00:00Z')
  cutoff.setUTCDate(cutoff.getUTCDate() - 30)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const baseline = Object.entries(rawAll)
    .filter(([d]) => d >= cutoffStr && d < writeDate)
    .map(([, v]) => v)

  const baselineHRV = baseline.map(v => v.hrv).filter(v => v != null)
  const baselineHR  = baseline.map(v => v.resting_hr).filter(v => v != null)

  // ── Duration (25 pts) ─────────────────────────────────────────────────────
  let durationScore = null
  if (sleep_minutes != null) {
    const h = sleep_minutes / 60
    if      (h >= 7 && h <= 9) durationScore = 25
    else if (h > 9)            durationScore = 22
    else if (h >= 6)           durationScore = Math.round(18 * (h - 6))
    else if (h >= 5)           durationScore = Math.round(8 + 4 * (h - 5))
    else                       durationScore = Math.max(0, Math.round(h * 2))
  }

  // ── Stage quality (25 pts) — Deep + REM ───────────────────────────────────
  let qualityScore = null
  if (hasStages && sleep_minutes > 0) {
    const deepPct = deep_minutes / sleep_minutes
    const remPct  = rem_minutes  / sleep_minutes
    const deepScore = Math.round(Math.min(13, (deepPct / 0.18) * 13))
    const remScore  = Math.round(Math.min(12, (remPct  / 0.20) * 12))
    qualityScore = deepScore + remScore
  }

  // ── HRV (20 pts with stages, 35 pts without) ──────────────────────────────
  // Carries more weight when stages aren't available as it proxies sleep quality.
  const hrvMax = hasStages ? 20 : 35
  let hrvScore = null
  if (hrv != null && baselineHRV.length >= 7) {
    const sorted   = [...baselineHRV].sort((a, b) => a - b)
    const median   = sorted[Math.floor(sorted.length / 2)]
    const variance = baselineHRV.reduce((s, v) => s + (v - median) ** 2, 0) / baselineHRV.length
    const std      = Math.sqrt(variance)
    const z        = std > 0 ? (hrv - median) / std : 0
    hrvScore = Math.round(Math.min(hrvMax, Math.max(0, hrvMax / 2 + z * (hrvMax / 4))))
  }

  // ── SpO2 (15 pts) ─────────────────────────────────────────────────────────
  let spo2Score = null
  if (spo2 != null) {
    if      (spo2 >= 95) spo2Score = 15
    else if (spo2 >= 93) spo2Score = Math.round(10 + (spo2 - 93) * 2.5)
    else if (spo2 >= 90) spo2Score = Math.round(3  + (spo2 - 90) * 2.3)
    else                 spo2Score = 0
  }

  // ── Resting HR (10 pts) ───────────────────────────────────────────────────
  let hrScore = null
  if (resting_hr != null && baselineHR.length >= 7) {
    const avg  = baselineHR.reduce((a, b) => a + b, 0) / baselineHR.length
    const diff = avg - resting_hr
    hrScore = Math.round(Math.min(10, Math.max(0, 5 + diff)))
  }

  // ── Combine — scale proportionally if any component is missing ─────────────
  // Note: skin_temp_deviation is intentionally excluded from the score.
  // It's an inflammation/illness signal, not a sleep quality signal — Fitbit
  // doesn't include it in their score either. Surface it separately in the UI.
  const parts = [
    { score: durationScore, max: 25 },
    { score: qualityScore,  max: 25 },
    { score: hrvScore,      max: hrvMax },
    { score: spo2Score,     max: 15 },
    { score: hrScore,       max: 10 },
  ].filter(p => p.score != null)

  if (parts.length < 1) return null

  const earned   = parts.reduce((s, p) => s + p.score, 0)
  const possible = parts.reduce((s, p) => s + p.max,   0)

  return Math.min(100, Math.max(0, Math.round((earned / possible) * 100)))
}

// ── Supabase write ────────────────────────────────────────────────────────────

function minutesToHoursLabel(minutes) {
  if (minutes == null) return null
  if (minutes < 270) return '<5'
  if (minutes < 330) return '5'
  if (minutes < 390) return '6'
  if (minutes < 450) return '7'
  if (minutes < 510) return '8'
  return '9+'
}

async function writeToSupabase(writeDate, metrics) {
  const {
    steps, sleep_minutes, in_bed_minutes, resting_hr, hrv,
    respiratory_rate, spo2, weight_kg, total_calories_kcal, skin_temp_deviation,
    rem_minutes, deep_minutes, light_minutes, awake_minutes,
  } = metrics

  // ── Load both tables in parallel ───────────────────────────────────────────
  const [{ data: logsRow }, { data: rawRow }] = await Promise.all([
    supabase.from('user_data').select('value').eq('key', LIFE_LOGS_KEY).eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', FITBIT_RAW_KEY).eq('user_id', USER_ID).single(),
  ])

  const logs = logsRow?.value ?? {}
  const raw  = rawRow?.value  ?? {}

  // ── Build fitbit-raw patch ─────────────────────────────────────────────────
  const patch = { synced_at: new Date().toISOString(), source: 'google-health-api' }

  if (steps                != null) patch.steps                = steps
  if (sleep_minutes        != null) patch.sleep_minutes        = sleep_minutes
  if (in_bed_minutes       != null) patch.in_bed_minutes       = in_bed_minutes
  if (resting_hr           != null) patch.resting_hr           = resting_hr
  if (hrv                  != null) patch.hrv                  = hrv
  if (spo2                 != null) patch.spo2                 = spo2
  if (respiratory_rate     != null) patch.respiratory_rate     = respiratory_rate
  if (weight_kg            != null) patch.weight_kg            = weight_kg
  if (total_calories_kcal  != null) patch.total_calories_kcal  = total_calories_kcal
  if (skin_temp_deviation  != null) patch.skin_temp_deviation  = skin_temp_deviation
  if (rem_minutes          != null) patch.rem_minutes          = rem_minutes
  if (deep_minutes         != null) patch.deep_minutes         = deep_minutes
  if (light_minutes        != null) patch.light_minutes        = light_minutes
  if (awake_minutes        != null) patch.awake_minutes        = awake_minutes

  // ── Sleep score — computed before writing so it lands in both tables ───────
  const mergedDay  = { ...(raw[writeDate] ?? {}), ...patch }
  const sleepScore = computeSleepScore(mergedDay, raw, writeDate)
  if (sleepScore != null) patch.sleep_score = sleepScore

  // ── Build life-logs day entry ──────────────────────────────────────────────
  const dayLog    = { ...(logs[writeDate] ?? {}) }
  const sleepHours = minutesToHoursLabel(sleep_minutes)

  if (sleepHours) {
    const efficiencyPct = (sleep_minutes && in_bed_minutes)
      ? Math.round((sleep_minutes / in_bed_minutes) * 100) : null
    dayLog.sleep = {
      ...(dayLog.sleep ?? {}),
      hours:           sleepHours,
      _fitbit_minutes: sleep_minutes,
      _in_bed_minutes: in_bed_minutes ?? null,
      ...(efficiencyPct   != null ? { efficiency_pct: efficiencyPct } : {}),
      ...(sleepScore      != null ? { score:          sleepScore }     : {}),
      ...(rem_minutes     != null ? { rem_minutes }                    : {}),
      ...(deep_minutes    != null ? { deep_minutes }                   : {}),
      ...(light_minutes   != null ? { light_minutes }                  : {}),
      ...(awake_minutes   != null ? { awake_minutes }                  : {}),
    }
  } else if (sleepScore != null) {
    // Score available even if hours label not updated (e.g. daytime re-sync)
    dayLog.sleep = { ...(dayLog.sleep ?? {}), score: sleepScore }
  }

  if (steps != null) {
    dayLog.exercise = { ...(dayLog.exercise ?? {}), steps }
  }

  // ── Write both tables in parallel ──────────────────────────────────────────
  raw[writeDate] = { ...(raw[writeDate] ?? {}), ...patch }
  logs[writeDate] = dayLog

  const [{ error: logsErr }] = await Promise.all([
    supabase.from('user_data').upsert(
      { key: LIFE_LOGS_KEY,  user_id: USER_ID, value: logs, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    ),
    supabase.from('user_data').upsert(
      { key: FITBIT_RAW_KEY, user_id: USER_ID, value: raw,  updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    ),
  ])
  if (logsErr) throw new Error(`Failed to write logs: ${logsErr.message}`)

  return patch
}

// ── Backfill ──────────────────────────────────────────────────────────────────

/**
 * Backfill all metrics for every date in [fromDate, toDate] (inclusive).
 *
 * Strategy: fetch list-based endpoints ONCE with a large page size (they return
 * the most recent N points regardless of date), then parse each date from that
 * batch. Only steps + calories need a per-date rollup call — run those in
 * small parallel batches to avoid rate-limit bursts.
 */
async function backfillRange(accessToken, fromDate, toDate, options = {}) {
  // Build array of date strings oldest → newest
  const dates = []
  const cur = new Date(fromDate + 'T00:00:00Z')
  const end = new Date(toDate   + 'T00:00:00Z')
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  const nDays = dates.length

  const sleepOnly     = options?.sleepOnly     ?? false
  const caloriesOnly  = options?.caloriesOnly  ?? false

  // Fetch list-based data once with enough history to cover the range
  // Use paginated fetcher so we always reach fromDate regardless of API page caps
  const [sleepData, hrData, hrvData, spo2Data, respData, skinTempData] =
    await Promise.all([
      caloriesOnly ? Promise.resolve(null) : listDataPointsUntil(accessToken, 'sleep',                               fromDate),
      (sleepOnly || caloriesOnly) ? Promise.resolve(null) : listDataPointsUntil(accessToken, 'daily-resting-heart-rate',            fromDate),
      (sleepOnly || caloriesOnly) ? Promise.resolve(null) : listDataPointsUntil(accessToken, 'heart-rate-variability',              fromDate, 50),
      (sleepOnly || caloriesOnly) ? Promise.resolve(null) : listDataPointsUntil(accessToken, 'daily-oxygen-saturation',             fromDate),
      (sleepOnly || caloriesOnly) ? Promise.resolve(null) : listDataPointsUntil(accessToken, 'daily-respiratory-rate',              fromDate),
      (sleepOnly || caloriesOnly) ? Promise.resolve(null) : listDataPointsUntil(accessToken, 'daily-sleep-temperature-derivations', fromDate),
    ])

  // Fetch total-calories per date in batches of 5 (per-date rollup — can't bulk-fetch)
  const caloriesMap = {}
  if (!sleepOnly) {
    const BATCH = 5
    for (let i = 0; i < dates.length; i += BATCH) {
      const batch = dates.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(d => fetchDailyRollup(accessToken, 'total-calories', d).catch(() => null))
      )
      batch.forEach((d, idx) => {
        caloriesMap[d] = parseTotalCalories(results[idx])
      })
    }
  }

  // Parse + write each date (steps are skipped — manually entered data is preserved)
  const results = {}
  for (const dateStr of dates) {
    const metrics = caloriesOnly
      ? { total_calories_kcal: caloriesMap[dateStr] ?? null }
      : {
          resting_hr:          parseRestingHR(hrData, dateStr),
          hrv:                 parseHRV(hrvData, dateStr),
          spo2:                parseSpO2(spo2Data, dateStr),
          respiratory_rate:    parseRespRate(respData, dateStr),
          skin_temp_deviation: parseSkinTempDeviation(skinTempData, dateStr),
          total_calories_kcal: caloriesMap[dateStr] ?? null,
          ...parseSleepForDate(sleepData, dateStr),
        }

    // Only write dates that have at least some data
    const hasData = Object.values(metrics).some(v => v != null)
    if (hasData) {
      results[dateStr] = await writeToSupabase(dateStr, metrics)
    } else {
      results[dateStr] = 'no_data'
    }
  }

  return results
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  // ── Score comparison — reads stored raw data, no API calls ────────────────
  if (req.query?.compare === 'true') {
    const from = req.query.from ?? utcDateString(-7)
    const to   = req.query.to   ?? utcDateString(-1)
    const { data: rawRow } = await supabase
      .from('user_data').select('value')
      .eq('key', FITBIT_RAW_KEY).eq('user_id', USER_ID).single()
    const raw = rawRow?.value ?? {}
    const rows = Object.entries(raw)
      .filter(([d]) => d >= from && d <= to)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        sleep_h:    v.sleep_minutes ? +(v.sleep_minutes / 60).toFixed(1) : null,
        deep_pct:   (v.deep_minutes && v.sleep_minutes) ? Math.round(v.deep_minutes / v.sleep_minutes * 100) : null,
        rem_pct:    (v.rem_minutes  && v.sleep_minutes) ? Math.round(v.rem_minutes  / v.sleep_minutes * 100) : null,
        hrv:        v.hrv        ?? null,
        spo2:       v.spo2       ?? null,
        resting_hr: v.resting_hr ?? null,
        skin_temp:  v.skin_temp_deviation ?? null,
        our_score:  v.sleep_score ?? null,
      }))
    return res.status(200).json({ from, to, rows })
  }

  // ── Load + exchange refresh token ─────────────────────────────────────────
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('user_data').select('value')
    .eq('key', TOKENS_KEY).eq('user_id', USER_ID).single()

  if (tokenErr || !tokenRow?.value?.refresh_token) {
    return res.status(500).json({
      error: 'No Google Health token found.',
      hint:  'Visit /api/google-health-auth in your browser to connect your account.',
    })
  }

  let accessToken
  try {
    accessToken = await getAccessToken(tokenRow.value.refresh_token)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  const today     = utcDateString(0)
  const yesterday = utcDateString(-1)

  // ── Debug mode: return raw metrics without writing ─────────────────────────
  if (req.query?.debug === 'true') {
    const rollupErrors = {}
    const [stepsRaw, caloriesRaw, sleepRaw] = await Promise.all([
      fetchDailyRollup(accessToken, 'steps',          today, rollupErrors),
      fetchDailyRollup(accessToken, 'total-calories', today, rollupErrors),
      listDataPoints(  accessToken, 'sleep',          3),
    ])
    const [todayMetrics, yesterdaySteps] = await Promise.all([
      fetchAllMetrics(accessToken, today),
      fetchDaytimeMetrics(accessToken, yesterday),
    ])
    const sleepProbe = sleepRaw?.dataPoints?.[0]?.sleep ?? null
    return res.status(200).json({
      debug: true, today, yesterday,
      today_metrics:    todayMetrics,
      yesterday_steps:  yesterdaySteps,
      rollup_raw: {
        steps:    stepsRaw,
        calories: caloriesRaw,
      },
      rollup_errors: Object.keys(rollupErrors).length ? rollupErrors : undefined,
      sleep_probe: {
        endTime: sleepProbe?.interval?.endTime,
        summary: sleepProbe?.summary,
      },
    })
  }

  // ── Determine mode ────────────────────────────────────────────────────────
  const manualDate = req.query?.date
  const mode       = req.query?.mode ?? 'overnight'

  // ── Backfill mode ─────────────────────────────────────────────────────────
  if (mode === 'backfill') {
    const fromDate = req.query.from ?? utcDateString(-30)
    const toDate   = req.query.to   ?? yesterday

    // ?debugSleep=true — returns raw sleep session end-dates without writing anything
    if (req.query?.debugSleep === 'true') {
      const sleepData = await listDataPointsUntil(accessToken, 'sleep', fromDate)
      const sessions = (sleepData?.dataPoints ?? []).map(p => ({
        endTime: p.sleep?.interval?.endTime?.slice(0, 10) ?? null,
        minutes_asleep: p.sleep?.summary?.minutesAsleep ?? null,
      }))
      return res.status(200).json({ sleep_sessions: sessions })
    }

    try {
      const results = await backfillRange(accessToken, fromDate, toDate, {
        sleepOnly:    req.query?.sleepOnly    === 'true',
        caloriesOnly: req.query?.caloriesOnly === 'true',
      })
      const written = Object.values(results).filter(v => v !== 'no_data').length
      console.log(`[google-health-sync] backfill ${fromDate}→${toDate}: ${written}/${Object.keys(results).length} dates written`)
      return res.status(200).json({ ok: true, mode: 'backfill', from: fromDate, to: toDate, results })
    } catch (e) {
      console.error('[google-health-sync] Backfill error:', e)
      if (e.name === 'ScopeError') {
        return res.status(403).json({
          error: 'OAuth scope revoked — re-auth required',
          hint:  'Visit https://life-os-chi-opal.vercel.app/api/google-health-auth in your browser to reconnect.',
          detail: e.message,
        })
      }
      return res.status(500).json({ error: e.message })
    }
  }
  const results    = {}

  try {
    if (manualDate || mode === 'overnight') {
      // ── Overnight cron / backfill ──────────────────────────────────────────
      // Finalises steps + weight for yesterday only.
      // Sleep and overnight health metrics are already written by daytime crons
      // under the wake-up date (today) — don't touch them here.
      const targetDate = manualDate ?? yesterday
      results[targetDate] = await writeToSupabase(targetDate, await fetchDaytimeMetrics(accessToken, targetDate))

    } else {
      // ── Daytime crons ──────────────────────────────────────────────────────
      // Fetch all metrics for today. Google attributes overnight data (sleep,
      // resting HR, HRV, SpO2, resp rate) to the wake-up date = today.
      const utcHour = new Date().getUTCHours()
      const isFirstDaytimeRun = utcHour >= 8 && utcHour < 10 // 08:00 UTC

      const [todayMetrics, yesterdayFinalise] = await Promise.all([
        fetchAllMetrics(accessToken, today),
        isFirstDaytimeRun ? fetchDaytimeMetrics(accessToken, yesterday) : Promise.resolve(null),
      ])

      results[today] = await writeToSupabase(today, todayMetrics)

      if (yesterdayFinalise) {
        results[yesterday] = await writeToSupabase(yesterday, yesterdayFinalise)
      }
    }
  } catch (e) {
    console.error('[google-health-sync] Error:', e)
    if (e.name === 'ScopeError') {
      return res.status(403).json({
        error: 'OAuth scope revoked — re-auth required',
        hint:  'Visit https://life-os-chi-opal.vercel.app/api/google-health-auth in your browser to reconnect.',
        detail: e.message,
      })
    }
    return res.status(500).json({ error: e.message })
  }

  console.log('[google-health-sync]', mode, results)
  return res.status(200).json({ ok: true, mode, results })
}
