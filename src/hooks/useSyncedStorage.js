import { useState, useEffect, useRef } from 'react'
import { dbRead, dbWrite } from '../lib/db'
import { supabase } from '../lib/supabase'

// Keys whose latest value needs to reach Supabase even if the page was closed mid-write.
// On next mount, any pending entry is retried before the normal Supabase pull.
const PENDING_KEY = 'lifetracker-pending-writes'

function markPending(key) {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}')
    p[key] = true
    localStorage.setItem(PENDING_KEY, JSON.stringify(p))
  } catch {}
}

function clearPending(key) {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}')
    delete p[key]
    localStorage.setItem(PENDING_KEY, JSON.stringify(p))
  } catch {}
}

function hasPending(key) {
  try {
    return !!JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}')[key]
  } catch { return false }
}

export function useSyncedStorage(key, initialValue) {
  const [value, setValue_] = useState(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch {
      return initialValue
    }
  })

  const valueRef    = useRef(value)
  valueRef.current  = value
  // Tracks the timestamp of the most recent local write so we never let a
  // stale Supabase pull overwrite data the user just saved.
  const lastWriteRef = useRef(Number(localStorage.getItem(`${key}:lwt`) ?? 0))

  // How long after a local write we trust localStorage over Supabase.
  const SYNC_GRACE_MS = 30 * 60 * 1000  // 30 minutes

  // ── Serial write queue ────────────────────────────────────────────────────
  // Only one write in-flight at a time; the latest pending value always wins.
  // This prevents a slow older write from overwriting a newer one in Supabase.
  const inflightRef = useRef(false)
  const pendingRef  = useRef(null) // { value } of next write to send

  async function scheduleWrite(toStore) {
    markPending(key)                      // persist intent — survives page refresh
    pendingRef.current = { value: toStore }
    if (inflightRef.current) return       // in-flight write will pick up pending
    inflightRef.current = true
    while (pendingRef.current !== null) {
      const { value: toWrite } = pendingRef.current
      pendingRef.current = null
      try {
        await dbWrite(key, toWrite)
        clearPending(key)                 // success — no retry needed
      } catch (err) {
        console.error('[useSyncedStorage] write error', key, err)
        // pending marker stays so the next mount will retry
      }
    }
    inflightRef.current = false
  }
  // ─────────────────────────────────────────────────────────────────────────

  function pullFromSupabase(cancelled = { current: false }) {
    if (Date.now() - lastWriteRef.current < SYNC_GRACE_MS) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session || cancelled.current) return
      dbRead(key).then(result => {
        if (result === null || cancelled.current) return
        if (Date.now() - lastWriteRef.current < SYNC_GRACE_MS) return
        localStorage.setItem(key, JSON.stringify(result))
        setValue_(result)
      })
    })
  }

  // On mount: retry any write that was in-flight when the page last closed,
  // then do the normal Supabase pull.
  useEffect(() => {
    const cancelled = { current: false }
    if (hasPending(key)) {
      // The localStorage value IS the authoritative latest — write it to Supabase.
      dbWrite(key, valueRef.current)
        .then(() => clearPending(key))
        .catch(err => console.error('[useSyncedStorage] retry error', key, err))
        .finally(() => { if (!cancelled.current) pullFromSupabase(cancelled) })
    } else {
      pullFromSupabase(cancelled)
    }
    return () => { cancelled.current = true }
  }, [key]) // eslint-disable-line

  // Re-sync when the page becomes visible (e.g. switching back from another app/tab)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') pullFromSupabase()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [key]) // eslint-disable-line

  function setValue(val) {
    const toStore = val instanceof Function ? val(valueRef.current) : val
    const ts = Date.now()
    lastWriteRef.current = ts
    localStorage.setItem(`${key}:lwt`, String(ts))
    setValue_(toStore)
    localStorage.setItem(key, JSON.stringify(toStore))
    scheduleWrite(toStore)
    if (key === 'lifetracker-life-logs')  window.dispatchEvent(new CustomEvent('lifetracker-logs-updated'))
    if (key === 'lifetracker-tracks-v3') window.dispatchEvent(new CustomEvent('lifetracker-tracks-updated'))
  }

  return [value, setValue]
}
