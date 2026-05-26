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

// ── Label helpers ─────────────────────────────────────────────────────────────

// Map Google Pollen API category strings to our internal label format
function googlePollenLabel(category) {
  if (!category || category === 'None' || category === 'Very Low') return 'Low'
  if (category === 'Low')      return 'Low'
  if (category === 'Moderate') return 'Medium'
  if (category === 'High')     return 'High'
  return 'Very High'
}

// Fetch pollen from Google Pollen API (forecast only — accurate measured+modelled data)
async function fetchGooglePollen(lat, lon) {
  const apiKey = process.env.GOOGLE_POLLEN_API_KEY
  if (!apiKey) return null
  const res = await fetch(
    `https://pollen.googleapis.com/v1/forecast:lookup` +
    `?key=${apiKey}&location.latitude=${lat}&location.longitude=${lon}&days=2&languageCode=en`
  )
  if (!res.ok) {
    console.warn('[weather-fetch] Google Pollen API error:', res.status)
    return null
  }
  const json = await res.json()

  // Build { 'YYYY-MM-DD': { GRASS: 'High', TREE: 'Medium', WEED: 'Low' } }
  const byDate = {}
  for (const day of (json.dailyInfo ?? [])) {
    const { year, month, day: d } = day.date
    const iso = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    byDate[iso] = {}
    for (const plant of (day.plantInfo ?? [])) {
      byDate[iso][plant.code] = plant.indexInfo?.category ?? null
    }
  }
  return byDate
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
    const today    = new Date().toISOString().slice(0, 10)
    const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1)
    const tomorrow = tomorrowD.toISOString().slice(0, 10)

    const city         = await resolveLocation(today)
    const { lat, lon } = await geocode(city)

    // Fetch forecast, air quality, and Google pollen in parallel
    const [forecastRes, airByDate, googlePollen] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,uv_index_max,relative_humidity_2m_mean` +
        `&timezone=auto&forecast_days=2`
      ).then(r => { if (!r.ok) throw new Error(`Forecast API error: ${r.status}`); return r.json() }),
      fetchAirQualityForDates(lat, lon, today, tomorrow),
      fetchGooglePollen(lat, lon),
    ])

    function buildDayWeather(dateStr, dayIndex) {
      const d  = forecastRes.daily
      const a  = airByDate[dateStr] ?? {}
      const gp = googlePollen?.[dateStr] ?? {}
      const aq = a.european_aqi ?? null
      return {
        location:           city,
        temp_max:           d.temperature_2m_max?.[dayIndex]       ?? null,
        temp_min:           d.temperature_2m_min?.[dayIndex]       ?? null,
        precipitation_mm:   d.precipitation_sum?.[dayIndex]        ?? null,
        wind_speed_max:     d.windspeed_10m_max?.[dayIndex]        ?? null,
        uv_index:           d.uv_index_max?.[dayIndex]             ?? null,
        humidity_pct:       d.relative_humidity_2m_mean?.[dayIndex] ?? null,
        // Pollen from Google (accurate) — falls back to null if API unavailable
        grass_pollen_label: googlePollenLabel(gp.GRASS),
        tree_pollen_label:  googlePollenLabel(gp.TREE),
        weed_pollen_label:  googlePollenLabel(gp.WEED),
        pollen_source:      googlePollen ? 'google' : 'none',
        // AQI from Open-Meteo (reliable for PM/AQI)
        pm10:               a.pm10   ?? null,
        pm2_5:              a.pm2_5  ?? null,
        aqi:                aq,
        aqi_label:          aqiLabel(aq),
        fetched_at:         new Date().toISOString(),
        is_forecast:        true,
      }
    }

    const todayWeather    = buildDayWeather(today,    0)
    const tomorrowWeather = buildDayWeather(tomorrow, 1)

    const { data: existing } = await supabase
      .from('user_data').select('value').eq('key', WEATHER_KEY).single()

    const allWeather = existing?.value ?? {}
    allWeather[today]    = todayWeather
    allWeather[tomorrow] = tomorrowWeather

    await supabase.from('user_data').upsert(
      { key: WEATHER_KEY, user_id: USER_ID, value: allWeather, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )

    return res.status(200).json({ ok: true, date: today, location: city, today: todayWeather, tomorrow: tomorrowWeather })

  } catch (err) {
    console.error('[weather-fetch]', err)
    return res.status(500).json({ error: err.message })
  }
}
