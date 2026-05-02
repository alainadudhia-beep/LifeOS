import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LIFE_LOGS_KEY = 'lifetracker-life-logs'
const FITBIT_RAW_KEY = 'lifetracker-fitbit-raw'

function minutesToHoursLabel(minutes) {
  if (minutes == null) return null
  if (minutes < 300) return '<5'
  if (minutes < 360) return '5'
  if (minutes < 420) return '6'
  if (minutes < 480) return '7'
  if (minutes < 540) return '8'
  return '9+'
}

function mapWorkoutType(type) {
  if (!type) return null
  const t = type.toLowerCase()
  if (t.includes('yoga'))                                        return 'Yoga'
  if (t.includes('pilates'))                                     return 'Pilates'
  if (t.includes('walk'))                                        return 'Long walk'
  if (t.includes('gym') || t.includes('weight') ||
      t.includes('strength') || t.includes('lifting'))          return 'Gym'
  return null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-health-secret')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secret = req.headers['x-health-secret']
  if (!secret || secret !== process.env.HEALTH_IMPORT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const userId = process.env.HEALTH_IMPORT_USER_ID
  if (!userId) return res.status(500).json({ error: 'Server misconfigured: missing HEALTH_IMPORT_USER_ID' })

  // Accept JSON object, JSON string, Buffer, or form-encoded string
  let body = req.body
  if (Buffer.isBuffer(body)) {
    try { body = JSON.parse(body.toString()) } catch { body = {} }
  } else if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {
      try { body = Object.fromEntries(new URLSearchParams(body)) } catch { body = {} }
    }
  }
  if (!body) body = {}

  const num = (v) => (v == null || v === '' ? null : Number(v))

  const date               = body.date
  const steps              = num(body.steps)
  const active_energy_kcal = num(body.active_energy_kcal)
  const exercise_minutes   = num(body.exercise_minutes)
  const workouts           = body.workouts ?? null
  const sleep_minutes      = num(body.sleep_minutes)
  const in_bed_minutes     = num(body.in_bed_minutes)
  const resting_hr         = num(body.resting_hr)
  const hrv                = num(body.hrv)
  const respiratory_rate   = num(body.respiratory_rate)
  const spo2               = num(body.spo2)
  const skin_temp_deviation = num(body.skin_temp_deviation)
  const weight_kg          = num(body.weight_kg)

  if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' })

  // Read current life logs
  const { data: logsRow } = await supabase
    .from('user_data')
    .select('value')
    .eq('key', LIFE_LOGS_KEY)
    .eq('user_id', userId)
    .single()

  const logs = logsRow?.value ?? {}
  const dayLog = { ...(logs[date] ?? {}) }

  // Sleep — Fitbit authoritative on duration and efficiency
  const sleepHours = minutesToHoursLabel(sleep_minutes)
  if (sleepHours) {
    const efficiencyPct = (sleep_minutes && in_bed_minutes)
      ? Math.round((sleep_minutes / in_bed_minutes) * 100)
      : null
    dayLog.sleep = {
      ...(dayLog.sleep ?? {}),
      hours: sleepHours,
      _fitbit_minutes: sleep_minutes,
      _in_bed_minutes: in_bed_minutes ?? null,
      ...(efficiencyPct != null ? { efficiency_pct: efficiencyPct } : {}),
    }
  }

  // Steps — Fitbit authoritative (exact count, no bucketing)
  if (steps != null) {
    dayLog.exercise = {
      ...(dayLog.exercise ?? {}),
      steps,
    }
  }

  // Workouts — add without duplicating existing entries
  if (workouts?.length) {
    const existing = dayLog.exercise?.activities ?? []
    const toAdd = workouts
      .map(w => mapWorkoutType(w.type))
      .filter(Boolean)
      .filter(a => !existing.includes(a))
    if (toAdd.length) {
      dayLog.exercise = {
        ...(dayLog.exercise ?? {}),
        activities: [...existing, ...toAdd],
      }
    }
  }

  // Write updated life logs
  logs[date] = dayLog
  const { error: logsError } = await supabase
    .from('user_data')
    .upsert(
      { key: LIFE_LOGS_KEY, user_id: userId, value: logs, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )
  if (logsError) return res.status(500).json({ error: 'Failed to write logs', detail: logsError.message })

  // Store full raw Fitbit values — used for future analytics UI
  const { data: rawRow } = await supabase
    .from('user_data')
    .select('value')
    .eq('key', FITBIT_RAW_KEY)
    .eq('user_id', userId)
    .single()

  const raw = rawRow?.value ?? {}
  raw[date] = {
    ...(raw[date] ?? {}),
    steps,
    active_energy_kcal,
    exercise_minutes,
    sleep_minutes,
    in_bed_minutes,
    resting_hr,
    hrv,
    respiratory_rate,
    spo2,
    skin_temp_deviation,
    weight_kg,
    workouts,
    synced_at: new Date().toISOString(),
  }
  await supabase
    .from('user_data')
    .upsert(
      { key: FITBIT_RAW_KEY, user_id: userId, value: raw, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )

  return res.status(200).json({
    ok: true,
    date,
    applied: {
      sleep_hours: sleepHours ?? null,
      steps: steps ?? null,
    },
  })
}
