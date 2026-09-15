import { useState, useEffect, useRef } from 'react'
import { dbRead, dbReadMeta, dbWrite } from '../lib/db'
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
  const SYNC_GRACE_MS = 5 * 60 * 1000  // 5 minutes

  // ── Serial write queue ────────────────────────────────────────────────────
  // Only one write in-flight at a time; the latest pending value always wins.
  // This prevents a slow older write from overwriting a newer one in Supabase.
  const inflightRef = useRef(false)
  const pendingRef  = useRef(null) // { value } of next write to send

  // Gate: true once the initial pull (or grace-period skip) is resolved.
  // Writes are held until then so a stale local state can never overwrite
  // a newer Supabase value that a concurrent pull is about to return.
  const syncReadyRef = useRef(false)

  async function scheduleWrite(toStore) {
    markPending(key)                      // persist intent — survives page refresh
    pendingRef.current = { value: toStore }
    if (inflightRef.current) return       // in-flight write will pick up pending
    inflightRef.current = true
    // Wait for the initial pull to settle before writing (max 5 s then proceed)
    const deadline = Date.now() + 5000
    while (!syncReadyRef.current && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 30))
    }
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
    // Bypass the grace period if local data is empty — it's never correct to
    // show nothing when Supabase has data, even if we wrote recently.
    const localIsEmpty = !valueRef.current
      || (typeof valueRef.current === 'object' && !Array.isArray(valueRef.current) && Object.keys(valueRef.current).length === 0)
    if (!localIsEmpty && Date.now() - lastWriteRef.current < SYNC_GRACE_MS) {
      syncReadyRef.current = true   // grace period active — local is authoritative, writes can proceed
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session || cancelled.current) { syncReadyRef.current = true; return }
      dbRead(key).then(result => {
        if (result === null || cancelled.current) { syncReadyRef.current = true; return }
        const nowEmpty = !valueRef.current
          || (typeof valueRef.current === 'object' && !Array.isArray(valueRef.current) && Object.keys(valueRef.current).length === 0)
        if (!nowEmpty && Date.now() - lastWriteRef.current < SYNC_GRACE_MS) { syncReadyRef.current = true; return }
        localStorage.setItem(key, JSON.stringify(result))
        setValue_(result)
        syncReadyRef.current = true  // pull complete — safe to write
      }).catch(() => { syncReadyRef.current = true })
    }).catch(() => { syncReadyRef.current = true })
  }

  // On mount: retry any write that was in-flight when the page last closed,
  // then do the normal Supabase pull.
  //
  // Safety rule: only write local → Supabase if our local LWT is strictly newer
  // than Supabase's updated_at. This prevents stale localStorage from silently
  // overwriting good server data (e.g. after a forceSync cleared the LWT).
  useEffect(() => {
    const cancelled = { current: false }
    syncReadyRef.current = false          // hold writes until pull settles
    const localTs = lastWriteRef.current // 0 if LWT was cleared

    if (hasPending(key) && localTs > 0) {
      // Compare timestamps before writing to Supabase.
      dbReadMeta(key)
        .then(meta => {
          if (cancelled.current) return
          const serverTs = meta?.updatedAtMs ?? 0
          if (localTs > serverTs) {
            // Local data is genuinely newer — safe to retry the write.
            dbWrite(key, valueRef.current)
              .then(() => clearPending(key))
              .catch(err => console.error('[useSyncedStorage] retry error', key, err))
              .finally(() => { if (!cancelled.current) pullFromSupabase(cancelled) })
          } else {
            // Supabase is newer or equal — pull it, don't overwrite.
            clearPending(key)
            if (!cancelled.current) pullFromSupabase(cancelled)
          }
        })
        .catch(() => {
          // Can't read Supabase — safe default is to pull (not write).
          if (!cancelled.current) pullFromSupabase(cancelled)
        })
    } else {
      // No pending write, or LWT was cleared (e.g. by forceSync) — just pull.
      if (hasPending(key)) clearPending(key)
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

  // Refresh state from localStorage (e.g. after an external write by applyCheckin)
  // without scheduling a redundant Supabase write. Updates valueRef immediately so
  // any subsequent functional setters see the fresh value as their base.
  function refreshFromStorage() {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw)
      valueRef.current = parsed
      setValue_(parsed)
    } catch {}
  }

  return [value, setValue, refreshFromStorage]
}
