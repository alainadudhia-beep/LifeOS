import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { dbWrite } from '../lib/db'
import './Insights.css'

const INSIGHTS_KEY = 'lifetracker-insights'

function isTodayClaude(it) {
  // Claude insights are daily observations — expire them at midnight
  if (it.type !== 'claude') return true
  if (!it.created_at) return true
  return it.created_at.slice(0, 10) >= new Date().toISOString().slice(0, 10)
}

function loadInsights() {
  try {
    const data = JSON.parse(localStorage.getItem(INSIGHTS_KEY))
    if (!Array.isArray(data)) return []
    return data
      .filter(it => it && it.id && it.text && it.type)
      // Drop stale claude observations from previous days
      .filter(isTodayClaude)
      // Claude items should never be "done" — only track items get struck through
      .map(it => it.type === 'claude' && it.completed ? { ...it, completed: false, completed_at: null } : it)
      // One-time text fixes
      .map(it => {
        if (it.type === 'claude' && /moneybox.*chief of staff.*milestone|chief of staff.*moneybox.*milestone/i.test(it.text))
          return { ...it, text: "Chief of Staff at Moneybox - getting the application done is a real milestone, that one's been sitting on the list for a while." }
        return it
      })
  } catch { return [] }
}
function saveInsights(items) {
  try { localStorage.setItem(INSIGHTS_KEY, JSON.stringify(items)) } catch {}
  dbWrite(INSIGHTS_KEY, items).catch(err => console.error('[Insights] save error', err))
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
function readLogs()     { try { return JSON.parse(localStorage.getItem('lifetracker-life-logs')) ?? {} } catch { return {} } }
function readFitbitRaw(){ try { return JSON.parse(localStorage.getItem('lifetracker-fitbit-raw')) ?? {} } catch { return {} } }
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

  // Yesterday completeness summary (pinned at top of Life Summary)
  const yIso = daysAgo(1)
  const yLog = logs[yIso]
  const yFitbit = readFitbitRaw()[yIso] ?? {}
  const YESTERDAY_CHECKS = [
    { label: 'Mind',       check: () => yLog?.mood?.work != null && yLog?.mood?.life != null && yLog?.mood?.focus != null },
    { label: 'Inflammation', check: () => yLog?.health?.eczema != null && yLog?.health?.hayfever != null },
    { label: 'Diet',       check: () => yLog?.diet?.caffeine != null && yLog?.diet?.sugar != null && yLog?.diet?.protein != null && yLog?.diet?.fruit_veg != null && yLog?.diet?.carbs != null && yLog?.diet?.snacking != null },
    { label: 'Alcohol',    check: () => yLog?.alcohol?.level != null && (yLog.alcohol.level === 'None' || yLog?.alcohol?.type?.length > 0) },
    { label: 'Water',      check: () => yLog?.water?.glasses != null },
    { label: 'Sleep',      check: () => yFitbit.sleep_minutes != null || (yLog?.sleep?.hours != null && yLog?.sleep?.quality != null) },
    { label: 'Gratitude',  check: () => !!yLog?.gratitude },
  ]
  const missing = YESTERDAY_CHECKS
    .filter(({ check }) => !check())
    .map(({ label }) => label)
  const complete = Object.keys(YESTERDAY_CHECKS).length - missing.length
  if (missing.length === 0) {
    out.unshift({ id: 'auto-yesterday', positive: true, bg: 'green', text: 'Well done - you completed everything yesterday!' })
  } else if (complete >= 4) {
    const listed = missing.length <= 2
      ? missing.join(' and ')
      : `${missing.slice(0, 2).join(', ')} and ${missing.length - 2} more`
    out.unshift({ id: 'auto-yesterday', positive: false, bg: 'yellow', text: `👍 Yesterday is nearly finished - don't forget to update ${listed}!` })
  } else {
    out.unshift({ id: 'auto-yesterday', positive: false, bg: 'red', text: `❗ A few data points missing from yesterday - why don't you fill them in now?` })
  }

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
        // Always purge stale claude observations before adding today's
        let next = prev.filter(isTodayClaude)
        const toAppend = []
        const handledTopics = []

        for (const ins of newInsights) {
          const text = ins.text.replace(/—/g, '-').trim()
          if (next.some(it => it.text.toLowerCase().trim() === text.toLowerCase())) continue

          const topic = insightTopic(text)

          // Skip if this batch already handled the same topic
          if (handledTopics.some(t => t === topic || topicsOverlap(t, topic))) continue
          handledTopics.push(topic)

          if (ins.positive) {
            // If a completed track item already covers this topic, suppress — it's already a win
            const alreadyWon = next.some(it =>
              it.completed &&
              it.type === 'track' &&
              (insightTopic(it.text) === topic || topicsOverlap(insightTopic(it.text), topic))
            )
            if (alreadyWon) continue

            // Only "complete" career track items (tick + move to Wins).
            // Claude health/observation items just get replaced with the new positive text.
            const activeTrackIdx = next.findIndex(it =>
              !it.completed &&
              it.type === 'track' &&
              (insightTopic(it.text) === topic || topicsOverlap(insightTopic(it.text), topic))
            )
            if (activeTrackIdx !== -1) {
              next = next.map((it, i) => i === activeTrackIdx
                ? { ...it, text, positive: true, completed: true, completed_at: new Date().toISOString() }
                : it
              )
            } else {
              // Replace any existing Claude insight on the same topic, then add the new positive one
              next = next.filter(it =>
                it.completed ||
                it.type === 'track' ||
                (insightTopic(it.text) !== topic && !topicsOverlap(insightTopic(it.text), topic))
              )
              toAppend.push({
                id: `ins-claude-${Date.now()}-${Math.random()}`,
                type: 'claude', text,
                positive: true, actionable: false,
                completed: false, completed_at: null,
                created_at: new Date().toISOString(),
              })
            }
          } else {
            // Non-positive: replace same-topic CLAUDE items (track items suppressed at render time)
            next = next.filter(it =>
              it.completed ||
              it.type === 'track' ||
              (insightTopic(it.text) !== topic && !topicsOverlap(insightTopic(it.text), topic))
            )
            toAppend.push({
              id: `ins-claude-${Date.now()}-${Math.random()}`,
              type: 'claude', text,
              positive: ins.positive ?? false,
              actionable: ins.actionable ?? false,
              completed: false, completed_at: null,
              created_at: new Date().toISOString(),
            })
          }
        }

        return toAppend.length || next.length !== prev.length ? [...next, ...toAppend] : prev
      })
    }
  }))

  function dismiss(id) { setItems(prev => prev.filter(it => it.id !== id)) }

  // Suppress auto insights when Claude already covers same topic
  const claudeText = items.filter(i => i.type === 'claude').map(i => i.text.toLowerCase()).join(' ')
  const visibleAuto = autoInsights.filter(a => {
    if (a.id.includes('sleep')   && claudeText.includes('sleep'))                                      return false
    if (a.id.includes('water')   && (claudeText.includes('water') || claudeText.includes('hydrat')))   return false
    if (a.id.includes('auto-ex') && (claudeText.includes('exercise') || claudeText.includes('active') || claudeText.includes('steps'))) return false
    if (a.id.includes('mood')    && claudeText.includes('mood'))                                        return false
    return true
  })

  const tracks = readTracks()

  // Sort by track's position in the data array — matches gantt row order
  const trackIndex    = id  => { const i = tracks.findIndex(t => t.id === id); return i === -1 ? 999 : i }
  function textTrackIndex(text) {
    const t = text.toLowerCase()
    let best = 999
    tracks.forEach((track, i) => { if (t.includes(track.name.toLowerCase()) && i < best) best = i })
    return best
  }
  function mentionsTrack(text) {
    const t = text.toLowerCase()
    return tracks.some(track =>
      t.includes(track.name.toLowerCase()) || topicsOverlap(text, track.name)
    )
  }

  const claudeActive     = items.filter(it => it.type === 'claude' && !it.completed)
  const claudeActiveText = claudeActive.map(it => it.text.toLowerCase())

  function coveredByClaude(item) {
    const trackName = insightTopic(item.text)
    return claudeActiveText.some(t => t.includes(trackName))
  }

  // Work Summary — track items + Claude items that mention a known track, sorted by gantt order
  const activeTrackItems = items.filter(it => it.type === 'track' && !it.completed)
    .filter(it => !coveredByClaude(it))
    .sort((a, b) => trackIndex(a.track_id) - trackIndex(b.track_id))
  const completedTrackItems = items.filter(it => it.type === 'track' && it.completed)
    .filter(it => !coveredByClaude(it))
    .sort((a, b) => trackIndex(a.track_id) - trackIndex(b.track_id))
  const claudeWorkItems = claudeActive.filter(it => mentionsTrack(it.text))
    .sort((a, b) => textTrackIndex(a.text) - textTrackIndex(b.text))
  const workItems = [...activeTrackItems, ...claudeWorkItems, ...completedTrackItems]

  // Life Summary — yesterday summary pinned first, then auto + Claude life items (positive first)
  // Suppress Claude items when an auto insight already covers the same topic (auto is trend-based and wins)
  const yesterdaySummary = visibleAuto.find(a => a.id === 'auto-yesterday')
  const autoTopics = visibleAuto.filter(a => a.id !== 'auto-yesterday').map(a => insightTopic(a.text))
  const sortedLifeItems = [
    ...visibleAuto.filter(a => a.id !== 'auto-yesterday'),
    ...claudeActive.filter(it =>
      !mentionsTrack(it.text) &&
      !autoTopics.some(t => t === insightTopic(it.text) || topicsOverlap(t, insightTopic(it.text)))
    ),
  ].sort((a, b) => (a.positive === b.positive ? 0 : a.positive ? -1 : 1))
  const lifeItems = yesterdaySummary ? [yesterdaySummary, ...sortedLifeItems] : sortedLifeItems

  const isEmpty = workItems.length === 0 && lifeItems.length === 0

  return (
    <div className="ins-panel">
      <Section title="Work Summary" items={workItems}  onDismiss={id => dismiss(id)} />
      <Section title="Life Summary" items={lifeItems}  onDismiss={id => dismiss(id)} />
      {isEmpty && <p className="ins-empty">Log a check-in to get insights</p>}
    </div>
  )
})

export default Insights

const BG_CLASS = { green: 'ins-item--positive', yellow: 'ins-item--warning', red: 'ins-item--alert' }

function Section({ title, items, onDismiss }) {
  if (!items.length) return null
  return (
    <div className="ins-section">
      <div className="ins-section-label">{title}</div>
      {items.map(item => {
        const bgClass = item.bg ? (BG_CLASS[item.bg] ?? '') : (item.positive ? 'ins-item--positive' : '')
        return (
        <div
          key={item.id}
          className={`ins-item ${bgClass}`}
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
