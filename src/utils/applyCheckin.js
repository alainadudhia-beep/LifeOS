import { dbWrite } from '../lib/db'

const LIFE_LOGS_KEY = 'lifetracker-life-logs'

function todayIso() {
  return new Intl.DateTimeFormat('en-CA').format(new Date())
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {} } catch { return {} }
}

function writeJson(key, val) {
  localStorage.setItem(key, JSON.stringify(val))
}

// ── Phase matrix merge ────────────────────────────────────────────────────────

const PHASE_UNION = {
  diet:     new Set(['allergens']),
  health:   new Set(['eczema_location', 'dryness', 'hayfever_symptoms', 'itchy']),
  mood:     new Set(['symptoms']),
  exercise: new Set(['activities']),
  body:     new Set(['gut_symptoms', 'stool']),
}

const PHASE_FIRST_MENTION = {
  diet: new Set(['supplements']),
}

function applyPhaseData(existingPhases, phaseData) {
  if (!phaseData || typeof phaseData !== 'object') return existingPhases
  const phases = { ...existingPhases }

  for (const [phase, modules] of Object.entries(phaseData)) {
    if (!modules || typeof modules !== 'object') continue
    if (!phases[phase]) phases[phase] = {}

    for (const [moduleKey, fields] of Object.entries(modules)) {
      if (!fields || typeof fields !== 'object') continue
      if (!phases[phase][moduleKey]) phases[phase][moduleKey] = {}

      for (const [fieldKey, value] of Object.entries(fields)) {
        if (value === null || value === undefined) continue

        if (PHASE_UNION[moduleKey]?.has(fieldKey)) {
          if (Array.isArray(value) && value.length > 0) {
            const prev = Array.isArray(phases[phase][moduleKey][fieldKey]) ? phases[phase][moduleKey][fieldKey] : []
            phases[phase][moduleKey][fieldKey] = [...new Set([...prev, ...value])]
          }
        } else if (PHASE_FIRST_MENTION[moduleKey]?.has(fieldKey)) {
          if (phases[phase][moduleKey][fieldKey] == null) phases[phase][moduleKey][fieldKey] = value
        } else {
          phases[phase][moduleKey][fieldKey] = value
        }
      }
    }
  }

  return phases
}

// ── Field merge strategies ────────────────────────────────────────────────────

// Mood scores: running average across check-ins
// Stored as: { work: 3.5, _work_sum: 7, _work_n: 2 }
const AVERAGE_FIELDS = {
  mood: new Set(['work', 'life', 'energy', 'focus']),
}

// Ordered categories that accumulate across check-ins (berries at breakfast + broccoli at lunch)
// Maps category → numeric midpoint for arithmetic, then maps back
// Old bucket strings kept for backward compat with legacy stored values
const ADDITIVE_MAPS = {
  diet: {
    fruit_veg: { '1-2': 1.5, '3-4': 3.5, '5+': 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6+': 6 },
    sugar:     { 'None': 0, 'Low': 1, 'Med': 2, 'High': 3 },
    protein:   { 'Low': 1, 'Med': 2, 'High': 3 },
    carbs:     { 'Low': 1, 'Med': 2, 'High': 3 },
    snacking:  { 'Low': 1, 'Med': 2, 'High': 3 },
    fats:      { 'Low': 1, 'Med': 2, 'High': 3 },
  },
  health: {
    itchy_score: { 'None': 0, 'Low': 1, 'Med': 2, 'Bad': 3 },
  },
  water: {
    glasses: { '<3': 1.5, '4-6': 5, '7+': 7, '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8+': 8 },
  },
  alcohol: {
    level: { None: 0, '1-2': 1.5, '3-4': 3.5, '1': 1, '2': 2, '3': 3, '4': 4, '5+': 5 },
  },
}

const ADDITIVE_REVERSE = {
  fruit_veg:   n => n >= 6 ? '6+' : n >= 5 ? '5' : n >= 4 ? '4' : n >= 3 ? '3' : n >= 2 ? '2' : '1',
  glasses:     n => n >= 8 ? '8+' : n <= 0 ? '0' : String(Math.round(n)),
  level:       n => n <= 0 ? 'None' : n >= 5 ? '5+' : String(Math.round(n)),
  sugar:       n => n <= 0 ? 'None' : n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  protein:     n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  carbs:       n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  snacking:    n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  fats:        n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  itchy_score: n => n <= 0 ? 'None' : n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'Bad',
}

// Caffeine is a count string ("0"–"6+") - add numerically
const CAFFEINE_TO_N = { '0':0,'1':1,'2':2,'3':3,'4':4,'4+':4,'5':5,'6+':6 }
const N_TO_CAFFEINE = n => n >= 4 ? '4+' : String(Math.round(n))

function mergeModule(existing, parsed, moduleKey) {
  if (!parsed) return existing
  const out = { ...existing }
  const avgFields    = AVERAGE_FIELDS[moduleKey]
  const additiveCats = ADDITIVE_MAPS[moduleKey]

  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined) continue

    // Arrays: union
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      const prev = Array.isArray(out[k]) ? out[k] : []
      out[k] = [...new Set([...prev, ...v])]
      continue
    }

    // Notes: concatenate
    if (k === 'note' && out[k] && v && out[k] !== v) {
      out[k] = out[k] + ' · ' + v
      continue
    }

    // Mood scores: running average
    if (avgFields?.has(k)) {
      const prevSum   = out[`_${k}_sum`] ?? (out[k] != null ? out[k] : null)
      const prevCount = out[`_${k}_n`]   ?? (out[k] != null ? 1 : 0)
      if (prevSum != null && prevCount > 0) {
        const newSum   = prevSum + v
        const newCount = prevCount + 1
        out[`_${k}_sum`] = newSum
        out[`_${k}_n`]   = newCount
        out[k] = Math.round(newSum / newCount)
      } else {
        out[k]           = v
        out[`_${k}_sum`] = v
        out[`_${k}_n`]   = 1
      }
      continue
    }

    // Steps: add across check-ins
    if (moduleKey === 'exercise' && k === 'steps') {
      out[k] = (out[k] ?? 0) + v
      continue
    }

    // Caffeine count: add
    if (moduleKey === 'diet' && k === 'caffeine') {
      const prev = CAFFEINE_TO_N[out[k]] ?? 0
      const add  = CAFFEINE_TO_N[v]      ?? 0
      out[k] = N_TO_CAFFEINE(prev + add)
      continue
    }

    // Additive ordered categories (fruit_veg, water, alcohol)
    const catMap = additiveCats?.[k]
    if (catMap && ADDITIVE_REVERSE[k]) {
      const prevN = catMap[out[k]] ?? 0
      const addN  = catMap[v]      ?? 0
      out[k] = ADDITIVE_REVERSE[k](prevN + addN)
      continue
    }

    // Default: last non-null wins
    out[k] = v
  }
  return out
}

export function applyCheckin(parsed, rawTranscript = null) {
  const today = parsed.log_date ?? todayIso()
  const logs = readJson(LIFE_LOGS_KEY)
  const todayLog = logs[today] ?? {}

  if (rawTranscript) {
    const existing = todayLog.transcripts ?? []
    todayLog.transcripts = [
      { text: rawTranscript, timestamp: new Date().toISOString() },
      ...existing,
    ]
  }

  const moduleKeys = ['mood', 'health', 'body', 'diet', 'alcohol', 'water', 'exercise', 'sleep', 'social']
  for (const key of moduleKeys) {
    if (parsed[key]) {
      todayLog[key] = mergeModule(todayLog[key] ?? {}, parsed[key], key)
    }
  }

  if (parsed.cycle != null) todayLog.cycle = { period: parsed.cycle }
  if (parsed.gratitude != null) todayLog.gratitude = parsed.gratitude

  // Store timestamped snapshot of this check-in for future time-of-day analysis
  const snapshot = {}
  for (const key of moduleKeys) {
    if (parsed[key] && Object.values(parsed[key]).some(v => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))) {
      snapshot[key] = parsed[key]
    }
  }
  if (Object.keys(snapshot).length) {
    const h = new Date().getHours()
    const phaseFromHour = h >= 7 && h < 11 ? 'morning' : h >= 11 && h < 14 ? 'midday' : h >= 14 && h < 17 ? 'afternoon' : h >= 17 && h < 20 ? 'evening' : h >= 20 || h < 4 ? 'late' : null
    const phase = parsed.day_phase ?? phaseFromHour
    todayLog.checkins = [
      { timestamp: new Date().toISOString(), source: 'voice', ...(phase ? { day_phase: phase } : {}), data: snapshot },
      ...(todayLog.checkins ?? []),
    ]

    // Populate phase matrix — use Claude's phase_data if provided, else synthesise from snapshot + phase
    const phaseDataToApply = parsed.phase_data ?? (phase ? { [phase]: snapshot } : null)
    if (phaseDataToApply) {
      todayLog.phases = applyPhaseData(todayLog.phases ?? {}, phaseDataToApply)
    }
  }

  logs[today] = todayLog
  writeJson(LIFE_LOGS_KEY, logs)
  // Update lwt so useSyncedStorage's Supabase pull doesn't overwrite this write
  localStorage.setItem(`${LIFE_LOGS_KEY}:lwt`, String(Date.now()))
  // Mark pending so next-mount retry fires if the page closes before dbWrite completes
  try {
    const p = JSON.parse(localStorage.getItem('lifetracker-pending-writes') ?? '{}')
    p[LIFE_LOGS_KEY] = true
    localStorage.setItem('lifetracker-pending-writes', JSON.stringify(p))
  } catch {}
  dbWrite(LIFE_LOGS_KEY, logs).then(() => {
    // Clear pending after a successful write so the mount retry can't fire with stale data
    try {
      const p = JSON.parse(localStorage.getItem('lifetracker-pending-writes') ?? '{}')
      delete p[LIFE_LOGS_KEY]
      localStorage.setItem('lifetracker-pending-writes', JSON.stringify(p))
    } catch {}
  })
  window.dispatchEvent(new CustomEvent('lifetracker-logs-updated'))

  return { today, todayLog }
}
