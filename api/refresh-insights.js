import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const USER_ID            = process.env.HEALTH_IMPORT_USER_ID
const LIFE_LOGS_KEY      = 'lifetracker-life-logs'
const TRACKS_KEY         = 'lifetracker-tracks-v3'
const WEATHER_KEY        = 'lifetracker-weather'
const INSIGHTS_KEY       = 'lifetracker-insights'
const FITBIT_RAW_KEY     = 'lifetracker-fitbit-raw'
const COMMITMENTS_KEY    = 'lifetracker-commitments'
const TRENDS_KEY         = 'lifetracker-trends'
const TRENDS_FEEDBACK_KEY = 'lifetracker-trends-feedback'

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a sharp, concise personal assistant. You receive health logs, baselines, and environment data. Generate a small number of useful, punchy insights. Return ONLY valid JSON — no preamble, no markdown.

Return exactly:
{ "insights": [{ "text": string, "positive": boolean, "actionable": boolean }], "daily_win": string | null }

TONE AND LENGTH — most important rule:
- Write like a smart friend sending a quick note, not a health report
- Each insight: ONE short sentence, ideally under 15 words. Maximum 20 words.
- Good: "Pollen calming down - should give your hayfever a rest"
- Bad: "Birch pollen was High on 9th May when you logged hayfever as Bad, and Medium on 10th..."
- Never explain your reasoning or hedge. State the observation directly.

FORMAT:
- "Topic - observation". Topic capitalised: "Sleep", "Hayfever", "Energy", or exact career track name.
- positive: true = genuine achievement or good news (slept well, exercised, completed something). NOT for meeting reminders or prep nudges.
- actionable: true = something specific to do right now; false = observation

ROUTING — critical:
- Life insights (health, sleep, water, hayfever, eczema, exercise, energy, mood) must use a health topic word as Topic ("Focus", "Sleep", "Hayfever"). NEVER use a career track name as the Topic of a life insight — this wrongly routes it to the Work section.
- Work insights use the exact track name as Topic.

WHAT TO INCLUDE (priority order):
1. Imminent milestones [TODAY] or [TOMORROW] → always first, actionable: true
2. Tomorrow's environment if pollen or wind is notably high → pre-empt with antihistamine nudge
3. Meaningful deviations from personal baselines (sleep, water, mood) — reference the baseline number. For same-day metrics like water, frame as forward nudge if there's still time to act ("a bit low, worth topping up" not "was low today")
4. Stalled or action_required tracks
5. Multi-day patterns (3+ days of same thing)

WHAT TO EXCLUDE — do not generate these:
- Generic health advice ("stable sleep supports focus and mood" — textbook, not personal)
- Speculative future narratives ("tracking this through future meetings will show whether...")
- Numbers stated without baseline comparison ("you had 4 glasses of water" means nothing alone)
- Commentary on individual foods unless it's a known allergen AND a related symptom is logged nearby
- Pollen/environment correlations using data from days when the user was in a different country (location is shown per day in history — only use correlations from days matching today's location)
- Causal direction errors: sleep affects mood and focus, not the other way round. Never imply mood or focus caused a sleep outcome.
- Treating co-occurring symptoms as cause and effect (brain fog and low focus are the same thing, not one causing the other)
- Low-signal in_progress tracks with no milestones and a recent note — silence is better than noise

CAREER RULES:
- [TOMORROW]/[TODAY] milestones → first insight, actionable
- action_required → always include, short and specific
- 5+ days since last note on active track → "it's been a while since [Track] - worth a check-in"
- NEVER repeat relative time phrases from note text (they are stale)
- Prioritise: imminent deadline > action_required > stalest track. Skip quiet in_progress.

Date formatting: "14th May" not "2026-05-14".
daily_win: one warm, specific sentence about something done well. Null if nothing genuine.
IMPORTANT: Regular hyphens (-) only. No em dashes (—).`

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

// ── Trends helpers ────────────────────────────────────────────────────────────

const HIGHER_IS_BAD_IDS = new Set([
  'eczema', 'hayfever', 'gut', 'nerve_pain', 'knee_pain',
  'episcleritis', 'dryness', 'bloating', 'cramps', 'diarrhoea', 'brain_fog', 'headache',
])

function trendSentence(f) {
  const higherIsBad = HIGHER_IS_BAD_IDS.has(f.effect_id)
  const label = f.effect_label ?? f.effect_id
  const lag = f.lag === 0 ? 'same day' : f.lag === 1 ? 'next day' : `${f.lag}d later`
  if (f.type === 'binary') {
    const worse = (f.direction === 'higher_with' && higherIsBad) || (f.direction === 'lower_with' && !higherIsBad)
    return `${f.cause_label} → ${worse ? 'worse' : 'better'} ${label} (${lag})`
  }
  if (f.type === 'continuous') {
    const isBeneficial = (f.direction === 'positive' && !higherIsBad) || (f.direction === 'negative' && higherIsBad)
    return `Higher ${f.cause_label.toLowerCase()} → ${isBeneficial ? 'better' : 'worse'} ${label} (${lag}, r=${f.pearson_r})`
  }
  return null
}

function buildTrendsFeedbackContext(trendsData, feedback) {
  if (!feedback || Object.keys(feedback).length === 0) return null
  if (!trendsData?.findings) return null

  // Build a lookup from feedingKey → finding for all viable findings
  const map = new Map()
  for (const f of trendsData.findings) {
    if (f.effect_size < 0.3 || f.n < 10) continue
    const higherIsBad = HIGHER_IS_BAD_IDS.has(f.effect_id)
    let dir
    if (f.type === 'binary') {
      if (f.direction === 'higher_with' && higherIsBad)  dir = 'bad'
      else if (f.direction === 'higher_with' && !higherIsBad) dir = 'good'
      else if (f.direction === 'lower_with'  && higherIsBad)  dir = 'good'
      else dir = 'bad'
    } else if (f.type === 'continuous') {
      const positive = f.direction === 'positive'
      if (positive && higherIsBad)  dir = 'bad'
      else if (positive && !higherIsBad) dir = 'good'
      else if (!positive && higherIsBad) dir = 'good'
      else dir = 'bad'
    } else {
      dir = 'neutral'
    }
    const key = `${f.cause_id}::${f.effect_id}::${dir}`
    if (!map.has(key) || f.effect_size > map.get(key).effect_size) map.set(key, f)
  }

  const agreed = [], flagged = []
  for (const [key, vote] of Object.entries(feedback)) {
    const f = map.get(key)
    if (!f) continue
    const sentence = trendSentence(f)
    if (!sentence) continue
    if (vote === 'agree')    agreed.push(sentence)
    if (vote === 'disagree') flagged.push(sentence)
  }

  const lines = []
  if (agreed.length)  lines.push('User-confirmed patterns (treat with higher confidence):\n  ' + agreed.join('\n  '))
  if (flagged.length) lines.push('User-flagged as wrong direction (do NOT rely on these):\n  ' + flagged.join('\n  '))
  return lines.length ? lines.join('\n') : null
}

function buildTrendsContext(trendsData) {
  const findings = trendsData?.findings
  if (!findings?.length) return null
  const map = new Map()
  for (const f of findings) {
    if (f.effect_size < 0.4 || f.n < 14) continue
    if (HIGHER_IS_BAD_IDS.has(f.effect_id) && f.lag === 0) continue
    const key = `${f.cause_id}::${f.effect_id}`
    if (!map.has(key) || f.effect_size > map.get(key).effect_size) map.set(key, f)
  }
  const best = [...map.values()].sort((a, b) => b.effect_size - a.effect_size).slice(0, 12)
  if (!best.length) return null
  return best.map(trendSentence).filter(Boolean).join('\n  ')
}

// ── Commitments helpers ───────────────────────────────────────────────────────

function buildCommitmentsContext(commitments, today) {
  if (!commitments?.length) return null
  const past = new Date(today); past.setDate(past.getDate() - 7)
  const future = new Date(today); future.setDate(future.getDate() + 21)
  const pastIso   = past.toISOString().slice(0, 10)
  const futureIso = future.toISOString().slice(0, 10)
  const relevant = commitments
    .filter(c => c.end_date >= pastIso && c.start_date <= futureIso)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  if (!relevant.length) return null
  return relevant.map(c => {
    const isActive   = c.start_date <= today && c.end_date >= today
    const isUpcoming = c.start_date > today
    const status     = isActive ? 'NOW' : isUpcoming ? 'upcoming' : 'just ended'
    const loc        = c.location ? `, ${c.location}` : ''
    return `  - "${c.name}" (${fmtDate(c.start_date)}–${fmtDate(c.end_date)}${loc}) [${status}]`
  }).join('\n')
}

// ── Context builder ───────────────────────────────────────────────────────────

function buildInsightContext(today, logs, tracksArr, weatherStore, commitments, trendsData, trendsFeedback) {
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

    const dayWeather = weatherStore[iso]
    const wLine = formatWeatherLine(dayWeather)
    const locationNote = dayWeather?.location && dayWeather.location !== 'London' ? ` [${dayWeather.location}]` : ''
    const weatherSuffix = wLine ? ` | env: ${wLine}` : ''
    if (parts.length) recentLines.push(`  ${fmtDate(iso)}${locationNote}: ${parts.join(' | ')}${weatherSuffix}`)
  }
  if (recentLines.length) {
    lines.push('Recent history (last 14 days):')
    lines.push(...recentLines)
  }

  // Commitments (trips, events) — gives context for unusual eating/drinking patterns
  const commitmentsCtx = buildCommitmentsContext(commitments, today)
  if (commitmentsCtx) {
    lines.push('\nCommitments / trips (context for behaviour patterns):')
    lines.push(commitmentsCtx)
  }

  // Known personal patterns from correlation analysis (high confidence only)
  const trendsCtx = buildTrendsContext(trendsData)
  if (trendsCtx) {
    lines.push('\nKnown personal patterns (from data analysis, use to personalise nudges):')
    lines.push('  ' + trendsCtx)
  }

  // User feedback on pattern accuracy
  const feedbackCtx = buildTrendsFeedbackContext(trendsData, trendsFeedback)
  if (feedbackCtx) {
    lines.push('\n' + feedbackCtx)
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
    const [logsRow, tracksRow, weatherRow, insightsRow, commitmentsRow, trendsRow, feedbackRow] = await Promise.all([
      supabase.from('user_data').select('value').eq('key', LIFE_LOGS_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', TRACKS_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', WEATHER_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', INSIGHTS_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', COMMITMENTS_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', TRENDS_KEY).eq('user_id', USER_ID).single(),
      supabase.from('user_data').select('value').eq('key', TRENDS_FEEDBACK_KEY).eq('user_id', USER_ID).single(),
    ])

    const logs           = logsRow.data?.value         ?? {}
    const tracksRaw      = tracksRow.data?.value        ?? {}
    const tracksArr      = Array.isArray(tracksRaw) ? tracksRaw : Object.values(tracksRaw)
    const weatherStore   = weatherRow.data?.value       ?? {}
    const commitments    = commitmentsRow.data?.value   ?? []
    const trendsData     = trendsRow.data?.value        ?? null
    const trendsFeedback = feedbackRow.data?.value      ?? null

    const context = buildInsightContext(today, logs, tracksArr, weatherStore, commitments, trendsData, trendsFeedback)
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
