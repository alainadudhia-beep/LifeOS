/**
 * Google Health API sync.
 *
 * Two modes, both triggered by Vercel cron:
 *
 *   overnight  (00:30 UTC)
 *     → fetches everything from yesterday, writes to yesterday
 *     → final, authoritative record for the previous day
 *
 *   daytime  (9am / 12pm / 3pm / 6pm / 10pm UTC)
 *     → writes to TODAY using a split fetch:
 *         sleep / HRV / resting HR / resp rate  ← yesterday's window (overnight metrics)
 *         steps / active energy / HR / SpO2      ← today's running totals
 *         weight                                  ← most recent in last 7 days
 *     → the 9am run also re-finalises yesterday (catches anything that
 *       finalized after the overnight run)
 *
 * Can also be triggered manually:
 *   POST /api/google-health-sync                 (x-health-secret header)
 *   GET  /api/google-health-sync?date=YYYY-MM-DD (manual backfill, overnight mode)
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

// ── Google Health API fetch helpers ─────────────────────────────────────────

async function fetchDailyRollup(accessToken, dataType, startTime, endTime) {
  const res = await fetch(`${BASE_URL}/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startTime, endTime }),
  })
  if (!res.ok) {
    console.error(`[google-health-sync] ${dataType} rollup ${res.status}:`, await res.text())
    return null
  }
  return res.json()
}

async function fetchDataPoints(accessToken, dataType, startTime, endTime) {
  const params = new URLSearchParams({ startTime, endTime })
  const res = await fetch(`${BASE_URL}/dataTypes/${dataType}/dataPoints:list?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    console.error(`[google-health-sync] ${dataType} list ${res.status}:`, await res.text())
    return null
  }
  return res.json()
}

// ── Value extractors ─────────────────────────────────────────────────────────

// Pull a single numeric value from a daily rollup response.
// TODO: verify exact response shape during Phase 6 testing — adjust field path if null.
function rollupValue(data) {
  const point = data?.dataPoints?.[0]
  if (!point) return null
  return point.value?.fpVal ?? point.value?.intVal ?? null
}

function minutesToHoursLabel(minutes) {
  if (minutes == null) return null
  if (minutes < 270) return '<5'
  if (minutes < 330) return '5'
  if (minutes < 390) return '6'
  if (minutes < 450) return '7'
  if (minutes < 510) return '8'
  return '9+'
}

// ── Sleep mapping ────────────────────────────────────────────────────────────

// Google Health sleep sessions have a sleepStage field.
// TODO: verify these stage names against actual Fitbit data via Google Health.
// Known values include: SLEEP_AWAKE, SLEEP_LIGHT, SLEEP_DEEP, SLEEP_REM, SLEEP_OUT_OF_BED
function parseSleep(sleepData) {
  const points = sleepData?.dataPoints
  if (!points?.length) return { sleep_minutes: null, in_bed_minutes: null }

  const AWAKE_STAGES = new Set(['SLEEP_AWAKE', 'SLEEP_OUT_OF_BED'])
  let asleepMs = 0
  let inBedMs  = 0

  for (const p of points) {
    const dur = new Date(p.endTime).getTime() - new Date(p.startTime).getTime()
    if (!AWAKE_STAGES.has(p.sleepStage)) asleepMs += dur
    inBedMs += dur
  }

  return {
    sleep_minutes:  asleepMs > 0 ? Math.round(asleepMs / 60000) : null,
    in_bed_minutes: inBedMs  > 0 ? Math.round(inBedMs  / 60000) : null,
  }
}

// ── Fetch helpers by category ─────────────────────────────────────────────────

/**
 * OVERNIGHT METRICS — sleep, HRV, resting HR, SpO2, respiratory rate.
 * These are derived from the PREVIOUS night's data, so we always fetch
 * from the "night before" window (yesterdayDate) and write to writeDate (today).
 *
 * The overnight cron does NOT call this — it only finalises daytime metrics
 * (steps/calories/weight). This prevents the overnight cron from overwriting
 * sleep data that was already correctly written by the 08:00 daytime sync.
 */
async function fetchOvernightMetrics(accessToken, yesterdayDate) {
  const startTime = `${yesterdayDate}T00:00:00Z`
  const endTime   = `${yesterdayDate}T23:59:59Z`

  const [sleepData, hrData, hrvData, respData, spo2Data] = await Promise.all([
    fetchDataPoints( accessToken, 'sleep',                        startTime, endTime),
    fetchDailyRollup(accessToken, 'heart-rate',                   startTime, endTime), // resting HR
    fetchDailyRollup(accessToken, 'daily-heart-rate-variability', startTime, endTime),
    fetchDailyRollup(accessToken, 'daily-respiratory-rate',       startTime, endTime),
    fetchDailyRollup(accessToken, 'daily-oxygen-saturation',      startTime, endTime),
  ])

  const { sleep_minutes, in_bed_minutes } = parseSleep(sleepData)

  return {
    sleep_minutes,
    in_bed_minutes,
    resting_hr:       rollupValue(hrData),
    hrv:              rollupValue(hrvData),
    respiratory_rate: rollupValue(respData),
    spo2:             rollupValue(spo2Data),
  }
}

/**
 * DAYTIME METRICS — steps, calories, weight.
 * These accumulate or update during the day, so we fetch from the current
 * day's window. Also used by the overnight cron to finalise the previous day.
 * Does NOT include sleep/HRV/resting HR/SpO2/resp — those are overnight-only.
 */
async function fetchDaytimeMetrics(accessToken, date) {
  const startTime = `${date}T00:00:00Z`
  const endTime   = `${date}T23:59:59Z`

  // Weight looks back 7 days to catch the most recent reading regardless of date
  const weightStart = (() => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7)
    return d.toISOString()
  })()

  const [stepsData, activeEnergyData, restingEnergyData, weightData] = await Promise.all([
    fetchDailyRollup(accessToken, 'steps',                startTime, endTime),
    fetchDailyRollup(accessToken, 'active-energy-burned', startTime, endTime),
    fetchDailyRollup(accessToken, 'basal-metabolic-rate', startTime, endTime), // resting/BMR energy
    fetchDataPoints( accessToken, 'weight',               weightStart, endTime),
  ])

  return {
    steps:               rollupValue(stepsData),
    active_energy_kcal:  rollupValue(activeEnergyData),
    resting_energy_kcal: rollupValue(restingEnergyData),
    // Weight: most recent point in window
    // TODO: verify unit — may need to confirm value is in kg not lbs
    weight_kg:           weightData?.dataPoints?.[0]?.value?.fpVal ?? null,
  }
}

// ── Supabase write ────────────────────────────────────────────────────────────

async function writeToSupabase(writeDate, metrics) {
  const {
    steps, sleep_minutes, in_bed_minutes, resting_hr, hrv,
    respiratory_rate, spo2, active_energy_kcal, resting_energy_kcal, weight_kg,
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

  if (steps               != null) patch.steps               = steps
  if (sleep_minutes       != null) patch.sleep_minutes       = sleep_minutes
  if (in_bed_minutes      != null) patch.in_bed_minutes      = in_bed_minutes
  if (resting_hr          != null) patch.resting_hr          = resting_hr
  if (hrv                 != null) patch.hrv                 = hrv
  if (spo2                != null) patch.spo2                = spo2
  if (respiratory_rate    != null) patch.respiratory_rate    = respiratory_rate
  if (active_energy_kcal  != null) patch.active_energy_kcal  = active_energy_kcal
  if (resting_energy_kcal != null) patch.resting_energy_kcal = resting_energy_kcal
  if (weight_kg           != null) patch.weight_kg           = weight_kg

  raw[writeDate] = { ...(raw[writeDate] ?? {}), ...patch }
  await supabase
    .from('user_data')
    .upsert(
      { key: FITBIT_RAW_KEY, user_id: USER_ID, value: raw, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )

  return patch
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function utcDateString(offsetDays = 0) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
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

  // ── Debug mode: return raw API responses without writing to Supabase ─────
  if (req.query?.debug === 'true') {
    const yesterday = utcDateString(-1)
    const today     = utcDateString(0)
    const startYesterday = `${yesterday}T00:00:00Z`
    const endYesterday   = `${yesterday}T23:59:59Z`
    const startToday     = `${today}T00:00:00Z`
    const endToday       = `${today}T23:59:59Z`
    const weightStart    = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString() })()

    const [sleep, hr, hrv, resp, spo2, steps, activeEnergy, restingEnergy, weight] = await Promise.all([
      fetchDataPoints( accessToken, 'sleep',                        startYesterday, endYesterday),
      fetchDailyRollup(accessToken, 'heart-rate',                   startYesterday, endYesterday),
      fetchDailyRollup(accessToken, 'daily-heart-rate-variability', startYesterday, endYesterday),
      fetchDailyRollup(accessToken, 'daily-respiratory-rate',       startYesterday, endYesterday),
      fetchDailyRollup(accessToken, 'daily-oxygen-saturation',      startYesterday, endYesterday),
      fetchDailyRollup(accessToken, 'steps',                        startToday,     endToday),
      fetchDailyRollup(accessToken, 'active-energy-burned',         startToday,     endToday),
      fetchDailyRollup(accessToken, 'basal-metabolic-rate',         startToday,     endToday),
      fetchDataPoints( accessToken, 'weight',                       weightStart,    endToday),
    ])

    return res.status(200).json({
      debug: true,
      dates: { yesterday, today },
      raw: { sleep, hr, hrv, resp, spo2, steps, activeEnergy, restingEnergy, weight },
    })
  }

  // ── Determine mode ────────────────────────────────────────────────────────
  // Manual backfill: ?date=YYYY-MM-DD always runs overnight (single-date) mode
  const manualDate = req.query?.date
  const mode       = req.query?.mode ?? 'overnight'
  const results    = {}

  try {
    if (manualDate || mode === 'overnight') {
      // ── Overnight cron (00:30 UTC) / manual backfill ──────────────────────
      // Finalises steps, calories, weight for yesterday ONLY.
      // Does NOT touch sleep/HRV/resting HR/SpO2/resp — those were correctly
      // written by the previous day's 08:00 daytime sync and must not be overwritten.
      const targetDate = manualDate ?? utcDateString(-1) // default: yesterday
      const patch = await writeToSupabase(targetDate, await fetchDaytimeMetrics(accessToken, targetDate))
      results[targetDate] = patch

    } else {
      // ── Daytime crons (08:00 / 11:00 / 14:00 / 17:00 / 21:00 UTC) ────────
      // Split fetch: overnight metrics from yesterday's window (last night's
      // sleep/HRV/etc), daytime metrics from today's window (running steps/calories).
      // Both are written to TODAY's date.
      // The 08:00 run also re-finalises yesterday's daytime metrics (in case
      // steps/calories weren't complete when the 00:30 overnight ran).
      const today     = utcDateString(0)
      const yesterday = utcDateString(-1)

      const utcHour = new Date().getUTCHours()
      const isFirstDaytimeRun = utcHour >= 8 && utcHour < 10 // 08:00 UTC window

      const [overnightMetrics, todayDaytime, yesterdayDaytime] = await Promise.all([
        fetchOvernightMetrics(accessToken, yesterday), // sleep/HRV/etc from last night → write to today
        fetchDaytimeMetrics(accessToken, today),       // steps/calories so far today → write to today
        isFirstDaytimeRun
          ? fetchDaytimeMetrics(accessToken, yesterday) // re-finalise yesterday's steps/calories
          : Promise.resolve(null),
      ])

      // Write today: last night's sleep/HRV + today's running steps/calories
      results[today] = await writeToSupabase(today, { ...overnightMetrics, ...todayDaytime })

      // Re-finalise yesterday's daytime metrics at 08:00 only
      if (yesterdayDaytime) {
        results[yesterday] = await writeToSupabase(yesterday, yesterdayDaytime)
      }
    }
  } catch (e) {
    console.error('[google-health-sync] Write error:', e)
    return res.status(500).json({ error: e.message })
  }

  console.log('[google-health-sync]', mode, results)
  return res.status(200).json({ ok: true, mode, results })
}
