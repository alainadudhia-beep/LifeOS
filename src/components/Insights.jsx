import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import './Insights.css'

const INSIGHTS_KEY = 'lifetracker-insights'

function loadInsights() {
  try {
    const data = JSON.parse(localStorage.getItem(INSIGHTS_KEY))
    if (!Array.isArray(data)) return []
    return data.filter(it => it && it.id && it.text && it.type)
  } catch { return [] }
}
function saveInsights(items) {
  try { localStorage.setItem(INSIGHTS_KEY, JSON.stringify(items)) } catch {}
}

// Extract the topic label from an insight text (the part before ' - ' or ' — ')
function insightTopic(text) {
  const sep = text.search(/\s[—-]\s/)
  if (sep !== -1 && sep <= 30) return text.slice(0, sep).toLowerCase().trim()
  return text.slice(0, 20).toLowerCase().trim()
}

const TOPIC_STOPWORDS = new Set(['this', 'that', 'with', 'your', 'have', 'been', 'from', 'will', 'also', 'into', 'more', 'week'])

// Returns true if two topic strings share a meaningful word (length >= 4, not a stopword)
function topicsOverlap(a, b) {
  const words = t => t.toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !TOPIC_STOPWORDS.has(w))
  const wb = new Set(words(b))
  return words(a).some(w => wb.has(w))
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function readLogs()   { try { return JSON.parse(localStorage.getItem('lifetracker-life-logs')) ?? {} } catch { return {} } }
function readTracks() { try { const r = JSON.parse(localStorage.getItem('lifetracker-tracks-v3')); return Array.isArray(r) ? r : Object.values(r ?? {}) } catch { return [] } }

// ── Auto-computed insights ────────────────────────────────────────────────────

function computeAutoInsights(logs) {
  const out = []
  const days = Array.from({ length: 7 }, (_, i) => ({ iso: daysAgo(i), log: logs[daysAgo(i)] ?? null }))
  const logged = days.filter(d => d.log)
  if (!logged.length) return out

  // Sleep
  const sleepDays = logged.filter(d => d.log.sleep?.hours)
  if (sleepDays.length >= 2) {
    const good = sleepDays.filter(d => ['7','8','9+'].includes(d.log.sleep?.hours))
    const poor = sleepDays.filter(d => ['<5','5','6'].includes(d.log.sleep?.hours))
    if (good.length >= 2 && good.length >= sleepDays.length * 0.7)
      out.push({ id: 'auto-sleep-good', positive: true,  text: `Sleep - solid, ${good.length}/${sleepDays.length} logged nights at 7hrs+` })
    else if (poor.length >= 3)
      out.push({ id: 'auto-sleep-low',  positive: false, text: `Sleep - under 7hrs most nights this week, worth aiming for an earlier bedtime` })
  }

  // Water
  const waterDays = logged.filter(d => d.log.water?.glasses)
  if (waterDays.length >= 3) {
    const high = waterDays.filter(d => d.log.water?.glasses === '7+')
    const low  = waterDays.filter(d => d.log.water?.glasses === '<3')
    if (high.length >= 3)
      out.push({ id: 'auto-water-good', positive: true,  text: `Hydration - staying well hydrated, 7+ glasses most days` })
    else if (low.length >= 3)
      out.push({ id: 'auto-water-low',  positive: false, text: `Hydration - low most of this week, try to have some more water today` })
  }

  // Exercise
  const exDays = logged.filter(d => d.log.exercise?.activities?.length || (d.log.exercise?.steps ?? 0) > 4000)
  if (exDays.length >= 2)
    out.push({ id: 'auto-ex-good', positive: true,  text: `Active week - moved your body ${exDays.length} times in the last 7 days` })
  else {
    const daysSince = exDays.length ? days.findIndex(d => d.iso === exDays[0].iso) : 7
    if (daysSince >= 4)
      out.push({ id: 'auto-ex-gap', positive: false, text: `Exercise - nothing logged in ${daysSince} days, maybe worth doing some yoga soon` })
  }

  // Mood
  const moodDays = logged.filter(d => d.log.mood)
  if (moodDays.length >= 3) {
    const scores = moodDays.flatMap(d => ['work','life','energy','focus'].map(k => d.log.mood[k]).filter(v => v != null))
    if (scores.length) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      if (avg >= 3.7)
        out.push({ id: 'auto-mood-good', positive: true, text: `Mood - consistently good this week` })
      else if (avg < 2.5)
        out.push({ id: 'auto-mood-low',  positive: false, text: `Mood - has been a bit low this week, be kind to yourself` })
    }
  }

  // Cycle - period ended
  const periodDays    = logged.filter(d => d.log.cycle?.period === true)
  const noPeriodToday = logged[0] && logged[0].log.cycle?.period === false
  if (periodDays.length > 0 && noPeriodToday)
    out.push({ id: 'auto-cycle-done', positive: true, text: `Period - over, woohoo! 🎉` })

  return out
}

// ── Emoji for insight type ────────────────────────────────────────────────────

function insightEmoji(item) {
  if (item.completed) return '✅'
  const t = (item.text + ' ' + (item.id ?? '')).toLowerCase()
  if (t.includes('sleep') || t.includes('bed'))                            return '😴'
  if (t.includes('water') || t.includes('hydrat'))                        return '💧'
  if (t.includes('exercise') || t.includes('walk') || t.includes('yoga') || t.includes('pilates') || t.includes('gym') || t.includes('step') || t.includes('active')) return '🏃'
  if (t.includes('mood') || t.includes('energy') || t.includes('focus'))  return '🧠'
  if (t.includes('period') || t.includes('cycle'))                        return '🌸'
  if (t.includes('diet') || t.includes('food') || t.includes('fruit') || t.includes('sugar') || t.includes('protein')) return '🥗'
  if (t.includes('water'))                                                 return '💧'
  if (t.includes('health') || t.includes('eczema') || t.includes('hayfever') || t.includes('symptom')) return '💊'
  if (item.type === 'track')                                               return '💼'
  if (item.positive)                                                       return '⭐'
  return '📌'
}

// ── Status completion labels ──────────────────────────────────────────────────

function completionLabel(trackName, status) {
  switch (status) {
    case 'waiting':     return { text: `${trackName} - sent off, waiting on a response`,  positive: true  }
    case 'secured':     return { text: `${trackName} - secured! Great work 🎉`,            positive: true  }
    case 'in_progress': return { text: `${trackName} - back in progress`,                  positive: true  }
    case 'closed':      return { text: `${trackName} - closed`,                            positive: false }
    case 'on_hold':     return { text: `${trackName} - on hold for now`,                   positive: false }
    default:            return null
  }
}

// ── Component ────────────────────────────────────────────────────────────────

const Insights = forwardRef(function Insights(_, ref) {
  const [items, setItemsRaw] = useState(loadInsights)
  const [autoInsights, setAutoInsights] = useState([])

  function setItems(fn) {
    setItemsRaw(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      saveInsights(next)
      return next
    })
  }

  // Belt-and-suspenders: also sync to localStorage after every render
  useEffect(() => { saveInsights(items) }, [items])

  function refreshAuto() {
    setAutoInsights(computeAutoInsights(readLogs()))
  }

  function syncTrackActions(tracks) {
    const actionTracks = tracks.filter(t => {
      if (t.archived) return false
      const hist   = t.status_history
      const status = hist?.length ? hist[hist.length - 1].status : t.status
      const open   = hist?.length ? !hist[hist.length - 1].end_date : true
      return status === 'action_required' && open
    })
    setItems(prev => {
      const existingIds = new Set(prev.map(it => it.track_id).filter(Boolean))
      const toAdd = actionTracks
        .filter(t => !existingIds.has(t.id))
        .map(t => {
          const lastNote = t.notes_log?.[0]?.text
          const text = lastNote && lastNote.length <= 80
            ? `${t.name} - ${lastNote}`
            : `${t.name} - action required`
          return {
            id: `ins-track-${t.id}`,
            type: 'track',
            track_id: t.id,
            text,
            positive: false,
            completed: false,
            completed_at: null,
            created_at: new Date().toISOString(),
          }
        })
      return toAdd.length ? [...prev, ...toAdd] : prev
    })
  }

  function autoCompleteTrackInsights(tracks) {
    setItems(prev => {
      let changed = false
      const next = prev.map(item => {
        if (item.completed || item.type !== 'track' || !item.track_id) return item
        const track  = tracks.find(t => t.id === item.track_id)
        if (!track) return item
        const hist   = track.status_history
        const status = hist?.length ? hist[hist.length - 1].status : track.status
        // Auto-complete whenever track moves away from action_required
        if (status !== 'action_required') {
          changed = true
          const label = completionLabel(track.name, status) ?? { text: `${track.name} - updated`, positive: true }
          return { ...item, completed: true, completed_at: new Date().toISOString(), ...label }
        }
        return item
      })
      return changed ? next : prev
    })
  }

  useEffect(() => {
    refreshAuto()
    syncTrackActions(readTracks())

    function onLogsUpdated() {
      refreshAuto()
      // Auto-dismiss nudges whose data has since been filled in manually
      const todayIso = new Date().toISOString().slice(0, 10)
      const log = readLogs()[todayIso] ?? {}
      setItems(prev => prev.filter(it => {
        if (it.completed) return true
        const t = it.text.toLowerCase()
        if (t.includes('mood') && t.includes('not logged') && Object.values(log.mood ?? {}).some(v => v != null)) return false
        if (t.includes('sleep') && t.includes('not') && log.sleep?.hours) return false
        return true
      }))
    }
    function onTracksUpdated() {
      const tracks = readTracks()
      autoCompleteTrackInsights(tracks)
      syncTrackActions(tracks)
      refreshAuto()
    }
    window.addEventListener('lifetracker-logs-updated',   onLogsUpdated)
    window.addEventListener('lifetracker-tracks-updated', onTracksUpdated)
    return () => {
      window.removeEventListener('lifetracker-logs-updated',   onLogsUpdated)
      window.removeEventListener('lifetracker-tracks-updated', onTracksUpdated)
    }
  }, []) // eslint-disable-line

  useImperativeHandle(ref, () => ({
    addInsights(newInsights) {
      if (!newInsights?.length) return
      setItems(prev => {
        const existingTexts = new Set(prev.map(it => it.text.toLowerCase().trim()))
        let next = [...prev]
        const toAppend = []

        for (const ins of newInsights) {
          const text = ins.text.replace(/—/g, '-').trim()
          if (existingTexts.has(text.toLowerCase())) continue

          const topic = insightTopic(text)

          // Skip if a batch item already covers the same topic
          if (toAppend.some(a => insightTopic(a.text) === topic || topicsOverlap(insightTopic(a.text), topic))) continue

          const newItem = {
            id: `ins-claude-${Date.now()}-${Math.random()}`,
            type: 'claude',
            text,
            positive: ins.positive ?? false,
            actionable: ins.actionable ?? false,
            completed: false,
            completed_at: null,
            created_at: new Date().toISOString(),
          }

          // Remove same-topic CLAUDE items from storage (track items are handled at render time)
          next = next.filter(it =>
            it.completed ||
            it.type === 'track' ||
            (insightTopic(it.text) !== topic && !topicsOverlap(insightTopic(it.text), topic))
          )
          toAppend.push(newItem)
        }

        return toAppend.length || next.length !== prev.length ? [...next, ...toAppend] : prev
      })
    }
  }))

  function dismiss(id) { setItems(prev => prev.filter(it => it.id !== id)) }

  function itemAgeDays(item) {
    if (!item.created_at) return 0
    return Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86_400_000)
  }

  // Suppress auto insights when Claude already covers same topic
  const claudeText = items.filter(i => i.type === 'claude').map(i => i.text.toLowerCase()).join(' ')
  const visibleAuto = autoInsights.filter(a => {
    if (a.id.includes('sleep')   && claudeText.includes('sleep'))                                      return false
    if (a.id.includes('water')   && (claudeText.includes('water') || claudeText.includes('hydrat')))   return false
    if (a.id.includes('auto-ex') && (claudeText.includes('exercise') || claudeText.includes('active') || claudeText.includes('steps'))) return false
    if (a.id.includes('mood')    && claudeText.includes('mood'))                                        return false
    return true
  })

  const ACTION_KEYWORDS = /\b(worth|still need|consider|try to|chase|follow up|check in|reach out|apply|send|log|add)\b/i
  function isActionable(it) {
    return it.actionable || ACTION_KEYWORDS.test(it.text) || /still to capture/i.test(it.text)
  }

  const claudeObservations = items.filter(it => it.type === 'claude' && !it.completed && !isActionable(it))
  const claudeActions      = items.filter(it => it.type === 'claude' && !it.completed && isActionable(it))

  const sortedInsights = [
    ...visibleAuto.filter(a => a.positive),
    ...claudeObservations.filter(it => it.positive),
    ...visibleAuto.filter(a => !a.positive),
    ...claudeObservations.filter(it => !it.positive),
  ]
  const insightItems   = sortedInsights
  const tracks = readTracks()
  const trackPriority = id => {
    const t = tracks.find(t => t.id === id)
    return PRIORITY_ORDER[t?.priority] ?? 3
  }

  const allClaudeText = items.filter(it => it.type === 'claude' && !it.completed).map(it => it.text.toLowerCase())
  const trackItems = items.filter(it => it.type === 'track' && !it.completed).filter(it => {
    const trackName = insightTopic(it.text)
    return !allClaudeText.some(t => t.includes(trackName))
  }).sort((a, b) => trackPriority(a.track_id) - trackPriority(b.track_id))

  // Match each Claude action to its track priority if the text mentions a known track
  const claudeActionsSorted = [...claudeActions].sort((a, b) => {
    const pa = tracks.reduce((best, t) =>
      a.text.toLowerCase().includes(t.name.toLowerCase())
        ? Math.min(best, PRIORITY_ORDER[t.priority] ?? 3)
        : best, 4)
    const pb = tracks.reduce((best, t) =>
      b.text.toLowerCase().includes(t.name.toLowerCase())
        ? Math.min(best, PRIORITY_ORDER[t.priority] ?? 3)
        : best, 4)
    return pa - pb
  })

  const actionItems = [...trackItems, ...claudeActionsSorted]
  const completedItems = items.filter(it => it.completed)

  return (
    <div className="ins-panel">
      <Section title="Insights" items={insightItems}   onDismiss={id => dismiss(id)} />
      <Section title="Actions"  items={actionItems}    onDismiss={id => dismiss(id)} getAge={itemAgeDays} />
      {completedItems.length > 0 && (
        <Section title="Done"   items={completedItems} onDismiss={id => dismiss(id)} faded />
      )}
      {insightItems.length === 0 && actionItems.length === 0 && completedItems.length === 0 && (
        <p className="ins-empty">Log a check-in to get insights</p>
      )}
    </div>
  )
})

export default Insights

function Section({ title, items, onDismiss, faded, getAge }) {
  if (!items.length) return null
  return (
    <div className={`ins-section ${faded ? 'ins-section--faded' : ''}`}>
      <div className="ins-section-label">{title}</div>
      {items.map(item => {
        const age = getAge ? getAge(item) : 0
        const ageClass = age >= 7 ? 'ins-item--stale-red' : age >= 3 ? 'ins-item--stale-yellow' : ''
        return (
          <div
            key={item.id}
            className={`ins-item ${item.completed ? 'ins-item--done' : ''} ${item.positive ? 'ins-item--positive' : ''} ${ageClass}`}
          >
            <span className="ins-emoji">{insightEmoji(item)}</span>
            <InsightText text={item.text} />
            {item.type !== 'auto' && (
              <button className="ins-dismiss" onClick={() => onDismiss(item.id)} title="Dismiss">×</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InsightText({ text }) {
  // Find separator: ' - ' preferred, fall back to ' — ' if the prefix is a short topic label
  let sep = text.indexOf(' - ')
  if (sep === -1) {
    const em = text.indexOf(' — ')
    if (em !== -1 && em <= 30) sep = em
  }
  if (sep === -1) return <span className="ins-text">{text}</span>
  return (
    <span className="ins-text">
      <strong>{text.slice(0, sep)}</strong>
      {text.slice(sep)}
    </span>
  )
}
