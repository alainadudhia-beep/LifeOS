// Temporary one-off utility — delete after use
// Clears all manually logged fields for a given date, keeping only health-sync fields.
import { createClient } from '@supabase/supabase-js'

const LIFE_LOGS_KEY = 'lifetracker-life-logs'
const INSIGHTS_KEY  = 'lifetracker-insights'
const USER_ID = process.env.HEALTH_IMPORT_USER_ID
const CRON_SECRET = process.env.CRON_SECRET

export default async function handler(req, res) {
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorised' })

  const { date } = req.query
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Missing or invalid date param' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const [logsRes, insightsRes] = await Promise.all([
    supabase.from('user_data').select('value').eq('key', LIFE_LOGS_KEY).eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', INSIGHTS_KEY).eq('user_id', USER_ID).single(),
  ])

  if (logsRes.error) return res.status(500).json({ error: logsRes.error.message })

  const logs = logsRes.data.value ?? {}
  const existing = logs[date] ?? {}

  // Keep only fields written by the health sync
  const healthSyncSleep = {}
  const sleepFields = ['hours','_fitbit_minutes','_in_bed_minutes','efficiency_pct','score','rem_minutes','deep_minutes','light_minutes','awake_minutes']
  for (const f of sleepFields) {
    if (existing.sleep?.[f] != null) healthSyncSleep[f] = existing.sleep[f]
  }

  const cleaned = {}
  if (Object.keys(healthSyncSleep).length) cleaned.sleep = healthSyncSleep
  if (existing.exercise?.steps != null) cleaned.exercise = { steps: existing.exercise.steps }

  logs[date] = cleaned

  // Clear today's insights too
  const insights = insightsRes.data?.value ?? []
  const filteredInsights = Array.isArray(insights)
    ? insights.filter(i => i.date !== date)
    : insights

  const [logsWrite, insightsWrite] = await Promise.all([
    supabase.from('user_data').upsert({ key: LIFE_LOGS_KEY, user_id: USER_ID, value: logs, updated_at: new Date().toISOString() }),
    supabase.from('user_data').upsert({ key: INSIGHTS_KEY,  user_id: USER_ID, value: filteredInsights, updated_at: new Date().toISOString() }),
  ])

  if (logsWrite.error) return res.status(500).json({ error: logsWrite.error.message })

  res.json({ ok: true, date, kept: cleaned, insightsCleared: !insightsWrite.error })
}
