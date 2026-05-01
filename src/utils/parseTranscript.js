const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const SYSTEM_PROMPT = `You are a personal health and life check-in parser. The user will give you a free-form voice transcription of their day. Your job is to extract structured data and return ONLY valid JSON with no preamble, no markdown fences, no explanation.

Use exactly these field values:

mood fields (work, life, energy, focus): integer 1–5, or null
health.eczema: "None" | "Low" | "Med" | "Bad" | null
health.hayfever: "None" | "Low" | "Med" | "Bad" | null
health.symptoms: array from ["Headache","Fatigue","Bloating","Brain fog","Cramps","Anxious","Diarrhoea","Itchy throat","Itchy eyes"] - only include if mentioned
health.adhd_meds: "None" | "5mg" | "7.5mg" | "10mg" | null
health.antihistamines: "None" | "1" | "2" | "3" | null
diet.sugar: "None" | "Low" | "Med" | "High" | null
diet.protein: "Low" | "Med" | "High" | null
diet.fruit_veg: "1-2" | "3-4" | "5+" | null
diet.carbs: "Low" | "Med" | "High" | null
diet.snacking: "Low" | "Med" | "High" | null
diet.allergens: array from ["Dairy","Gluten","Soy","Wheat","Yeast"]
diet.caffeine: "0" | "1" | "2" | "3" | "4" | "5" | "6+" | null (cups/shots as string)
alcohol.level: "None" | "1-2" | "3-4" | "5+" | null
alcohol.type: array from ["Wine","Beer","Spirits"]
water.glasses: "<3" | "4-6" | "7+" | null
exercise.activities: array from ["Yoga","Pilates","Long walk","Gym"]
exercise.steps: integer | null (step count; "10k steps" → 10000)
sleep.hours: "<5" | "5" | "6" | "7" | "8" | "9+" | null
sleep.quality: "Poor" | "Fair" | "Good" | null
sleep.melatonin: true | false | null
social.activities: array from ["Friends","Work","Date","Dating Apps"]
log_date: ISO date string (YYYY-MM-DD) | null - only set if the user explicitly states the log is for a different day (e.g. "this is for yesterday", "logging Thursday"); otherwise null
cycle: true | false | null (true = period day)
gratitude: string | null
career_updates: array of { track_name: string, status: string | null, note: string | null }
  - only for tracks that already exist; status values: "in_progress" | "waiting" | "action_required" | "on_hold" | "secured" | "closed"
new_tracks: array of { name: string, group: string | null, status: string, note: string | null }
  - use when user mentions wanting to track, apply for, or add something new that doesn't exist yet
  - group: assign to an existing group name if the user mentions one, otherwise null
  - status values same as career_updates; default to "in_progress" if not specified
daily_win: string (one warm but not sycophantic sentence) | null
missing_important: array of field keys absent and important - default important set: ["mood","sleep"]; add "career_updates" if any work topic is mentioned
insights: array of { text: string, positive: boolean, actionable: boolean }
  - ALWAYS format text as "Topic - description" where Topic is the main subject (Sleep, Water, Capsa, PM Role at Zoe, etc.) — this enables bolding in the UI
  - positive: true = celebrating something good ("Sleep - solid week, 7hrs+ most nights")
  - positive: false = gentle neutral observation or nudge ("Water - has been low this week")
  - actionable: true = user needs to do something specific (follow up, contact someone, apply, log data)
  - actionable: false = observation, celebration, or passive note
  - do NOT make negative or guilt-inducing; frame nudges as calm observations
  - IMPORTANT: for every track in the context with status "action_required", always generate an actionable insight using the last note for context. E.g. if "PM Role at Zoe" is action_required with note "need to finish application", produce: { text: "PM Role at Zoe - still need to finish that application", positive: false, actionable: true }

Mapping guidance:
- "a couple drinks" / "a few drinks" → alcohol.level: "1-2"
- "went for a walk" / "long walk" → exercise.activities: ["Long walk"]
- "tired" / "exhausted" + low hours → infer sleep.quality: "Poor"
- "took my meds" / "took my ADHD meds" → health.adhd_meds: "7.5mg" (default if dose not stated)
- "took an antihistamine" / "took a Claritin" → health.antihistamines: "1"
- itchy eyes/throat/nose with pollen context → health.hayfever: "Low" or "Med" as appropriate
- "no alcohol" / "sober" / "didn't drink" → alcohol.level: "None"
- "loads of water" / "really hydrated" → water.glasses: "7+"
- "skipped breakfast" / "not much food" → diet.snacking: "Low", diet.carbs: "Low" as inferences
- Career track names may be abbreviated - match loosely
- A berry smoothie counts as 1-2 fruit portions, not 3-4. Be conservative with fruit_veg estimates.

If uncertain about a value, return null rather than guess. Do not hallucinate values not implied by the transcript.

For this_week_suggestions: use the recent life logs and career track context (if provided) to make specific, actionable suggestions. Examples: "You haven't logged exercise since Tuesday - today could be a good day for yoga", "Capsa is marked action_required - worth prioritising today", "Sleep has been under 7hrs the last 3 days - consider an earlier bedtime". Keep each suggestion to one sentence. Do not suggest logging mood/sleep if they are already in missing_important (avoid duplicates).`

export async function parseTranscript(transcript, trackNames = [], recentContext = '') {
  if (!API_KEY) throw new Error('VITE_ANTHROPIC_API_KEY not set')

  const trackContext = trackNames.length
    ? `\n\nKnown career tracks: ${trackNames.join(', ')}`
    : ''

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT + trackContext + recentContext,
      messages: [{ role: 'user', content: transcript }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  let text = data.content[0].text.trim()

  // Strip markdown code fences if Claude wraps the JSON despite instructions
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(text)
    console.log('[parseTranscript] result:', parsed)
    return parsed
  } catch {
    throw new Error('Claude returned invalid JSON: ' + text.slice(0, 200))
  }
}
