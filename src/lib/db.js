import { supabase } from './supabase'

const DATA_KEYS = [
  'lifetracker-tracks-v3',
  'lifetracker-commitments',
  'lifetracker-life-logs',
  'lifetracker-thisweek-v1',
  'lifetracker-insights',
  'lifetracker-dismissed-track-actions',
]

export async function preloadAllKeys() {
  await Promise.all(DATA_KEYS.map(async key => {
    const value = await dbRead(key)
    if (value !== null) localStorage.setItem(key, JSON.stringify(value))
  }))
}

export async function dbRead(key) {
  const { data, error } = await supabase
    .from('user_data')
    .select('value, updated_at')
    .eq('key', key)
    .single()
  if (error || !data) return null
  return data.value
}

export async function dbWrite(key, value) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase
    .from('user_data')
    .upsert({ key, user_id: user.id, value, updated_at: new Date().toISOString() },
             { onConflict: 'key,user_id' })
  if (error) console.error('[db] write error', key, error)
}

let _migrating = false

export async function migrateToSupabase() {
  if (_migrating) return
  if (localStorage.getItem('lifetracker-supabase-migrated')) return
  _migrating = true

  const { data: existing } = await supabase.from('user_data').select('key')
  const existingKeys = new Set((existing ?? []).map(r => r.key))

  for (const key of DATA_KEYS) {
    if (existingKeys.has(key)) continue
    const raw = localStorage.getItem(key)
    if (!raw) continue
    try {
      await dbWrite(key, JSON.parse(raw))
      console.log('[db] migrated', key)
    } catch (e) {
      console.error('[db] migration failed for', key, e)
    }
  }

  localStorage.setItem('lifetracker-supabase-migrated', '1')
  console.log('[db] migration complete')
}
