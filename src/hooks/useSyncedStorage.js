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

  // On mount, pull from Supabase and overwrite local if it has data
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session || cancelled) return
      dbRead(key).then(result => {
        if (result === null || cancelled) return
        localStorage.setItem(key, JSON.stringify(result))
        setValue_(result)
      })
    })
    return () => { cancelled = true }
  }, [key])

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
