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
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
  const res  = await fetch(url)
  const json = await res.json()
  if (!json.results?.length) throw new Error(`Could not geocode: ${city}`)
  const { latitude: lat, longitude: lon } = json.results[0]
  return { lat, lon }
}

// ── Label helpers ────────────────────────────────────────────────────────────

// UK Met Office grass pollen thresholds (grains/m³)
function grassPollenLabel(v) {
  if (v == null) return null
  if (v < 30)  return 'Low'
  if (v < 50)  return 'Medium'
  if (v < 150) return 'High'
  return 'Very High'
}

// UK Met Office tree pollen thresholds (grains/m³)
function treePollenLabel(v) {
  if (v == null) return null
  if (v < 15)   return 'Low'
  if (v < 90)   return 'Medium'
  if (v < 1500) return 'High'
  return 'Very High'
}

// European AQI (0–100 scale from Open-Meteo)
function aqiLabel(v) {
  if (v == null) return null
  if (v <= 20)  return 'Good'
  if (v <= 40)  return 'Fair'
  if (v <= 60)  return 'Moderate'
  if (v <= 80)  return 'Poor'
  return 'Very Poor'
}

// ── Location resolution ──────────────────────────────────────────────────────

async function resolveLocation(today) {
  const { data } = await supabase
    .from('user_data')
    .select('value')
    .eq('key', COMMITMENTS_KEY)
    .single()

  const commitments = data?.value ?? []

  // Active commitment with a location field — most recently started takes priority
  const active = commitments
    .filter(c => c.location && c.start_date <= today && c.end_date >= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))

  return active[0]?.location ?? DEFAULT_CITY
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  // Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>
  // Manual trigger: pass ?secret=<CRON_SECRET> in query string
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization']
    const querySecret = req.query?.secret
    const bearerOk = authHeader === `Bearer ${process.env.CRON_SECRET}`
    const queryOk  = querySecret === process.env.CRON_SECRET
    if (!bearerOk && !queryOk) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  try {
    const today = new Date().toISOString().slice(0, 10)

    // 1. Resolve city
    const city = await resolveLocation(today)

    // 2. Geocode
    const { lat, lon } = await geocode(city)

    // 3. Fetch weather forecast + air quality in parallel (no API keys needed)
    const [forecastRes, airRes] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,uv_index_max` +
        `&timezone=auto&forecast_days=1`
      ),
      fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality` +
        `?latitude=${lat}&longitude=${lon}` +
        `&daily=grass_pollen,birch_pollen,alder_pollen,ragweed_pollen,pm10,pm2_5,european_aqi` +
        `&timezone=auto&forecast_days=1`
      ),
    ])

    if (!forecastRes.ok) throw new Error(`Forecast API error: ${forecastRes.status}`)
    if (!airRes.ok)      throw new Error(`Air quality API error: ${airRes.status}`)

    const [forecast, air] = await Promise.all([forecastRes.json(), airRes.json()])

    const d = forecast.daily
    const a = air.daily

    const grassPollen = a.grass_pollen?.[0]   ?? null
    const birchPollen = a.birch_pollen?.[0]   ?? null
    const alderPollen = a.alder_pollen?.[0]   ?? null
    const ragweedPollen = a.ragweed_pollen?.[0] ?? null
    const aqi         = a.european_aqi?.[0]   ?? null

    const weather = {
      location:           city,
      temp_max:           d.temperature_2m_max?.[0]  ?? null,
      temp_min:           d.temperature_2m_min?.[0]  ?? null,
      precipitation_mm:   d.precipitation_sum?.[0]   ?? null,
      wind_speed_max:     d.windspeed_10m_max?.[0]   ?? null,  // km/h
      uv_index:           d.uv_index_max?.[0]        ?? null,
      grass_pollen:       grassPollen,
      grass_pollen_label: grassPollenLabel(grassPollen),
      birch_pollen:       birchPollen,
      birch_pollen_label: treePollenLabel(birchPollen),
      alder_pollen:       alderPollen,
      alder_pollen_label: treePollenLabel(alderPollen),
      ragweed_pollen:     ragweedPollen,
      pm10:               a.pm10?.[0]    ?? null,
      pm2_5:              a.pm2_5?.[0]   ?? null,
      aqi,
      aqi_label:          aqiLabel(aqi),
      fetched_at:         new Date().toISOString(),
    }

    // 4. Merge into existing weather store (one key, date-indexed object)
    const { data: existing } = await supabase
      .from('user_data')
      .select('value')
      .eq('key', WEATHER_KEY)
      .single()

    const allWeather = existing?.value ?? {}
    allWeather[today] = weather

    await supabase
      .from('user_data')
      .upsert(
        { key: WEATHER_KEY, user_id: USER_ID, value: allWeather, updated_at: new Date().toISOString() },
        { onConflict: 'key,user_id' }
      )

    return res.status(200).json({ ok: true, date: today, location: city, weather })

  } catch (err) {
    console.error('[weather-fetch]', err)
    return res.status(500).json({ error: err.message })
  }
}
