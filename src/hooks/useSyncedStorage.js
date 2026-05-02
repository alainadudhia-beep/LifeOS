import { useState, useEffect, useRef } from 'react'
import { dbRead, dbWrite } from '../lib/db'
import { supabase } from '../lib/supabase'

export function useSyncedStorage(key, initialValue) {
  const [value, setValue_] = useState(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch {
      return initialValue
    }
  })

  const valueRef = useRef(value)
  valueRef.current = value

  // Pull from Supabase and overwrite local if it has data
  function pullFromSupabase(cancelled = { current: false }) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session || cancelled.current) return
      dbRead(key).then(result => {
        if (result === null || cancelled.current) return
        localStorage.setItem(key, JSON.stringify(result))
        setValue_(result)
      })
    })
  }

  // On mount, pull from Supabase
  useEffect(() => {
    const cancelled = { current: false }
    pullFromSupabase(cancelled)
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
    setValue_(toStore)
    localStorage.setItem(key, JSON.stringify(toStore))
    dbWrite(key, toStore).catch(err => console.error('[useSyncedStorage] write error', key, err))
    if (key === 'lifetracker-life-logs')  window.dispatchEvent(new CustomEvent('lifetracker-logs-updated'))
    if (key === 'lifetracker-tracks-v3') window.dispatchEvent(new CustomEvent('lifetracker-tracks-updated'))
  }

  return [value, setValue]
}
