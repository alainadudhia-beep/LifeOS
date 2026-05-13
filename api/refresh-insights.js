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

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a personal health and life analyst for a single user. You receive structured daily logs, recent history, and environmental data. Generate thoughtful, specific insights based on the data. Return ONLY valid JSON — no preamble, no markdown, no explanation.

Return exactly this structure:
{
  "insights": [{ "text": string, "positive": boolean, "actionable": boolean }],
  "daily_win": string | null
}

Insight format rules:
- ALWAYS format text as "Topic - description" (e.g. "Sleep - solid 8hrs last night", "Hayfever - worse when wind is high, even with low pollen")
- Always capitalise Topic: "Sleep", "Water", "Hayfever", "Eczema", "Energy", "Alcohol", etc.
- positive: true = celebrating something genuinely good
- positive: false = calm, neutral observation or gentle nudge — never guilt-inducing or harsh
- actionable: true = there is something specific to do (follow up, apply, log something)
- actionable: false = observation or celebration
- Generate 3–6 insights. Quality over quantity — only include ones grounded in the data.
- For any career track with status "action_required", always include an actionable insight
- Use exact track names from career context — never abbreviate or paraphrase
- Weather correlations: ONLY note connections that are medically plausible. Specifically: high pollen or high wind → hayfever/allergy/eczema flares. High UV → skin dryness. High AQI/PM2.5 → respiratory symptoms. Do NOT connect wind, rain, or temperature to brain fog, focus, mood, or energy — those are not direct causal relationships.
- If a field is missing from today's log that is usually logged, note it calmly

daily_win: one warm but not sycophantic observation about something done well today, "Topic - observation" format. Null if nothing clear stands out.

IMPORTANT: Use only regular hyphens (-) in all text. Never em dashes (—) or en dashes (–).`

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatWeatherLine(w, date) {
  if (!w) return null
  const parts = []
  if (w.location)                   parts.push(w.location)
  if (w.temp_max != null)           parts.push(`${Math.round(w.temp_max)}°C max`)
  if (w.precipitation_mm != null)   parts.push(`${w.precipitation_mm}mm rain`)
  if (w.wind_speed_max != null)     parts.push(`wind ${Math.round(w.wind_speed_max)} km/h`)
  if (w.grass_pollen_label)         parts.push(`grass pollen ${w.grass_pollen_label}`)
  if (w.birch_pollen_label && w.birch_pollen > 0) parts.push(`birch ${w.birch_pollen_label}`)
  if (w.aqi_label)                  parts.push(`AQI ${w.aqi_label}`)
  return `  ${date}: ${parts.join(', ')}`
}

function buildInsightContext(today, logs, tracksArr, weatherStore) {
  const lines = []

  // Today's environment
  const todayW = weatherStore[today]
  if (todayW) {
    const wLine = formatWeatherLine(todayW, today)
    if (wLine) lines.push(`Today's environment: ${wLine.trim()}`)
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

    const wLine = formatWeatherLine(weatherStore[iso], '')
    const weatherSuffix = wLine ? ` | env: ${wLine.trim().replace(/^:\s*/, '')}` : ''
    if (parts.length) recentLines.push(`  ${iso}: ${parts.join(' | ')}${weatherSuffix}`)
  }
  if (recentLines.length) {
    lines.push('Recent history (last 14 days):')
    lines.push(...recentLines)
  }

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
      const lastNote = t.notes_log?.[0]?.text
      const upcoming = (t.milestones ?? [])
        .filter(m => m.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 2)
        .map(m => `${m.label} on ${m.date}`)
        .join(', ')
      lines.push(`  "${t.name}" - ${status}${lastNote ? ` | note: "${lastNote.slice(0, 80)}"` : ''}${upcoming ? ` | upcoming: ${upcoming}` : ''}`)
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
