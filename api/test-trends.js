// Temporary test endpoint — remove before merging to main.
// Run via: vercel dev (in main project dir), then: curl http://localhost:3000/api/test-trends
import { createClient } from '@supabase/supabase-js'
import { computeTrends } from './compute-trends.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const USER_ID = process.env.HEALTH_IMPORT_USER_ID

export default async function handler(req, res) {
  if (req.headers['x-test-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const [logsRow, weatherRow, fitbitRow] = await Promise.all([
    supabase.from('user_data').select('value').eq('key', 'lifetracker-life-logs').eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', 'lifetracker-weather').eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', 'lifetracker-fitbit-raw').eq('user_id', USER_ID).single(),
  ])

  const logs         = logsRow.data?.value    ?? {}
  const weatherStore = weatherRow.data?.value ?? {}
  const fitbitRaw    = fitbitRow.data?.value  ?? {}

  const result = computeTrends(logs, weatherStore, fitbitRaw)
  return res.status(200).json(result)
}
