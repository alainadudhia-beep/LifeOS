import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const USER_ID         = process.env.HEALTH_IMPORT_USER_ID
const COMMITMENTS_KEY = 'lifetracker-commitments'
const WEATHER_KEY     = 'lifetracker-weather'
const DEFAULT_CITY    = 'London'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function geocode(city) {
  const res  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)
  const json = await res.json()
  if (!json.results?.length) throw new Error(`Could not geocode: ${city}`)
  const { latitude: lat, longitude: lon } = json.results[0]
  return { lat, lon }
}

function grassPollenLabel(v) {
  if (v == null) return null
  if (v < 30)  return 'Low'
  if (v < 50)  return 'Medium'
  if (v < 150) return 'High'
  return 'Very High'
}

function treePollenLabel(v) {
  if (v == null) return null
  if (v < 15)   return 'Low'
  if (v < 90)   return 'Medium'
  if (v < 1500) return 'High'
  return 'Very High'
}

function aqiLabel(v) {
  if (v == null) return null
  if (v <= 20)  return 'Good'
  if (v <= 40)  return 'Fair'
  if (v <= 60)  return 'Moderate'
  if (v <= 80)  return 'Poor'
  return 'Very Poor'
}

function dateRange(start, end) {
  const dates = []
  const cur   = new Date(start)
  const last  = new Date(end)
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// ── Fetch air quality hourly → aggregate to daily max ────────────────────────

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
  const h    = json.hourly

  const vars  = ['grass_pollen', 'birch_pollen', 'alder_pollen', 'ragweed_pollen', 'pm10', 'pm2_5', 'european_aqi']
  const byDate = {}
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

// ── Fetch a group of dates for one city ──────────────────────────────────────

async function fetchGroupWeather(city, startDate, endDate) {
  const { lat, lon } = await geocode(city)

  const [forecastRes, airByDate] = await Promise.all([
    fetch(
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat}&longitude=${lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,uv_index_max` +
      `&timezone=auto`
    ).then(r => { if (!r.ok) throw new Error(`Archive API error: ${r.status}`); return r.json() }),
    fetchAirQualityForDates(lat, lon, startDate, endDate),
  ])

  const d       = forecastRes.daily
  const results = {}

  for (let i = 0; i < d.time.length; i++) {
    const date = d.time[i]
    const a    = airByDate[date] ?? {}
    const gp   = a.grass_pollen ?? null
    const bp   = a.birch_pollen ?? null
    const ap   = a.alder_pollen ?? null
    const aq   = a.european_aqi ?? null

    results[date] = {
      location:           city,
      temp_max:           d.temperature_2m_max?.[i]  ?? null,
      temp_min:           d.temperature_2m_min?.[i]  ?? null,
      precipitation_mm:   d.precipitation_sum?.[i]   ?? null,
      wind_speed_max:     d.windspeed_10m_max?.[i]   ?? null,
      uv_index:           d.uv_index_max?.[i]        ?? null,
      grass_pollen:       gp,
      grass_pollen_label: grassPollenLabel(gp),
      birch_pollen:       bp,
      birch_pollen_label: treePollenLabel(bp),
      alder_pollen:       ap,
      alder_pollen_label: treePollenLabel(ap),
      ragweed_pollen:     a.ragweed_pollen            ?? null,
      pm10:               a.pm10                      ?? null,
      pm2_5:              a.pm2_5                     ?? null,
      aqi:                aq,
      aqi_label:          aqiLabel(aq),
      fetched_at:         new Date().toISOString(),
    }
  }
  return results
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
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const startDate = req.query.start ?? '2026-04-13'
    const endDate   = req.query.end   ?? yesterday.toISOString().slice(0, 10)

    // Load commitments for location resolution
    const { data: commitmentsRow } = await supabase
      .from('user_data').select('value').eq('key', COMMITMENTS_KEY).single()
    const commitments = commitmentsRow?.value ?? []

    // Map each date to a city
    const dates = dateRange(startDate, endDate)
    const dateCityMap = {}
    for (const date of dates) {
      const active = commitments
        .filter(c => c.location && c.start_date <= date && c.end_date >= date)
        .sort((a, b) => b.start_date.localeCompare(a.start_date))
      dateCityMap[date] = active[0]?.location ?? DEFAULT_CITY
    }

    // Group consecutive dates by city
    const groups = []
    for (const date of dates) {
      const city = dateCityMap[date]
      const last = groups[groups.length - 1]
      if (last && last.city === city) {
        last.end = date
        last.dates.push(date)
      } else {
        groups.push({ city, start: date, end: date, dates: [date] })
      }
    }

    // Fetch each group and merge results
    const allNewWeather = {}
    for (const group of groups) {
      const results = await fetchGroupWeather(group.city, group.start, group.end)
      Object.assign(allNewWeather, results)
    }

    // Merge with existing — existing entries win (already had a live fetch)
    const { data: existing } = await supabase
      .from('user_data').select('value').eq('key', WEATHER_KEY).single()
    const merged = { ...allNewWeather, ...(existing?.value ?? {}) }

    await supabase.from('user_data').upsert(
      { key: WEATHER_KEY, user_id: USER_ID, value: merged, updated_at: new Date().toISOString() },
      { onConflict: 'key,user_id' }
    )

    const summary = groups.map(g => `${g.city}: ${g.start} → ${g.end} (${g.dates.length}d)`).join(' | ')
    return res.status(200).json({ ok: true, dates_filled: Object.keys(allNewWeather).length, groups: summary })

  } catch (err) {
    console.error('[weather-backfill]', err)
    return res.status(500).json({ error: err.message })
  }
}
