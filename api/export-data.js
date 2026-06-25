import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const USER_ID       = process.env.HEALTH_IMPORT_USER_ID
const LIFE_LOGS_KEY = 'lifetracker-life-logs'
const WEATHER_KEY   = 'lifetracker-weather'
const FITBIT_KEY    = 'lifetracker-fitbit-raw'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const secret = req.headers['x-export-secret']
  if (!secret || secret !== process.env.EXPORT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!USER_ID) return res.status(500).json({ error: 'Server misconfigured: missing HEALTH_IMPORT_USER_ID' })

  const [logsRes, weatherRes, fitbitRes] = await Promise.all([
    supabase.from('user_data').select('value').eq('key', LIFE_LOGS_KEY).eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', WEATHER_KEY).eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', FITBIT_KEY).eq('user_id', USER_ID).single(),
  ])

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    logs:    logsRes.data?.value    || {},
    weather: weatherRes.data?.value || {},
    fitbit:  fitbitRes.data?.value  || {},
  })
}
