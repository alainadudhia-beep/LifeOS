// Builds a compact context string from recent logs + track statuses for Claude

function daysAgo(n) {
  return new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() - n * 86400000))
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {} } catch { return {} }
}

export function buildCheckinContext() {
  const today = new Intl.DateTimeFormat('en-CA').format(new Date())
  const logs = readJson('lifetracker-life-logs')
  const tracksRaw = readJson('lifetracker-tracks-v3')
  const tracks = Array.isArray(tracksRaw) ? tracksRaw : Object.values(tracksRaw)

  const lines = []

  // ── Today so far (so Claude doesn't claim things are unlogged) ──
  const todayLog = logs[today]
  if (todayLog) {
    const parts = []
    if (todayLog.water?.glasses != null) parts.push(`water: ${todayLog.water.glasses} glasses`)
    if (todayLog.diet) {
      const d = todayLog.diet
      const dp = []
      if (d.fruit_veg) dp.push(`fruit/veg: ${d.fruit_veg}`)
      if (d.protein)   dp.push(`protein: ${d.protein}`)
      if (d.sugar)     dp.push(`sugar: ${d.sugar}`)
      if (d.caffeine)  dp.push(`caffeine: ${d.caffeine}`)
      if (dp.length)   parts.push(`diet: ${dp.join(', ')}`)
    }
    if (todayLog.exercise?.activities?.length) parts.push(`exercise: ${todayLog.exercise.activities.join(', ')}`)
    if (todayLog.mood) {
      const scores = ['work','life','energy','focus'].filter(k => todayLog.mood[k] != null).map(k => `${k}=${todayLog.mood[k]}`)
      if (scores.length) parts.push(`mood: ${scores.join(', ')}`)
    }
    if (todayLog.sleep?.hours) parts.push(`sleep: ${todayLog.sleep.hours}hrs`)
    if (parts.length) {
      lines.push('Logged today so far: ' + parts.join(' | '))
    }
  }

  // ── Recent life logs (last 7 days, excluding today) ──
  const recentDays = []
  for (let i = 1; i <= 7; i++) {
    const iso = daysAgo(i)
    const log = logs[iso]
    if (!log) continue
    const parts = []
    if (log.exercise?.activities?.length) parts.push(`exercise: ${log.exercise.activities.join(', ')}`)
    if (log.mood) {
      const scores = ['work', 'life', 'energy', 'focus'].filter(k => log.mood[k] != null).map(k => `${k}=${log.mood[k]}`)
      if (scores.length) parts.push(`mood: ${scores.join(', ')}`)
    }
    if (log.sleep?.hours) parts.push(`sleep: ${log.sleep.hours}hrs${log.sleep.quality ? ' ' + log.sleep.quality : ''}`)
    if (log.health?.eczema && log.health.eczema !== 'None') parts.push(`eczema: ${log.health.eczema}`)
    if (parts.length) recentDays.push(`  ${iso}: ${parts.join(' | ')}`)
  }
  if (recentDays.length) {
    lines.push('Recent life logs (last 7 days):')
    lines.push(...recentDays)
  }

  // ── Career tracks ──
  const activeTracks = tracks.filter(t => {
    if (t.archived) return false
    const status = t.status_history?.length
      ? t.status_history[t.status_history.length - 1].status
      : t.status
    return status && status !== 'closed' && status !== 'secured'
  })
  if (activeTracks.length) {
    lines.push('\nActive career tracks:')
    for (const t of activeTracks) {
      const status = t.status_history?.length
        ? t.status_history[t.status_history.length - 1].status
        : t.status
      const lastNote = t.notes_log?.[0]?.text
      const upcoming = (t.milestones ?? [])
        .filter(m => m.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 2)
        .map(m => `${m.label} on ${m.date}`)
        .join(', ')
      lines.push(`  "${t.name}" - status: ${status}${lastNote ? ` | last note: "${lastNote.slice(0, 80)}"` : ''}${upcoming ? ` | upcoming: ${upcoming}` : ''}`)
    }
  }

  return lines.length ? '\n\n' + lines.join('\n') : ''
}
