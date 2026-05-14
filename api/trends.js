// GET /api/trends — returns stored trend findings for the frontend.
// Data is written daily at 7am by the trends-compute cron.
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const USER_ID   = process.env.HEALTH_IMPORT_USER_ID
const TRENDS_KEY = 'lifetracker-trends'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { data, error } = await supabase
    .from('user_data')
    .select('value')
    .eq('key', TRENDS_KEY)
    .eq('user_id', USER_ID)
    .single()

  if (error || !data?.value) {
    return res.status(200).json({ ok: true, findings: [], n_days: 0, computed_at: null })
  }

  return res.status(200).json({ ok: true, ...data.value })
}
