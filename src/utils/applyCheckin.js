import { dbWrite } from '../lib/db'

const LIFE_LOGS_KEY = 'lifetracker-life-logs'
const TRACKS_KEY    = 'lifetracker-tracks-v3'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {} } catch { return {} }
}

function writeJson(key, val) {
  localStorage.setItem(key, JSON.stringify(val))
}

// ── Field merge strategies ────────────────────────────────────────────────────

// Mood scores: running average across check-ins
// Stored as: { work: 3.5, _work_sum: 7, _work_n: 2 }
const AVERAGE_FIELDS = {
  mood: new Set(['work', 'life', 'energy', 'focus']),
}

// Ordered categories that accumulate across check-ins (berries at breakfast + broccoli at lunch)
// Maps category → numeric midpoint for arithmetic, then maps back
const ADDITIVE_MAPS = {
  diet: {
    fruit_veg: { '1-2': 1.5, '3-4': 3.5, '5+': 6 },
    sugar:     { 'None': 0, 'Low': 1, 'Med': 2, 'High': 3 },
    protein:   { 'Low': 1, 'Med': 2, 'High': 3 },
    carbs:     { 'Low': 1, 'Med': 2, 'High': 3 },
    snacking:  { 'Low': 1, 'Med': 2, 'High': 3 },
  },
  water: {
    glasses: { '<3': 1.5, '4-6': 5, '7+': 8 },
  },
  alcohol: {
    level: { None: 0, '1-2': 1.5, '3-4': 3.5, '5+': 6 },
  },
}

const ADDITIVE_REVERSE = {
  fruit_veg: n => n >= 5 ? '5+' : n >= 3 ? '3-4' : '1-2',
  glasses:   n => n >= 7 ? '7+' : n >= 4 ? '4-6' : '<3',
  level:     n => n === 0 ? 'None' : n >= 5 ? '5+' : n >= 3 ? '3-4' : '1-2',
  sugar:     n => n <= 0 ? 'None' : n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  protein:   n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  carbs:     n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  snacking:  n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
}

// Caffeine is a count string ("0"–"6+") - add numerically
const CAFFEINE_TO_N = { '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6+':6 }
const N_TO_CAFFEINE = n => n >= 6 ? '6+' : String(Math.round(n))

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

export function applyCheckin(parsed, rawTranscript = null, onTracksUpdated) {
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

  const moduleKeys = ['mood', 'health', 'diet', 'alcohol', 'water', 'exercise', 'sleep', 'social']
  for (const key of moduleKeys) {
    if (parsed[key]) {
      todayLog[key] = mergeModule(todayLog[key] ?? {}, parsed[key], key)
    }
  }

  if (parsed.cycle != null) todayLog.cycle = { period: parsed.cycle }
  if (parsed.gratitude != null) todayLog.gratitude = parsed.gratitude

  logs[today] = todayLog
  writeJson(LIFE_LOGS_KEY, logs)
  dbWrite(LIFE_LOGS_KEY, logs)
  window.dispatchEvent(new CustomEvent('lifetracker-logs-updated'))

  // Apply career track updates + new track creation
  if (parsed.career_updates?.length || parsed.new_tracks?.length) {
    const tracks = readJson(TRACKS_KEY)
    const tracksArr = Array.isArray(tracks) ? tracks : Object.values(tracks)
    let changed = false

    // Create new tracks
    for (const nt of (parsed.new_tracks ?? [])) {
      if (!nt.name) continue
      const status = nt.status || 'in_progress'
      const id = `track-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const newTrack = {
        id,
        name: nt.name,
        group: nt.group ?? null,
        priority: null,
        start_date: today,
        end_date: '2026-09-01',
        status_history: [{ id: `sh-${id}-1`, status, start_date: today, end_date: null }],
        milestones: [],
        notes_log: nt.note
          ? [{ id: `n-${Date.now()}`, text: nt.note.replace(/—/g, '-').replace(/–/g, '-'), timestamp: new Date().toISOString() }]
          : [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      tracksArr.push(newTrack)
      changed = true
    }

    for (const update of parsed.career_updates ?? []) {
      const match = tracksArr.find(t =>
        t.name?.toLowerCase().includes(update.track_name?.toLowerCase())
      )
      if (!match) continue
      if (update.status) {
        const hist = match.status_history || []
        const closed = hist.map((seg, i) =>
          i === hist.length - 1 && seg.end_date === null ? { ...seg, end_date: today } : seg
        )
        const newSeg = { id: `sh-${match.id}-${Date.now()}`, status: update.status, start_date: today, end_date: null }
        match.status_history = [...closed, newSeg]
        match.updated_at = new Date().toISOString()
      }
      if (update.note) {
        const noteText = update.note.replace(/—/g, '-').replace(/–/g, '-')
        match.notes_log = [
          { id: Date.now() + Math.random(), text: noteText, timestamp: new Date().toISOString() },
          ...(match.notes_log ?? []),
        ]
      }
      changed = true
    }

    if (changed) {
      if (Array.isArray(tracks)) {
        writeJson(TRACKS_KEY, tracksArr)
        dbWrite(TRACKS_KEY, tracksArr)
      } else {
        const updated = {}
        for (const t of tracksArr) updated[t.id] = t
        writeJson(TRACKS_KEY, updated)
        dbWrite(TRACKS_KEY, updated)
      }
      window.dispatchEvent(new CustomEvent('lifetracker-tracks-updated'))
      onTracksUpdated?.()
    }
  }

  return { today, todayLog }
}
