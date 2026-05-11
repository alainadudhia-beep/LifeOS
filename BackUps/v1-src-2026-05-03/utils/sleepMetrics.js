// Derives sleep metrics from life-logs sleep object and/or fitbit-raw day object.
// Both arguments are optional — pass what you have.
//
// Usage:
//   const metrics = getSleepMetrics(logs[date]?.sleep, fitbitRaw[date])
//   → { hours, asleepMinutes, inBedMinutes, efficiencyPct }

export function getSleepMetrics(sleepLog, fitbitRaw) {
  const asleepMinutes = sleepLog?._fitbit_minutes ?? fitbitRaw?.sleep_minutes ?? null
  const inBedMinutes  = sleepLog?._in_bed_minutes ?? fitbitRaw?.in_bed_minutes ?? null
  const efficiencyPct = sleepLog?.efficiency_pct
    ?? (asleepMinutes != null && inBedMinutes != null
        ? Math.round((asleepMinutes / inBedMinutes) * 100)
        : null)

  return {
    hours: sleepLog?.hours ?? null,
    asleepMinutes,
    inBedMinutes,
    efficiencyPct,
  }
}

// Formats minutes as "7h 38m" or "7h" if no remainder
export function formatMinutes(minutes) {
  if (minutes == null) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// Returns an efficiency label and colour for display
export function efficiencyLabel(pct) {
  if (pct == null) return null
  if (pct >= 85) return { label: 'Efficient', color: '#bbf7d0' }
  if (pct >= 70) return { label: 'Fair',      color: '#fef9c3' }
  return               { label: 'Restless',   color: '#fde8c8' }
}
