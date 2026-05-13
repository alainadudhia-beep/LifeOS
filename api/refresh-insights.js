import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const USER_ID         = process.env.HEALTH_IMPORT_USER_ID
const LIFE_LOGS_KEY   = 'lifetracker-life-logs'
const TRACKS_KEY      = 'lifetracker-tracks-v3'
const WEATHER_KEY     = 'lifetracker-weather'
const INSIGHTS_KEY    = 'lifetracker-insights'
const FITBIT_RAW_KEY  = 'lifetracker-fitbit-raw'

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a personal health and life analyst for a single user. You receive structured daily logs, 14-day history, personalised baselines, and environmental data. Generate specific, non-obvious insights. Return ONLY valid JSON — no preamble, no markdown, no explanation.

Return exactly this structure:
{
  "insights": [{ "text": string, "positive": boolean, "actionable": boolean }],
  "daily_win": string | null
}

Insight format:
- ALWAYS "Topic - description". Topic capitalised: "Sleep", "Water", "Hayfever", "Eczema", "Energy", or exact career track name.
- positive: true = genuinely good; false = calm neutral nudge, never guilt-inducing
- actionable: true = specific thing to do; false = observation

Quality rules — what makes a good insight:
- Compare today's values to the user's personal baseline averages (provided in context). "Sleep was 5hrs (your average is 7.1hrs)" is useful. "You slept 5hrs" is not.
- Note deviations from baseline, not just absolute values.
- Forward-looking: if tomorrow's environment forecast shows High pollen or Strong wind, warn the user tonight so they can pre-empt (take antihistamine, prepare).
- Generate 3–6 insights. Fewer good ones beat many mediocre ones.

What NOT to include:
- Commentary on individual foods unless they are a known allergen (dairy, gluten, soy, wheat, yeast) AND the user has logged a related symptom recently
- Any number restatement without comparison to baseline (e.g. never say "you had 4 glasses of water" — say "water was below your 5.8-glass average")
- Career track insights for tracks that are in_progress, have no upcoming milestones, and whose last note is recent — silence is better than noise for these
- Generic health advice not grounded in this user's data

Career track rules:
- Any milestone flagged [TOMORROW] or [TODAY] → must be FIRST insight, actionable: true
- action_required tracks → always include an actionable insight
- If last note was 5+ days ago on an active track → "it's been a while since [Track name] - worth a check-in"
- NEVER repeat relative time phrases from note text ("tomorrow", "next week") — these are stale. Describe from today's perspective.
- Prioritise by: imminent deadline > action_required > stalest active track. Skip low-signal in_progress tracks.
- With N weeks until the September 2026 career decision, flag if key tracks are stalled.

Date formatting: ordinal day + month only. "14th May" not "2026-05-14".

Weather correlations — medically plausible only:
- High pollen + strong wind → hayfever / eczema pre-emption (especially if tomorrow's forecast)
- High UV → skin dryness
- High AQI → respiratory symptoms
- Never connect wind/rain/temperature to brain fog, focus, mood, or energy.

daily_win: one warm, specific observation about something done well today. "Topic - observation" format. Null if nothing genuine stands out.

IMPORTANT: Regular hyphens (-) only. Never em dashes (—) or en dashes (–).`

// ── Helpers ───────────────────────────────────────────────────────────────────

function windLabel(kmh) {
  if (kmh == null) return null
  if (kmh < 15) return 'Low wind'
  if (kmh < 35) return 'Moderate wind'
  return 'Strong wind'
}

function fmtDate(iso) {
  // "2026-05-14" → "14th May"
  const d = new Date(iso + 'T12:00:00')
  const day = d.getDate()
  const suffix = [11,12,13].includes(day) ? 'th'
    : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'
  return `${day}${suffix} ${d.toLocaleDateString('en-GB', { month: 'long' })}`
}

function daysDiff(isoA, isoB) {
  return Math.round((new Date(isoA) - new Date(isoB)) / 86400000)
}

function formatWeatherLine(w) {
  if (!w) return null
  const parts = []
  if (w.temp_max != null)         parts.push(`${Math.round(w.temp_max)}°C max`)
  if (w.precipitation_mm != null) parts.push(`${w.precipitation_mm}mm rain`)
  const wl = windLabel(w.wind_speed_max)
  if (wl)                         parts.push(wl)
  if (w.grass_pollen_label)       parts.push(`grass pollen ${w.grass_pollen_label}`)
  if (w.birch_pollen_label && w.birch_pollen > 0) parts.push(`birch ${w.birch_pollen_label}`)
  if (w.aqi_label)                parts.push(`AQI ${w.aqi_label}`)
  return parts.join(', ')
}

// ── Rolling baselines (14-day averages, excluding today) ──────────────────────

const SLEEP_TO_N  = { '<5': 4.5, '5': 5, '6': 6, '7': 7, '8': 8, '9+': 9 }
const WATER_TO_N  = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8+': 8 }

function computeBaselines(today, logs, days = 14) {
  const sleep = [], water = [], work = [], life = [], focus = [], energy = []
  for (let i = 1; i <= days; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const log = logs[d.toISOString().slice(0, 10)]
    if (!log) continue
    const sv = SLEEP_TO_N[log.sleep?.hours];  if (sv != null) sleep.push(sv)
    const wv = WATER_TO_N[log.water?.glasses]; if (wv != null) water.push(wv)
    if (log.mood?.work   != null) work.push(log.mood.work)
    if (log.mood?.life   != null) life.push(log.mood.life)
    if (log.mood?.focus  != null) focus.push(log.mood.focus)
    if (log.mood?.energy != null) energy.push(log.mood.energy)
  }
  const avg = arr => arr.length >= 3 ? (arr.reduce((a,b) => a+b,0) / arr.length).toFixed(1) : null
  return {
    sleep:  avg(sleep),
    water:  avg(water),
    work:   avg(work),
    life:   avg(life),
    focus:  avg(focus),
    energy: avg(energy),
    n: Math.max(sleep.length, water.length, work.length),
  }
}

function buildInsightContext(today, logs, tracksArr, weatherStore) {
  const lines = []
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowIso = tomorrow.toISOString().slice(0, 10)

  // ── Imminent milestones (next 48h) — surfaced first so Claude treats as top priority
  const imminent = []
  for (const t of tracksArr) {
    const status = t.status_history?.length
      ? t.status_history[t.status_history.length - 1].status : t.status
    if (status === 'closed' || status === 'secured' || t.archived) continue
    for (const m of (t.milestones ?? [])) {
      if (m.date === today)        imminent.push(`"${t.name}" - ${m.label} [TODAY] (${fmtDate(m.date)})`)
      else if (m.date === tomorrowIso) imminent.push(`"${t.name}" - ${m.label} [TOMORROW] (${fmtDate(m.date)})`)
    }
  }
  if (imminent.length) {
    lines.push('URGENT - Upcoming milestones in next 48 hours:')
    imminent.forEach(l => lines.push('  ' + l))
  }

  // Baselines
  const baselines = computeBaselines(today, logs)
  if (baselines.n >= 3) {
    const parts = []
    if (baselines.sleep)  parts.push(`sleep ${baselines.sleep}hrs`)
    if (baselines.water)  parts.push(`water ${baselines.water} glasses`)
    if (baselines.work)   parts.push(`work mood ${baselines.work}`)
    if (baselines.life)   parts.push(`life mood ${baselines.life}`)
    if (baselines.focus)  parts.push(`focus ${baselines.focus}`)
    if (baselines.energy) parts.push(`energy ${baselines.energy}`)
    lines.push(`14-day personal averages (${baselines.n} days): ${parts.join(', ')}`)
  }

  // Today's environment
  const todayW = weatherStore[today]
  if (todayW) {
    const wLine = formatWeatherLine(todayW)
    if (wLine) lines.push(`Today's environment (${todayW.location ?? 'London'}): ${wLine}`)
  }

  // Tomorrow's forecast — for pre-emption nudges
  const tomorrowD = new Date(today); tomorrowD.setDate(tomorrowD.getDate() + 1)
  const tomorrowIso2 = tomorrowD.toISOString().slice(0, 10)
  const tomorrowW = weatherStore[tomorrowIso2]
  if (tomorrowW) {
    const wLine = formatWeatherLine(tomorrowW)
    if (wLine) lines.push(`Tomorrow's forecast (${fmtDate(tomorrowIso2)}): ${wLine}`)
  }

  // Today's full log
  const todayLog = logs[today]
  if (todayLog) {
    const parts = []
    const m = todayLog.mood
    if (m) {
      const scores = ['work', 'life', 'energy', 'focus'].filter(k => m[k] != null).map(k => `${k}=${m[k]}`)
      if (scores.length) parts.push(`mood: ${scores.join(', ')}`)
      if (m.symptoms?.length) parts.push(`symptoms: ${m.symptoms.join(', ')}`)
      if (m.adhd_meds && m.adhd_meds !== 'None') parts.push(`ADHD meds: ${m.adhd_meds}`)
    }
    const h = todayLog.health
    if (h) {
      if (h.eczema && h.eczema !== 'None')     parts.push(`eczema: ${h.eczema}${h.eczema_location?.length ? ' (' + h.eczema_location.join(', ') + ')' : ''}`)
      if (h.hayfever && h.hayfever !== 'None') parts.push(`hayfever: ${h.hayfever}`)
      if (h.gut && h.gut !== 'None')           parts.push(`gut: ${h.gut}`)
      if (h.antihistamines && h.antihistamines !== 'None') parts.push(`antihistamines: ${h.antihistamines}`)
    }
    if (todayLog.sleep?.hours)      parts.push(`sleep: ${todayLog.sleep.hours}hrs${todayLog.sleep.quality ? ' ' + todayLog.sleep.quality : ''}`)
    if (todayLog.water?.glasses)    parts.push(`water: ${todayLog.water.glasses} glasses`)
    if (todayLog.exercise?.activities?.length) parts.push(`exercise: ${todayLog.exercise.activities.join(', ')}`)
    const d = todayLog.diet
    if (d) {
      const dp = []
      if (d.fruit_veg) dp.push(`fruit/veg ${d.fruit_veg}`)
      if (d.protein)   dp.push(`protein ${d.protein}`)
      if (d.sugar)     dp.push(`sugar ${d.sugar}`)
      if (d.caffeine)  dp.push(`caffeine ${d.caffeine}`)
      if (d.allergens?.length) dp.push(`allergens: ${d.allergens.join(', ')}`)
      if (dp.length) parts.push(`diet: ${dp.join(', ')}`)
    }
    if (todayLog.alcohol?.level && todayLog.alcohol.level !== 'None') parts.push(`alcohol: ${todayLog.alcohol.level}`)
    if (todayLog.social?.activities?.length) parts.push(`social: ${todayLog.social.activities.join(', ')}`)
    if (parts.length) lines.push(`Today's log: ${parts.join(' | ')}`)
  } else {
    lines.push("Today's log: nothing logged yet")
  }

  // Recent history (last 14 days) + weather
  const recentLines = []
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const log = logs[iso]
    if (!log) continue

    const parts = []
    const m = log.mood
    if (m) {
      const scores = ['work', 'life', 'energy', 'focus'].filter(k => m[k] != null).map(k => `${k}=${m[k]}`)
      if (scores.length) parts.push(`mood: ${scores.join(', ')}`)
    }
    if (log.sleep?.hours)  parts.push(`sleep: ${log.sleep.hours}hrs`)
    if (log.health?.eczema && log.health.eczema !== 'None')    parts.push(`eczema: ${log.health.eczema}`)
    if (log.health?.hayfever && log.health.hayfever !== 'None') parts.push(`hayfever: ${log.health.hayfever}`)
    if (log.health?.gut && log.health.gut !== 'None')          parts.push(`gut: ${log.health.gut}`)
    if (log.water?.glasses) parts.push(`water: ${log.water.glasses}`)
    if (log.exercise?.activities?.length) parts.push(`exercise: ${log.exercise.activities.join(', ')}`)
    if (log.alcohol?.level && log.alcohol.level !== 'None') parts.push(`alcohol: ${log.alcohol.level}`)

    const wLine = formatWeatherLine(weatherStore[iso])
    const weatherSuffix = wLine ? ` | env: ${wLine}` : ''
    if (parts.length) recentLines.push(`  ${fmtDate(iso)}: ${parts.join(' | ')}${weatherSuffix}`)
  }
  if (recentLines.length) {
    lines.push('Recent history (last 14 days):')
    lines.push(...recentLines)
  }

  // Career decision deadline
  const septWeeks = Math.ceil((new Date('2026-09-01') - new Date(today)) / (7 * 86400000))
  lines.push(`\nKey career decision deadline: 1st September 2026 (${septWeeks} weeks away)`)

  // Active career tracks
  const activeTracks = tracksArr.filter(t => {
    const status = t.status_history?.length
      ? t.status_history[t.status_history.length - 1].status
      : t.status
    return status && status !== 'closed' && status !== 'secured' && !t.archived
  })
  if (activeTracks.length) {
    lines.push('\nActive career tracks:')
    for (const t of activeTracks) {
      const status = t.status_history?.length
        ? t.status_history[t.status_history.length - 1].status
        : t.status
      const lastNoteEntry = t.notes_log?.[0]
      const lastNoteText  = lastNoteEntry?.text
      const lastNoteDate  = lastNoteEntry?.timestamp?.slice(0, 10)
      const noteAgeDays   = lastNoteDate ? daysDiff(today, lastNoteDate) : null
      const noteAge       = noteAgeDays != null
        ? (noteAgeDays === 0 ? 'today' : noteAgeDays === 1 ? '1 day ago' : `${noteAgeDays} days ago`)
        : 'unknown'
      const upcoming = (t.milestones ?? [])
        .filter(m => m.date > tomorrowIso)  // imminent ones already surfaced above
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 2)
        .map(m => `${m.label} on ${fmtDate(m.date)}`)
        .join(', ')
      lines.push(
        `  "${t.name}" - ${status}` +
        (lastNoteText ? ` | last note (${noteAge}): "${lastNoteText.slice(0, 80)}"` : ' | no notes yet') +
        (upcoming ? ` | upcoming: ${upcoming}` : '')
      )
    }
  }

  return lines.join('\n')
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude(context) {
  const apiKey = process.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':            apiKey,
      'anthropic-version':    '2023-06-01',
      'anthropic-beta':       'prompt-caching-2024-07-31',
      'content-type':         'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',  // lighter model — insights only, no parsing
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: context }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  let text = data.content[0].text.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(text)
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  try {
    const today = new Date().toISOString().slice(0, 10)

    // Read all data in parallel
    const [logsRow, tracksRow, weatherRow, insightsRow] = await Promise.all([
      supabase.from('user_data').select('value').eq('key', LIFE_LOGS_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', TRACKS_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', WEATHER_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', INSIGHTS_KEY).eq('user_id', USER_ID).single(),
    ])

    const logs         = logsRow.data?.value    ?? {}
    const tracksRaw    = tracksRow.data?.value  ?? {}
    const tracksArr    = Array.isArray(tracksRaw) ? tracksRaw : Object.values(tracksRaw)
    const weatherStore = weatherRow.data?.value ?? {}

    const context = buildInsightContext(today, logs, tracksArr, weatherStore)
    const parsed  = await callClaude(context)

    if (!parsed.insights?.length) {
      return res.status(200).json({ ok: true, insights: [], daily_win: null })
    }

    // Merge into existing insights array (same format the client uses)
    const existingItems = Array.isArray(insightsRow.data?.value) ? insightsRow.data.value : []
    const kept = existingItems.filter(it => it.type !== 'claude' || (it.created_at ?? '').slice(0, 10) !== today)
    const newItems = parsed.insights.map(ins => ({
      id:           `ins-claude-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type:         'claude',
      text:         ins.text.replace(/—/g, '-').trim(),
      positive:     ins.positive   ?? false,
      actionable:   ins.actionable ?? false,
      completed:    false,
      completed_at: null,
      created_at:   new Date().toISOString(),
    }))

    await supabase.from('user_data').upsert(
      { key: INSIGHTS_KEY, user_id: USER_ID, value: [...kept, ...newItems], updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )

    return res.status(200).json({
      ok:        true,
      insights:  parsed.insights,   // raw format for client to call addInsights()
      daily_win: parsed.daily_win ?? null,
    })

  } catch (err) {
    console.error('[refresh-insights]', err)
    return res.status(500).json({ error: err.message })
  }
}
