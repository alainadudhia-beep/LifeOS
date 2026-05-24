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
    return null
  }
  return res.json()
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
 * Uses the pre-computed summary rather than summing individual stages.
 *
 * summary.minutesAsleep    = time actually asleep (excl. awake periods)
 * summary.minutesInSleepPeriod = total time in bed (incl. awake periods)
 */
function parseSleepForDate(data, targetDate) {
  const points = data?.dataPoints
  if (!points?.length) return { sleep_minutes: null, in_bed_minutes: null }

  // Find the session that ended on our target date (UTC date string match)
  const session = points.find(p => p.sleep?.interval?.endTime?.startsWith(targetDate))
  if (!session) return { sleep_minutes: null, in_bed_minutes: null }

  const summary = session.sleep?.summary
  return {
    sleep_minutes:  summary?.minutesAsleep       ? parseInt(summary.minutesAsleep)       : null,
    in_bed_minutes: summary?.minutesInSleepPeriod ? parseInt(summary.minutesInSleepPeriod) : null,
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

// ── Metric fetchers ───────────────────────────────────────────────────────────

/**
 * All metrics for a given date (daytime and overnight).
 * Overnight metrics (sleep, resting HR, HRV, SpO2, resp rate) are attributed
 * by Google/Fitbit to the date you woke up — so pass TODAY as dateStr.
 */
async function fetchAllMetrics(accessToken, dateStr) {
  const [
    stepsData, sleepData, hrData, hrvData, spo2Data, respData, weightData,
  ] = await Promise.all([
    fetchDailyRollup(accessToken, 'steps',                    dateStr),
    listDataPoints(  accessToken, 'sleep',                    10),    // find session ending on dateStr
    listDataPoints(  accessToken, 'daily-resting-heart-rate', 5),
    listDataPoints(  accessToken, 'heart-rate-variability',   500),   // many 5-min samples per night
    listDataPoints(  accessToken, 'daily-oxygen-saturation',   5),   // daily computed avg, not raw readings
    listDataPoints(  accessToken, 'daily-respiratory-rate',   5),
    listDataPoints(  accessToken, 'weight',                   3),     // most recent
  ])

  return {
    steps:            parseSteps(stepsData),
    resting_hr:       parseRestingHR(hrData, dateStr),
    hrv:              parseHRV(hrvData, dateStr),
    spo2:             parseSpO2(spo2Data, dateStr),
    respiratory_rate: parseRespRate(respData, dateStr),
    weight_kg:        parseWeight(weightData),
    ...parseSleepForDate(sleepData, dateStr),
  }
}

/**
 * Daytime-only metrics (steps + weight) for finalising a previous day.
 * Used by: overnight cron (finalise yesterday's steps/weight).
 */
async function fetchDaytimeMetrics(accessToken, dateStr) {
  const [stepsData, weightData] = await Promise.all([
    fetchDailyRollup(accessToken, 'steps',  dateStr),
    listDataPoints(  accessToken, 'weight', 3),
  ])
  return {
    steps:    parseSteps(stepsData),
    weight_kg: parseWeight(weightData),
  }
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
    respiratory_rate, spo2, weight_kg,
  } = metrics

  // ── life logs ──────────────────────────────────────────────────────────────
  const { data: logsRow } = await supabase
    .from('user_data').select('value')
    .eq('key', LIFE_LOGS_KEY).eq('user_id', USER_ID).single()

  const logs   = logsRow?.value ?? {}
  const dayLog = { ...(logs[writeDate] ?? {}) }

  const sleepHours = minutesToHoursLabel(sleep_minutes)
  if (sleepHours) {
    const efficiencyPct = (sleep_minutes && in_bed_minutes)
      ? Math.round((sleep_minutes / in_bed_minutes) * 100) : null
    dayLog.sleep = {
      ...(dayLog.sleep ?? {}),
      hours:           sleepHours,
      _fitbit_minutes: sleep_minutes,
      _in_bed_minutes: in_bed_minutes ?? null,
      ...(efficiencyPct != null ? { efficiency_pct: efficiencyPct } : {}),
    }
  }

  if (steps != null) {
    dayLog.exercise = { ...(dayLog.exercise ?? {}), steps }
  }

  logs[writeDate] = dayLog
  const { error: logsErr } = await supabase
    .from('user_data')
    .upsert(
      { key: LIFE_LOGS_KEY, user_id: USER_ID, value: logs, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )
  if (logsErr) throw new Error(`Failed to write logs: ${logsErr.message}`)

  // ── fitbit-raw ─────────────────────────────────────────────────────────────
  const { data: rawRow } = await supabase
    .from('user_data').select('value')
    .eq('key', FITBIT_RAW_KEY).eq('user_id', USER_ID).single()

  const raw   = rawRow?.value ?? {}
  const patch = { synced_at: new Date().toISOString(), source: 'google-health-api' }

  if (steps            != null) patch.steps            = steps
  if (sleep_minutes    != null) patch.sleep_minutes    = sleep_minutes
  if (in_bed_minutes   != null) patch.in_bed_minutes   = in_bed_minutes
  if (resting_hr       != null) patch.resting_hr       = resting_hr
  if (hrv              != null) patch.hrv              = hrv
  if (spo2             != null) patch.spo2             = spo2
  if (respiratory_rate != null) patch.respiratory_rate = respiratory_rate
  if (weight_kg        != null) patch.weight_kg        = weight_kg

  raw[writeDate] = { ...(raw[writeDate] ?? {}), ...patch }
  await supabase
    .from('user_data')
    .upsert(
      { key: FITBIT_RAW_KEY, user_id: USER_ID, value: raw, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )

  return patch
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' })
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
    const [todayMetrics, yesterdaySteps, sleepScoreRaw] = await Promise.all([
      fetchAllMetrics(accessToken, today),
      fetchDaytimeMetrics(accessToken, yesterday),
      listDataPoints(accessToken, 'sleep-score', 3), // probe — check if type exists
    ])
    return res.status(200).json({
      debug: true, today, yesterday,
      today_metrics: todayMetrics,
      yesterday_steps: yesterdaySteps,
      sleep_score_probe: sleepScoreRaw,
    })
  }

  // ── Determine mode ────────────────────────────────────────────────────────
  const manualDate = req.query?.date
  const mode       = req.query?.mode ?? 'overnight'
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
    return res.status(500).json({ error: e.message })
  }

  console.log('[google-health-sync]', mode, results)
  return res.status(200).json({ ok: true, mode, results })
}
