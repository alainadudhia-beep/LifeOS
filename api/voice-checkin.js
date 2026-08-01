import { createClient } from '@supabase/supabase-js'
import { CHECKIN_SYSTEM_PROMPT } from '../src/utils/checkinPrompt.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LIFE_LOGS_KEY = 'lifetracker-life-logs'
const TRACKS_KEY    = 'lifetracker-tracks-v3'
const WEATHER_KEY   = 'lifetracker-weather'

// ── System prompt — single source of truth in src/utils/checkinPrompt.js ──────
// Edit that file to update; changes apply to both desktop and Shortcut.

const SYSTEM_PROMPT = CHECKIN_SYSTEM_PROMPT

// ── Merge logic (mirrors applyCheckin.js — no browser APIs) ──────────────────

const AVERAGE_FIELDS = {
  mood: new Set(['work', 'life', 'energy', 'focus']),
}

const ADDITIVE_MAPS = {
  diet: {
    fruit_veg: { '1-2': 1.5, '3-4': 3.5, '5+': 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6+': 6 },
    sugar:     { 'None': 0, 'Low': 1, 'Med': 2, 'High': 3 },
    protein:   { 'Low': 1, 'Med': 2, 'High': 3 },
    carbs:     { 'Low': 1, 'Med': 2, 'High': 3 },
    snacking:  { 'Low': 1, 'Med': 2, 'High': 3 },
    fats:      { 'Low': 1, 'Med': 2, 'High': 3 },
  },
  water: {
    glasses: { '<3': 1.5, '4-6': 5, '7+': 8, '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8+': 8 },
  },
  alcohol: {
    level: { None: 0, '1-2': 1.5, '3-4': 3.5, '1': 1, '2': 2, '3': 3, '4': 4, '5+': 5 },
  },
}

const ADDITIVE_REVERSE = {
  fruit_veg: n => n >= 6 ? '6+' : n >= 5 ? '5' : n >= 4 ? '4' : n >= 3 ? '3' : n >= 2 ? '2' : '1',
  glasses:   n => n >= 8 ? '8+' : n <= 0 ? '0' : String(Math.round(n)),
  level:     n => n <= 0 ? 'None' : n >= 5 ? '5+' : String(Math.round(n)),
  sugar:     n => n <= 0 ? 'None' : n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  protein:   n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  carbs:     n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  snacking:  n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
  fats:      n => n <= 1.5 ? 'Low' : n <= 2.5 ? 'Med' : 'High',
}

const CAFFEINE_TO_N = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '4+': 4, '5': 5, '6+': 6 }
const N_TO_CAFFEINE = n => n >= 4 ? '4+' : String(Math.round(n))

function mergeModule(existing, parsed, moduleKey) {
  if (!parsed) return existing
  const out = { ...existing }
  const avgFields    = AVERAGE_FIELDS[moduleKey]
  const additiveCats = ADDITIVE_MAPS[moduleKey]

  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined) continue

    if (Array.isArray(v)) {
      if (v.length === 0) continue
      const prev = Array.isArray(out[k]) ? out[k] : []
      out[k] = [...new Set([...prev, ...v])]
      continue
    }

    if (k === 'note' && out[k] && v && out[k] !== v) {
      out[k] = out[k] + ' · ' + v
      continue
    }

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

    if (moduleKey === 'exercise' && k === 'steps') {
      out[k] = (out[k] ?? 0) + v
      continue
    }

    if (moduleKey === 'diet' && k === 'caffeine') {
      const prev = CAFFEINE_TO_N[out[k]] ?? 0
      const add  = CAFFEINE_TO_N[v]      ?? 0
      out[k] = N_TO_CAFFEINE(prev + add)
      continue
    }

    const catMap = additiveCats?.[k]
    if (catMap && ADDITIVE_REVERSE[k]) {
      const prevN = catMap[out[k]] ?? 0
      const addN  = catMap[v]      ?? 0
      out[k] = ADDITIVE_REVERSE[k](prevN + addN)
      continue
    }

    out[k] = v
  }
  return out
}

// ── Context builder (server-side; reads from Supabase data) ──────────────────

function windLabel(kmh) {
  if (kmh == null) return null
  if (kmh < 15) return 'Low wind'
  if (kmh < 35) return 'Moderate wind'
  return 'Strong wind'
}

function formatWeatherContext(w) {
  if (!w) return null
  const parts = []
  if (w.location)                 parts.push(`Location: ${w.location}`)
  if (w.temp_max != null)         parts.push(`${Math.round(w.temp_max)}°C max / ${Math.round(w.temp_min)}°C min`)
  if (w.precipitation_mm != null) parts.push(`rain: ${w.precipitation_mm}mm`)
  const wl = windLabel(w.wind_speed_max)
  if (wl)                         parts.push(wl)
  if (w.uv_index != null)         parts.push(`UV: ${w.uv_index.toFixed(1)}`)
  if (w.grass_pollen_label)       parts.push(`grass pollen: ${w.grass_pollen_label}`)
  if (w.birch_pollen_label && w.birch_pollen > 0) parts.push(`birch pollen: ${w.birch_pollen_label}`)
  if (w.aqi_label)                parts.push(`AQI: ${w.aqi_label}`)
  return parts.join(', ')
}

function buildContext(today, logs, tracksArr, weatherStore = {}) {
  const lines = []

  // Today's weather
  const todayWeather = formatWeatherContext(weatherStore[today])
  if (todayWeather) lines.push(`Today's environment: ${todayWeather}`)

  const todayLog = logs[today]
  if (todayLog) {
    const parts = []
    if (todayLog.water?.glasses != null) parts.push(`water: ${todayLog.water.glasses} glasses`)
    if (todayLog.diet) {
      const d = todayLog.diet
      const dp = []
      if (d.fruit_veg) dp.push(`fruit/veg: ${d.fruit_veg}`)
      if (d.protein)   dp.push(`protein: ${d.protein}`)
      if (d.sugar)     dp.push(`sugar: ${d.sugar}`)
      if (d.caffeine)  dp.push(`caffeine: ${d.caffeine}`)
      if (dp.length)   parts.push(`diet: ${dp.join(', ')}`)
    }
    if (todayLog.exercise?.activities?.length) parts.push(`exercise: ${todayLog.exercise.activities.join(', ')}`)
    if (todayLog.mood) {
      const scores = ['work', 'life', 'energy', 'focus'].filter(k => todayLog.mood[k] != null).map(k => `${k}=${todayLog.mood[k]}`)
      if (scores.length) parts.push(`mood: ${scores.join(', ')}`)
    }
    if (todayLog.sleep?.hours) parts.push(`sleep: ${todayLog.sleep.hours}hrs`)
    if (parts.length) lines.push('Logged today so far: ' + parts.join(' | '))
  }

  const recentDays = []
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const log = logs[iso]
    if (!log) continue
    const parts = []
    if (log.exercise?.activities?.length) parts.push(`exercise: ${log.exercise.activities.join(', ')}`)
    if (log.mood) {
      const scores = ['work', 'life', 'energy', 'focus'].filter(k => log.mood[k] != null).map(k => `${k}=${log.mood[k]}`)
      if (scores.length) parts.push(`mood: ${scores.join(', ')}`)
    }
    if (log.sleep?.hours) parts.push(`sleep: ${log.sleep.hours}hrs${log.sleep.quality ? ' ' + log.sleep.quality : ''}`)
    if (log.health?.eczema && log.health.eczema !== 'None') parts.push(`eczema: ${log.health.eczema}`)
    if (parts.length) recentDays.push(`  ${iso}: ${parts.join(' | ')}`)
  }
  if (recentDays.length) {
    lines.push('Recent life logs (last 7 days):')
    lines.push(...recentDays)
  }

  const activeTracks = tracksArr.filter(t => {
    if (t.archived) return false
    const status = t.status_history?.length
      ? t.status_history[t.status_history.length - 1].status
      : t.status
    return status && status !== 'closed' && status !== 'secured'
  })
  if (activeTracks.length) {
    lines.push('\nActive career tracks:')
    for (const t of activeTracks) {
      const status = t.status_history?.length
        ? t.status_history[t.status_history.length - 1].status
        : t.status
      const lastNote = t.notes_log?.[0]?.text
      const upcoming = (t.milestones ?? [])
        .filter(m => m.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 2)
        .map(m => `${m.label} on ${m.date}`)
        .join(', ')
      lines.push(`  "${t.name}" - status: ${status}${lastNote ? ` | last note: "${lastNote.slice(0, 80)}"` : ''}${upcoming ? ` | upcoming: ${upcoming}` : ''}`)
    }
  }

  return lines.length ? '\n\n' + lines.join('\n') : ''
}

// ── Claude API call ───────────────────────────────────────────────────────────

async function callClaude(transcript, dynamicContext) {
  const apiKey = process.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicContext },
      ],
      messages: [{ role: 'user', content: transcript }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const stopReason = data.stop_reason
  const usage = data.usage
  let text = data.content[0].text.trim()

  // Strip markdown fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  // Robustly extract the outermost JSON object — handles any trailing text
  // Claude sometimes appends explanatory notes after the closing brace on complex entries
  const firstBrace = text.indexOf('{')
  if (firstBrace !== -1) {
    let depth = 0
    let end = -1
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end !== -1) text = text.slice(firstBrace, end + 1)
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(
      `stop=${stopReason} out=${usage?.output_tokens} err=${e.message} TAIL:${text.slice(-400)}`
    )
  }
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

// ── Day phase helpers ─────────────────────────────────────────────────────────

function ukHour() {
  const now = new Date()
  const m = now.getUTCMonth() // 0-indexed; BST = last Sun Mar → last Sun Oct
  const offset = (m >= 2 && m <= 9) ? 1 : 0
  return (now.getUTCHours() + offset) % 24
}

function phaseFromHour(h) {
  if (h >= 7  && h < 11) return 'morning'
  if (h >= 11 && h < 14) return 'midday'
  if (h >= 14 && h < 17) return 'afternoon'
  if (h >= 17 && h < 20) return 'evening'
  if (h >= 20 || h < 4)  return 'late'
  return null
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-checkin-secret')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secret = req.headers['x-checkin-secret']
  if (!secret || secret !== process.env.CHECKIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const userId = process.env.HEALTH_IMPORT_USER_ID
  if (!userId) return res.status(500).json({ error: 'Server misconfigured: missing HEALTH_IMPORT_USER_ID' })

  let body = req.body
  if (Buffer.isBuffer(body)) {
    try { body = JSON.parse(body.toString()) } catch { body = {} }
  } else if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  if (!body) body = {}

  const transcript = body.transcript
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
  const date = (typeof body.date === 'string' && ISO_DATE.test(body.date))
    ? body.date
    : new Intl.DateTimeFormat('en-CA').format(new Date())

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    return res.status(400).json({ error: 'transcript required' })
  }

  // Read logs, tracks, insights, and weather in parallel
  const [logsRow, tracksRow, insightsRow, weatherRow] = await Promise.all([
    supabase.from('user_data').select('value').eq('key', LIFE_LOGS_KEY).eq('user_id', userId).single(),
    supabase.from('user_data').select('value').eq('key', TRACKS_KEY).eq('user_id', userId).single(),
    supabase.from('user_data').select('value').eq('key', 'lifetracker-insights').eq('user_id', userId).single(),
    supabase.from('user_data').select('value').eq('key', WEATHER_KEY).eq('user_id', userId).single(),
  ])

  const logs          = logsRow.data?.value ?? {}
  const tracksRaw     = tracksRow.data?.value ?? {}
  const tracksArr     = Array.isArray(tracksRaw) ? tracksRaw : Object.values(tracksRaw)
  const insightsStore = insightsRow.data?.value ?? {}
  const weatherStore  = weatherRow.data?.value ?? {}

  const trackNames     = tracksArr.map(t => t.name).filter(Boolean)
  const dynamicContext = (trackNames.length ? `\n\nKnown career tracks: ${trackNames.join(', ')}` : '')
    + buildContext(date, logs, tracksArr, weatherStore)

  // Parse transcript with Claude (static system prompt is cached server-side)
  let parsed
  try {
    parsed = await callClaude(transcript, dynamicContext)
  } catch (err) {
    return res.status(500).json({ error: 'Parse failed', detail: err.message })
  }

  const today = (typeof parsed.log_date === 'string' && ISO_DATE.test(parsed.log_date))
    ? parsed.log_date
    : date
  const todayLog = { ...(logs[today] ?? {}) }

  // Store raw transcript
  const existing = todayLog.transcripts ?? []
  todayLog.transcripts = [
    { text: transcript, timestamp: new Date().toISOString() },
    ...existing,
  ]

  // Merge life modules
  const moduleKeys = ['mood', 'health', 'body', 'diet', 'alcohol', 'water', 'exercise', 'sleep', 'social']
  for (const key of moduleKeys) {
    if (parsed[key]) {
      todayLog[key] = mergeModule(todayLog[key] ?? {}, parsed[key], key)
    }
  }

  if (parsed.cycle != null)    todayLog.cycle    = { period: parsed.cycle }
  if (parsed.gratitude != null) todayLog.gratitude = parsed.gratitude

  // Store timestamped snapshot for future time-of-day analysis
  const snapshot = {}
  for (const key of moduleKeys) {
    if (parsed[key] && Object.values(parsed[key]).some(v => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))) {
      snapshot[key] = parsed[key]
    }
  }
  if (Object.keys(snapshot).length) {
    const phase = (parsed.day_phase ?? phaseFromHour(ukHour())) ?? undefined
    todayLog.checkins = [
      { timestamp: new Date().toISOString(), source: 'shortcut', ...(phase ? { day_phase: phase } : {}), data: snapshot },
      ...(todayLog.checkins ?? []),
    ]

    // Populate phase matrix
    const phaseDataToApply = parsed.phase_data ?? (phase ? { [phase]: snapshot } : null)
    if (phaseDataToApply) {
      todayLog.phases = applyPhaseData(todayLog.phases ?? {}, phaseDataToApply)
    }
  }

  // Write logs + insights in parallel
  logs[today] = todayLog
  const writes = [
    supabase.from('user_data').upsert(
      { key: LIFE_LOGS_KEY, user_id: userId, value: logs, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    ),
  ]

  if (parsed.insights?.length) {
    // Client stores insights as a flat array of items with type/id/created_at.
    // Read existing array, purge stale claude items from today, append new ones.
    const existingItems = Array.isArray(insightsStore) ? insightsStore : []
    const todayStr      = new Date().toISOString().slice(0, 10)
    const kept          = existingItems.filter(it => it.type !== 'claude' || (it.created_at ?? '').slice(0, 10) !== todayStr)
    const newItems      = parsed.insights.map(ins => ({
      id:           `ins-claude-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type:         'claude',
      text:         ins.text.replace(/—/g, '-').trim(),
      positive:     ins.positive  ?? false,
      actionable:   ins.actionable ?? false,
      completed:    false,
      completed_at: null,
      created_at:   new Date().toISOString(),
    }))
    writes.push(
      supabase.from('user_data').upsert(
        { key: 'lifetracker-insights', user_id: userId, value: [...kept, ...newItems], updated_at: new Date().toISOString() },
        { onConflict: 'key,user_id' }
      )
    )
  }

  const [logsResult] = await Promise.all(writes)
  if (logsResult.error) return res.status(500).json({ error: 'Failed to write logs', detail: logsResult.error.message })

  // Apply career track updates
  if (parsed.career_updates?.length || parsed.new_tracks?.length) {
    let changed = false

    for (const nt of (parsed.new_tracks ?? [])) {
      if (!nt.name) continue
      const status = nt.status || 'in_progress'
      const id = `track-${Date.now()}-${Math.random().toString(36).slice(2)}`
      tracksArr.push({
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
      })
      changed = true
    }

    for (const update of (parsed.career_updates ?? [])) {
      const match = tracksArr.find(t =>
        t.name?.toLowerCase().includes(update.track_name?.toLowerCase())
      )
      if (!match) continue
      if (update.status) {
        const hist = match.status_history || []
        const openSeg = hist.length ? hist[hist.length - 1] : null
        const alreadySame = openSeg && !openSeg.end_date && openSeg.status === update.status
        if (!alreadySame) {
          const closed = hist.map((seg, i) =>
            i === hist.length - 1 && seg.end_date === null ? { ...seg, end_date: today } : seg
          )
          match.status_history = [...closed, { id: `sh-${match.id}-${Date.now()}`, status: update.status, start_date: today, end_date: null }]
          match.updated_at = new Date().toISOString()
        }
      }
      if (update.note) {
        const noteText = update.note.replace(/—/g, '-').replace(/–/g, '-')
        match.notes_log = [
          { id: Date.now() + Math.random(), text: noteText, timestamp: new Date().toISOString() },
          ...(match.notes_log ?? []),
        ]
      }
      if (update.milestone?.date && update.milestone?.label) {
        const ms = match.milestones ?? []
        const exists = ms.some(m => m.date === update.milestone.date && m.label === update.milestone.label)
        if (!exists) {
          match.milestones = [...ms, {
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            date: update.milestone.date,
            label: update.milestone.label,
          }]
        }
      }
      changed = true
    }

    if (changed) {
      const updatedTracks = Array.isArray(tracksRaw)
        ? tracksArr
        : Object.fromEntries(tracksArr.map(t => [t.id, t]))
      await supabase.from('user_data').upsert(
        { key: TRACKS_KEY, user_id: userId, value: updatedTracks, updated_at: new Date().toISOString() },
        { onConflict: 'key,user_id' }
      )
    }
  }

  // Build concise notification text for the Shortcut
  const MODULE_LABELS = {
    mood: 'mood', health: 'inflammation', diet: 'diet',
    exercise: 'exercise', sleep: 'sleep', social: 'social',
  }
  const logged = Object.keys(MODULE_LABELS).filter(k => {
    const m = parsed[k]
    if (!m || typeof m !== 'object') return false
    return Object.values(m).some(v => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
  }).map(k => MODULE_LABELS[k])

  // Check specific important fields against today's merged log (not just this transcript)
  // One-time-per-day fields only (diet/water are ongoing so excluded)
  const IMPORTANT_FIELDS = [
    { module: 'mood',   field: 'work',     label: 'work mood' },
    { module: 'mood',   field: 'life',     label: 'life mood' },
    { module: 'mood',   field: 'energy',   label: 'energy' },
    { module: 'health', field: 'eczema',   label: 'eczema' },
    { module: 'health', field: 'hayfever', label: 'hayfever' },
    { module: 'body',   field: 'gut',      label: 'gut' },
    { module: 'sleep',  field: 'hours',    label: 'sleep' },
  ]
  const missingFields = IMPORTANT_FIELDS
    .filter(({ module, field }) => {
      const val = todayLog[module]?.[field]
      return val == null || (Array.isArray(val) && val.length === 0)
    })
    .map(({ label }) => label)

  const notifParts = []
  if (logged.length) notifParts.push(`✅ Updated: ${logged.join(', ')}`)
  if (missingFields.length) notifParts.push(`❓ Awaiting: ${missingFields.join(', ')}`)
  else notifParts.push('⭐ All key info logged')

  return res.status(200).json({
    ok: true,
    date: today,
    notification_text: notifParts.join('\n'),
    missing: missingFields,
  })
}
