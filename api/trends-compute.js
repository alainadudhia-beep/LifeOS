// Cron: runs at 7am daily. Computes all correlations and stores to lifetracker-trends.
import { createClient } from '@supabase/supabase-js'
import { computeTrends } from './compute-trends.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const USER_ID       = process.env.HEALTH_IMPORT_USER_ID
const TRENDS_KEY    = 'lifetracker-trends'
const CRON_SECRET   = process.env.CRON_SECRET

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const [logsRow, weatherRow, fitbitRow] = await Promise.all([
    supabase.from('user_data').select('value').eq('key', 'lifetracker-life-logs').eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', 'lifetracker-weather').eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', 'lifetracker-fitbit-raw').eq('user_id', USER_ID).single(),
  ])

  const result = computeTrends(
    logsRow.data?.value    ?? {},
    weatherRow.data?.value ?? {},
    fitbitRow.data?.value  ?? {}
  )

  await supabase.from('user_data').upsert(
    { key: TRENDS_KEY, user_id: USER_ID, value: result, updated_at: new Date().toISOString() },
    { onConflict: 'key,user_id' }
  )

  console.log(`[trends-compute] Done. ${result.findings.length} findings across ${result.n_days} days.`)
  return res.status(200).json({ ok: true, n_findings: result.findings.length, n_days: result.n_days })
}
