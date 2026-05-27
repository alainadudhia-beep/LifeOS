import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const USER_ID         = process.env.HEALTH_IMPORT_USER_ID
const COMMITMENTS_KEY = 'lifetracker-commitments'
const WEATHER_KEY     = 'lifetracker-weather'
const DEFAULT_CITY    = 'London'

// ── Geocoding ────────────────────────────────────────────────────────────────

async function geocode(city) {
  const res  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)
  const json = await res.json()
  if (!json.results?.length) throw new Error(`Could not geocode: ${city}`)
  const { latitude: lat, longitude: lon } = json.results[0]
  return { lat, lon }
}

// ── Met Office pollen scraper (grass + weed labels for London & SE) ──────────

const MO_LEVELS = { 'very high': 'Very High', 'high': 'High', 'moderate': 'Medium', 'low': 'Low' }

async function fetchMetOfficePollen() {
  try {
    const res = await fetch(
      'https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/pollen-forecast',
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } }
    )
    if (!res.ok) { console.warn('[weather-fetch] Met Office pollen HTTP', res.status); return null }
    const html = await res.text()

    // Find the region-heading <h3> for London SE — skip the <option> in the dropdown
    const idx = html.search(/region-heading[^>]*>London\s*(?:&amp;|&)\s*South\s*East/i)
    if (idx === -1) { console.warn('[weather-fetch] London SE section not found in Met Office page'); return null }
    const section = html.slice(idx, idx + 3000)

    // Today's grass/weed split from the paragraph text
    const grassMatch = section.match(/(very high|high|moderate|low)\s+grass\s+pollen/i)
    const weedMatch  = section.match(/(very high|high|moderate|low)\s+weed\s+pollen/i)

    // 5-day forecast: dates from <time datetime="..."> and levels from data-category="h/vh/m/l"
    const MO_CODE    = { vh: 'Very High', h: 'High', m: 'Medium', l: 'Low' }
    const dateMatches = [...section.matchAll(/<time\s+datetime="(\d{4}-\d{2}-\d{2})"/gi)]
    const catMatches  = [...section.matchAll(/data-category="(vh|h|m|l)"/gi)]
    const forecast = {}
    dateMatches.forEach((dm, i) => {
      const cat = catMatches[i]?.[1]
      if (dm[1] && cat) forecast[dm[1]] = MO_CODE[cat] ?? null
    })

    return {
      grass:    MO_LEVELS[grassMatch?.[1]?.toLowerCase()] ?? null,
      weed:     MO_LEVELS[weedMatch?.[1]?.toLowerCase()]  ?? null,
      forecast, // { 'YYYY-MM-DD': 'High', ... } for today + 4 days
    }
  } catch (e) {
    console.warn('[weather-fetch] Met Office scrape failed:', e.message)
    return null
  }
}

// ── Airmine pollen scraper (numerical scores + birch for London) ──────────────

const AIRMINE_LEVELS = { 'very high': 'Very High', 'high': 'High', 'medium': 'Medium', 'low': 'Low', 'none': null }

function parseAirminePlant(html, plant) {
  // Matches: <span class="pollen-name">Grass (Poaceae):</span><span class="pollen-level">Medium <span class="pollen-value">41/100</span>
  const re = new RegExp(
    `pollen-name">${plant}[^<]*<\\/span>\\s*<span[^>]*>\\s*(Very High|High|Medium|Low|None)\\s*<span[^>]*>(\\d+)\\/100`,
    'i'
  )
  const m = html.match(re)
  if (!m) return { label: null, score: null }
  return { label: AIRMINE_LEVELS[m[1].toLowerCase()] ?? null, score: parseInt(m[2]) }
}

async function fetchAirminePollen() {
  try {
    const res = await fetch('https://airmine.ai/pollen/united-kingdom/london/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }
    })
    if (!res.ok) { console.warn('[weather-fetch] Airmine pollen HTTP', res.status); return null }
    const html = await res.text()

    // Split at the Tomorrow <h2> section heading (not the intro paragraph mention)
    const tIdx        = html.search(/pollution-day-title[^>]*>[^<]*Tomorrow/i)
    const todayHtml    = tIdx > -1 ? html.slice(0, tIdx) : html
    const tomorrowHtml = tIdx > -1 ? html.slice(tIdx)    : ''

    return {
      today:    { grass: parseAirminePlant(todayHtml,    'Grass'), birch: parseAirminePlant(todayHtml,    'Birch') },
      tomorrow: { grass: parseAirminePlant(tomorrowHtml, 'Grass'), birch: parseAirminePlant(tomorrowHtml, 'Birch') },
    }
  } catch (e) {
    console.warn('[weather-fetch] Airmine scrape failed:', e.message)
    return null
  }
}

function aqiLabel(v) {
  if (v == null) return null
  if (v <= 20)  return 'Good'
  if (v <= 40)  return 'Fair'
  if (v <= 60)  return 'Moderate'
  if (v <= 80)  return 'Poor'
  return 'Very Poor'
}

// ── Air quality: fetch hourly and aggregate to daily max ─────────────────────
// The Open-Meteo air quality API only supports hourly for pollen/AQI variables.

async function fetchAirQualityForDates(lat, lon, startDate, endDate) {
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=grass_pollen,birch_pollen,alder_pollen,ragweed_pollen,pm10,pm2_5,european_aqi` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&timezone=auto`
  )
  if (!res.ok) throw new Error(`Air quality API error: ${res.status}`)
  const json = await res.json()
  const h = json.hourly

  // Group hourly readings by date, take daily max for each variable
  const byDate = {}
  const vars = ['grass_pollen', 'birch_pollen', 'alder_pollen', 'ragweed_pollen', 'pm10', 'pm2_5', 'european_aqi']
  for (let i = 0; i < h.time.length; i++) {
    const date = h.time[i].slice(0, 10)
    if (!byDate[date]) byDate[date] = Object.fromEntries(vars.map(v => [v, []]))
    for (const v of vars) {
      const val = h[v]?.[i]
      if (val != null) byDate[date][v].push(val)
    }
  }

  const maxOrNull = arr => arr.length ? Math.max(...arr) : null
  return Object.fromEntries(
    Object.entries(byDate).map(([date, vals]) => [
      date,
      Object.fromEntries(vars.map(v => [v, maxOrNull(vals[v])]))
    ])
  )
}

// ── Location resolution ───────────────────────────────────────────────────────

async function resolveLocation(today) {
  const { data } = await supabase
    .from('user_data')
    .select('value')
    .eq('key', COMMITMENTS_KEY)
    .single()

  const commitments = data?.value ?? []
  const active = commitments
    .filter(c => c.location && c.start_date <= today && c.end_date >= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))

  return active[0]?.location ?? DEFAULT_CITY
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (process.env.CRON_SECRET) {
    const bearerOk = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`
    const queryOk  = req.query?.secret === process.env.CRON_SECRET
    if (!bearerOk && !queryOk) return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Build rolling 5-day date array: today + next 4 days
    const dates = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const today    = dates[0]
    const lastDate = dates[4]

    const city         = await resolveLocation(today)
    const { lat, lon } = await geocode(city)

    // Fetch forecast, air quality, Met Office pollen, and Airmine pollen in parallel
    const [forecastRes, airByDate, metOfficePollen, airminePollen] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,uv_index_max,relative_humidity_2m_mean` +
        `&timezone=auto&forecast_days=5`
      ).then(r => { if (!r.ok) throw new Error(`Forecast API error: ${r.status}`); return r.json() }),
      fetchAirQualityForDates(lat, lon, today, lastDate),
      fetchMetOfficePollen(),
      fetchAirminePollen(),
    ])

    function buildDayWeather(dateStr, dayIndex) {
      const d   = forecastRes.daily
      const a   = airByDate[dateStr] ?? {}
      const aq  = a.european_aqi ?? null

      // Airmine only covers today (0) and tomorrow (1)
      const air = dayIndex === 0 ? airminePollen?.today
                : dayIndex === 1 ? airminePollen?.tomorrow
                : null

      // Grass label: Met Office grass-specific for today, Airmine for tomorrow,
      // Met Office 5-day combined code for days 2–4 (grass dominates in summer)
      const grassLabel = dayIndex === 0
        ? (metOfficePollen?.grass ?? metOfficePollen?.forecast?.[dateStr] ?? null)
        : (air?.grass?.label ?? metOfficePollen?.forecast?.[dateStr] ?? null)

      return {
        location:           city,
        temp_max:           d.temperature_2m_max?.[dayIndex]        ?? null,
        temp_min:           d.temperature_2m_min?.[dayIndex]        ?? null,
        precipitation_mm:   d.precipitation_sum?.[dayIndex]         ?? null,
        wind_speed_max:     d.windspeed_10m_max?.[dayIndex]         ?? null,
        uv_index:           d.uv_index_max?.[dayIndex]              ?? null,
        humidity_pct:       d.relative_humidity_2m_mean?.[dayIndex] ?? null,
        // Grass + weed from Met Office (station data), score from Airmine (0–100)
        grass_pollen_label: grassLabel,
        grass_pollen_score: air?.grass?.score ?? null,
        weed_pollen_label:  dayIndex === 0 ? (metOfficePollen?.weed ?? null) : null,
        // Tree (birch) from Airmine — today and tomorrow only
        tree_pollen_label:  air?.birch?.label ?? null,
        tree_pollen_score:  air?.birch?.score ?? null,
        pollen_source:      dayIndex <= 1 ? 'metoffice+airmine' : 'metoffice-forecast',
        // AQI from Open-Meteo (reliable for PM/AQI)
        pm10:               a.pm10   ?? null,
        pm2_5:              a.pm2_5  ?? null,
        aqi:                aq,
        aqi_label:          aqiLabel(aq),
        fetched_at:         new Date().toISOString(),
        is_forecast:        dayIndex > 0,
      }
    }

    const { data: existing } = await supabase
      .from('user_data').select('value').eq('key', WEATHER_KEY).single()

    const allWeather = existing?.value ?? {}
    for (const [i, dateStr] of dates.entries()) {
      allWeather[dateStr] = buildDayWeather(dateStr, i)
    }

    await supabase.from('user_data').upsert(
      { key: WEATHER_KEY, user_id: USER_ID, value: allWeather, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )

    const built = Object.fromEntries(dates.map(d => [d, allWeather[d]]))
    return res.status(200).json({ ok: true, date: today, location: city, days: built })

  } catch (err) {
    console.error('[weather-fetch]', err)
    return res.status(500).json({ error: err.message })
  }
}
