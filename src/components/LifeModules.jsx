import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import { getDays, MONTH_NAMES } from '../utils/timeline'
import { DAY_WIDTH } from '../data/initialData'
import './LifeModules.css'

// ─── colour palettes ──────────────────────────────────────────────────────────

const H3 = { 0: '#fee2e2', 1: '#fef9c3', 2: '#dcfce7', 3: '#bbf7d0' }    // 0=bad 3=good
const I3 = { 0: '#bbf7d0', 1: '#dcfce7', 2: '#fef9c3', 3: '#fee2e2' }    // 0=good 3=bad
const H5 = { 1: '#fee2e2', 2: '#fde8c8', 3: '#fef9c3', 4: '#dcfce7', 5: '#86efac' }
const SLEEP_H = { '<5': '#fee2e2', '5': '#fde8c8', '6': '#fef9c3', '7': '#dcfce7', '8': '#bbf7d0', '9+': '#86efac' }

const EXERCISE_SHORT = { 'Yoga': 'Yoga', 'Pilates': 'Pilates', 'Long walk': 'Walk', 'Gym': 'Gym' }
const ACTIVITY_TEXT  = { 'Yoga': '#6b21a8', 'Pilates': '#9d174d', 'Walk': '#0e7490', 'Gym': '#1e40af' }

// ─── summary scoring ─────────────────────────────────────────────────────────

function scoreToSummary(score) {
  if (score >= 2.3) return { label: 'Great', bg: '#86efac' }
  if (score >= 2.0) return { label: 'Good',  bg: '#dcfce7' }
  if (score >= 1.3) return { label: 'Fair',  bg: '#fef9c3' }
  return { label: 'Poor', bg: '#fee2e2' }
}

// Additive: hours(0–5) + quality(0–2) = combined(0–7)
// Makes 9+Fair = 8+Good (both 6), and 8+Fair = 7+Good (both 5)
const HOURS_SCORE   = { '<5': 0, '5': 1, '6': 2, '7': 3, '8': 4, '9+': 5 }
const QUALITY_SCORE = { Poor: 0, Fair: 1, Good: 2 }
const SLEEP_COLORS  = [
  '#fee2e2', '#fde8c8', '#fef9c3',
  '#fef9c3', '#dcfce7', '#bbf7d0',
  '#86efac', '#4ade80',
]

function sleepSummaryColor(d) {
  if (!d) return null
  const h = d.hours   != null ? HOURS_SCORE[d.hours]    : null
  const q = d.quality != null ? QUALITY_SCORE[d.quality] : null
  if (h == null) return null
  if (q == null) return SLEEP_H[d.hours]
  return SLEEP_COLORS[h + q] ?? '#4ade80'
}

const ECZEMA_SCORE    = { None: 3, Low: 2, Med: 1.5, Bad: 0 }
const HAYFEVER_SCORE  = { None: 3, Low: 2, Med: 1.5, Bad: 0 }
const ALCOHOL_SCORE   = { None: 3, '1-2': 2, '3-4': 1, '5+': 0 }
const WATER_SCORE     = { '<3': 0, '4-6': 2, '7+': 3 }
const PROTEIN_SCORE   = { Low: 1, Med: 2, High: 3 }
const FRUIT_SCORE     = { '1-2': 1, '3-4': 2, '5+': 3 }
const CARBS_SCORE     = { Low: 1, Med: 3, High: 1 }
const SNACKING_SCORE  = { Low: 3, Med: 2, High: 0 }
const SUGAR_SCORE     = { None: 3, Low: 2, Med: 1, High: 0 }

function avg(nums) {
  const valid = nums.filter(n => n != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

function healthScore(d) {
  if (!d) return null
  return avg([
    d.eczema   != null ? ECZEMA_SCORE[d.eczema]     : null,
    d.hayfever != null ? HAYFEVER_SCORE[d.hayfever] : null,
    Array.isArray(d.symptoms) ? Math.max(0, 3 - d.symptoms.length * 1.5) : null,
  ])
}

function dietScore(d) {
  if (!d) return null
  const scores = [
    d.sugar     != null ? SUGAR_SCORE[d.sugar]       : null,
    d.protein   != null ? PROTEIN_SCORE[d.protein]   : null,
    d.fruit_veg != null ? FRUIT_SCORE[d.fruit_veg]   : null,
    d.carbs     != null ? CARBS_SCORE[d.carbs]       : null,
    d.snacking  != null ? SNACKING_SCORE[d.snacking] : null,
  ]
  const valid = scores.filter(n => n != null)
  if (valid.length < 2) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

// ─── module definitions ───────────────────────────────────────────────────────

const MODULE_EMOJI = {
  mood:     '🧠',
  health:   '💊',
  diet:     '🥗',
  alcohol:  '🍷',
  water:    '💧',
  exercise: '🏃',
  sleep:    '😴',
  social:   '👥',
}

const MODULES = [
  {
    key: 'mood', label: 'Mood',
    cellColor: d => {
      const vals = ['work', 'life', 'energy', 'focus'].map(k => d?.[k]).filter(v => v != null)
      if (!vals.length) return null
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      return H5[Math.round(avg)] ?? null
    },
    cellLabel: d => {
      const vals = ['work', 'life', 'energy', 'focus'].map(k => d?.[k]).filter(v => v != null)
      if (!vals.length) return null
      return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
    },
    fields: [
      { key: 'work',   label: 'Work',   type: 'score', min: 1, max: 5, colors: H5 },
      { key: 'life',   label: 'Life',   type: 'score', min: 1, max: 5, colors: H5 },
      { key: 'energy', label: 'Energy', type: 'score', min: 1, max: 5, colors: H5 },
      { key: 'focus',  label: 'Focus',  type: 'score', min: 1, max: 5, colors: H5 },
      { key: 'note',   label: 'Note',   type: 'text' },
    ],
  },
  {
    key: 'health', label: 'Health',
    cellColor: d => { const s = healthScore(d); return s != null ? scoreToSummary(s).bg : (hasAny(d) ? '#f1f5f9' : null) },
    cellLabel: d => { const s = healthScore(d); return s != null ? scoreToSummary(s).label : null },
    defaults: { adhd_meds: 'None', antihistamines: 'None' },
    fields: [
      { key: 'eczema',          label: 'Eczema',          type: 'options',     options: ['None', 'Low', 'Med', 'Bad'], colors: { None: '#bbf7d0', Low: '#fef9c3', Med: '#fde8c8', Bad: '#fee2e2' } },
      { key: 'eczema_location', label: 'Location',        type: 'multiselect', options: ['Eyes', 'Under mouth', 'Neck', 'Back of neck', 'Scalp'] },
      { key: 'hayfever',        label: 'Hayfever',        type: 'options',     options: ['None', 'Low', 'Med', 'Bad'], colors: { None: '#bbf7d0', Low: '#fef9c3', Med: '#fde8c8', Bad: '#fee2e2' } },
      { key: 'symptoms',        label: 'Symptoms',        type: 'multiselect', options: ['Headache', 'Fatigue', 'Bloating', 'Brain fog', 'Cramps', 'Anxious', 'Diarrhoea', 'Itchy throat', 'Itchy eyes'] },
      { key: 'adhd_meds',       label: 'ADHD Meds',       type: 'options',     options: ['None', '5mg', '7.5mg', '10mg'], colors: { None: '#f1f5f9', '5mg': '#e0f2fe', '7.5mg': '#bae6fd', '10mg': '#7dd3fc' } },
      { key: 'antihistamines',  label: 'Antihistamines',  type: 'options',     options: ['None', '1', '2', '3'],         colors: { None: '#f1f5f9', '1': '#e0f2fe', '2': '#bae6fd', '3': '#7dd3fc' } },
      { key: 'note',            label: 'Note',            type: 'text' },
    ],
  },
  {
    key: 'diet', label: 'Diet',
    cellColor: d => { const s = dietScore(d); return s != null ? scoreToSummary(s).bg : (hasAny(d) ? '#f1f5f9' : null) },
    cellLabel: d => { const s = dietScore(d); return s != null ? scoreToSummary(s).label : null },
    fields: [
      { key: 'caffeine',  label: 'Caffeine',    type: 'count', max: 6, options: ['0','1','2','3','4','5','6+'] },
      { key: 'sugar',     label: 'Sugar',       type: 'options', options: ['None', 'Low', 'Med', 'High'], colors: { None: '#bbf7d0', Low: '#fef9c3', Med: '#fde8c8', High: '#fee2e2' } },
      { key: 'protein',   label: 'Protein',     type: 'options', options: ['Low', 'Med', 'High'],          colors: { Low: '#fef9c3', Med: '#dcfce7', High: '#bbf7d0' } },
      { key: 'fruit_veg', label: 'Fruit & Veg', type: 'options', options: ['1-2', '3-4', '5+'],            colors: { '1-2': '#fef9c3', '3-4': '#dcfce7', '5+': '#bbf7d0' } },
      { key: 'carbs',     label: 'Carbs',       type: 'options', options: ['Low', 'Med', 'High'],          colors: { Low: '#fef9c3', Med: '#dcfce7', High: '#fef9c3' } },
      { key: 'snacking',  label: 'Snacking',    type: 'options', options: ['Low', 'Med', 'High'],          colors: { Low: '#bbf7d0', Med: '#fef9c3', High: '#fee2e2' } },
      { key: 'allergens', label: 'Allergens',   type: 'multiselect', options: ['Dairy', 'Gluten', 'Soy', 'Wheat', 'Yeast'] },
      { key: 'note',      label: 'Note',        type: 'text' },
    ],
  },
  {
    key: 'alcohol', label: 'Alcohol',
    cellColor: d => ({ None: '#bbf7d0', '1-2': '#fef9c3', '3-4': '#fde8c8', '5+': '#fee2e2' }[d?.level] ?? null),
    cellLabel: d => d?.level ?? null,
    fields: [
      { key: 'level', label: 'Drinks', type: 'options', options: ['None', '1-2', '3-4', '5+'], colors: { None: '#bbf7d0', '1-2': '#fef9c3', '3-4': '#fde8c8', '5+': '#fee2e2' } },
      { key: 'type',  label: 'Type',   type: 'multiselect', options: ['Wine', 'Beer', 'Spirits'] },
    ],
  },
  {
    key: 'water', label: 'Water',
    cellColor: d => ({ '<3': '#fee2e2', '4-6': '#fef9c3', '7+': '#bbf7d0' }[d?.glasses] ?? null),
    cellLabel: d => d?.glasses ?? null,
    fields: [
      { key: 'glasses', label: 'Glasses', type: 'options', options: ['<3', '4-6', '7+'], colors: { '<3': '#fee2e2', '4-6': '#fef9c3', '7+': '#bbf7d0' } },
    ],
  },
  {
    key: 'exercise', label: 'Exercise',
    cellColor: d => {
      const acts = d?.activities
      if (!acts?.length) return null
      const ACTIVITY_COLORS = { 'Yoga': '#e9d5ff', 'Pilates': '#fce7f3', 'Long walk': '#cffafe', 'Gym': '#dbeafe' }
      return acts.length === 1 ? (ACTIVITY_COLORS[acts[0]] ?? '#dcfce7') : '#dcfce7'
    },
    cellLabel: d => {
      const acts = d?.activities
      if (!acts?.length) return null
      return acts.map(a => EXERCISE_SHORT[a] ?? a)
    },
    fields: [
      { key: 'activities', label: 'Activities', type: 'multiselect', options: ['Yoga', 'Pilates', 'Long walk', 'Gym'], colors: { 'Yoga': '#e9d5ff', 'Pilates': '#fce7f3', 'Long walk': '#cffafe', 'Gym': '#dbeafe' } },
      { key: 'steps',      label: 'Steps',      type: 'number', placeholder: 'from Fitbit later…' },
    ],
  },
  {
    key: 'sleep', label: 'Sleep',
    cellColor: d => sleepSummaryColor(d),
    cellLabel: d => d?.hours ?? null,
    fields: [
      { key: 'hours',     label: 'Hours',     type: 'options', options: ['<5', '5', '6', '7', '8', '9+'], colors: SLEEP_H },
      { key: 'quality',   label: 'Quality',   type: 'options', options: ['Poor', 'Fair', 'Good'], colors: { Poor: '#fee2e2', Fair: '#fef9c3', Good: '#bbf7d0' } },
      { key: 'melatonin', label: 'Melatonin', type: 'toggle' },
    ],
  },
  {
    key: 'social', label: 'Social',
    cellColor: d => d == null ? null : (d.activities?.length ? '#f1f5f9' : '#dde3eb'),
    cellLabel: d => {
      if (!d?.activities?.length) return null
      const seen = new Set()
      return d.activities.map(a => a === 'Dating Apps' ? 'Apps' : a).filter(a => seen.has(a) ? false : seen.add(a))
    },
    fields: [
      { key: 'activities', label: 'Today', type: 'multiselect', options: ['Friends', 'Work', 'Date', 'Dating Apps'] },
      { key: 'note',       label: 'Note',  type: 'text' },
    ],
  },
]

function hasAny(d) {
  if (!d) return false
  return Object.values(d).some(v =>
    v !== null && v !== undefined && v !== false && !(Array.isArray(v) && !v.length)
  )
}

// ─── completion checks (today only) ──────────────────────────────────────────

const COMPLETE_CHECK = {
  mood:     d => d?.work != null && d?.life != null && d?.energy != null && d?.focus != null,
  sleep:    d => d?.hours != null && d?.quality != null,
  diet:     d => d?.caffeine != null && d?.sugar != null && d?.protein != null && d?.fruit_veg != null && d?.carbs != null && d?.snacking != null,
  water:    d => d?.glasses != null,
  exercise: d => d?.steps != null,
  alcohol:  d => d?.level != null && (d.level === 'None' || d?.type?.length > 0),
  health:   d => d?.eczema != null && d?.hayfever != null,
}

// ─── derived data ─────────────────────────────────────────────────────────────

const allDays     = getDays()
const todayIso    = new Date().toISOString().slice(0, 10)
const yesterdayIso = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ─── main component ───────────────────────────────────────────────────────────

const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function LifeModules({ mobile } = {}) {
  // On mobile: grid shows all history EXCEPT today; today gets its own sticky-right column
  const gridDays  = mobile
    ? allDays.filter(d => d.toISOString().slice(0, 10) < todayIso)
    : allDays
  const gridWidth = gridDays.length * DAY_WIDTH

  const [logs, setLogs]             = useLocalStorage('lifetracker-life-logs', {})
  const [activeCell, setActiveCell] = useState(null) // { moduleKey, date }
  const popoverRef   = useRef(null)
  const gratRef      = useRef(null)
  const [gratEdit, setGratEdit] = useState(null) // { date, value }
  const transcriptRef = useRef(null)
  const [transcriptOpen, setTranscriptOpen] = useState(null) // iso date string
  const transcriptCellRefs = useRef({}) // iso → DOM node for portal positioning

  // Re-read logs from localStorage when voice check-in writes new data
  useEffect(() => {
    function onLogsUpdated() {
      try {
        const raw = localStorage.getItem('lifetracker-life-logs')
        console.log('[LifeModules] lifetracker-logs-updated received, raw:', raw?.slice(0, 200))
        if (raw) setLogs(JSON.parse(raw))
      } catch { /* ignore */ }
    }
    window.addEventListener('lifetracker-logs-updated', onLogsUpdated)
    return () => window.removeEventListener('lifetracker-logs-updated', onLogsUpdated)
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!activeCell) return
    function onDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setActiveCell(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [activeCell])

  useEffect(() => {
    if (!gratEdit) return
    function onDown(e) {
      if (gratRef.current && !gratRef.current.contains(e.target)) saveGratitude()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [gratEdit])

  useEffect(() => {
    if (!transcriptOpen) return
    function onDown(e) {
      if (transcriptRef.current && !transcriptRef.current.contains(e.target) &&
          !transcriptCellRefs.current[transcriptOpen]?.contains(e.target)) {
        setTranscriptOpen(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [transcriptOpen])

  function saveGratitude() {
    if (!gratEdit) return
    const text = gratEdit.value.trim()
    setLogs(prev => ({
      ...prev,
      [gratEdit.date]: { ...(prev[gratEdit.date] ?? {}), gratitude: text || null },
    }))
    setGratEdit(null)
  }

  function setFieldValue(moduleKey, date, fieldKey, value) {
    setLogs(prev => ({
      ...prev,
      [date]: {
        ...(prev[date] ?? {}),
        [moduleKey]: {
          ...((prev[date] ?? {})[moduleKey] ?? {}),
          [fieldKey]: value,
        },
      },
    }))
  }

  function togglePeriod(date) {
    setLogs(prev => {
      const day = prev[date] ?? {}
      return { ...prev, [date]: { ...day, period: !day.period } }
    })
  }

  function markLogged(moduleKey, date) {
    setLogs(prev => {
      if (prev[date]?.[moduleKey] !== undefined) return prev
      return { ...prev, [date]: { ...(prev[date] ?? {}), [moduleKey]: {} } }
    })
  }

  function handleCellClick(e, moduleKey, date) {
    e.stopPropagation()
    if (activeCell?.moduleKey === moduleKey && activeCell?.date === date) {
      setActiveCell(null)
    } else {
      markLogged(moduleKey, date)
      const mod = MODULES.find(m => m.key === moduleKey)
      if (mod?.defaults) {
        setLogs(prev => {
          const current = prev[date]?.[moduleKey] ?? {}
          const patch = Object.fromEntries(
            Object.entries(mod.defaults).filter(([k]) => current[k] == null)
          )
          if (!Object.keys(patch).length) return prev
          return { ...prev, [date]: { ...(prev[date] ?? {}), [moduleKey]: { ...current, ...patch } } }
        })
      }
      setActiveCell({ moduleKey, date })
    }
  }

  return (
    <div className={mobile ? 'lm-mobile-container' : undefined}>
      {!mobile && (
        <div className="lm-section-header">
          <div className="lm-section-label">Life</div>
          <div style={{ width: gridWidth, flexShrink: 0 }} />
        </div>
      )}

      {/* Date header row — mobile only */}
      {mobile && (
        <div className="lm-row lm-row--date-header">
          <div className="lm-label" />
          <div className="lm-day-grid" style={{ width: gridWidth }}>
            {gridDays.map((d, i) => {
              const isMonthStart = d.getDate() === 1
              return (
                <div
                  key={i}
                  className={`lm-date-cell`}
                  style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                >
                  {isMonthStart
                    ? <span className="lm-date-cell-month">{MONTH_NAMES[d.getMonth()]}</span>
                    : <span className="lm-date-cell-day">{DAY_SHORT[d.getDay()]}</span>
                  }
                  <span className="lm-date-cell-num">{d.getDate()}</span>
                </div>
              )
            })}
          </div>
          <div className="lm-today-col lm-today-col--header">
            <span className="lm-date-cell-day lm-date-cell-day--today">T</span>
            <span className="lm-date-cell-num lm-date-cell-num--today">{new Date(todayIso).getDate()}</span>
          </div>
        </div>
      )}

      {MODULES.map(mod => {
        return (
          <div key={mod.key} className="lm-row">
            <div className="lm-label">{MODULE_EMOJI[mod.key] && <span className="lm-label-emoji">{MODULE_EMOJI[mod.key]}</span>} {mod.label}</div>

            <div className="lm-day-grid" style={{ width: gridWidth }}>
              <WeekLines days={gridDays} />

              {gridDays.map((d, i) => {
                const iso      = d.toISOString().slice(0, 10)
                const dayData  = logs[iso]?.[mod.key] ?? null
                const bg       = mod.cellColor(dayData)
                const label    = mod.cellLabel(dayData)
                const open       = activeCell?.moduleKey === mod.key && activeCell?.date === iso
                const isFuture   = iso > todayIso
                const isRecent   = iso === todayIso || iso === yesterdayIso
                const incomplete = isRecent && COMPLETE_CHECK[mod.key] && !COMPLETE_CHECK[mod.key](dayData)

                const noteText = dayData?.note
                return (
                  <div
                    key={iso}
                    className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${open ? 'lm-cell--active' : ''} ${incomplete ? 'lm-cell--incomplete' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                    style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                    title={noteText || undefined}
                    onClick={isFuture ? undefined : e => handleCellClick(e, mod.key, iso)}
                  >
                    {Array.isArray(label)
                      ? <div className="lm-cell-stack">
                          {label.map(l => (
                            <span key={l} className="lm-cell-label lm-cell-label--act" style={{ color: ACTIVITY_TEXT[l] ?? '#64748b' }}>
                              {l}
                            </span>
                          ))}
                        </div>
                      : label && <span className="lm-cell-label">{label}</span>
                    }

                    {open && (
                      <Popover
                        ref={popoverRef}
                        mod={mod}
                        date={iso}
                        dayData={dayData ?? {}}
                        onSet={(fieldKey, value) => setFieldValue(mod.key, iso, fieldKey, value)}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Today sticky column */}
            {mobile && (() => {
              const dayData  = logs[todayIso]?.[mod.key] ?? null
              const bg       = mod.cellColor(dayData)
              const label    = mod.cellLabel(dayData)
              const open     = activeCell?.moduleKey === mod.key && activeCell?.date === todayIso
              const incomplete = COMPLETE_CHECK[mod.key] && !COMPLETE_CHECK[mod.key](dayData)
              return (
                <div className="lm-today-col">
                  <div
                    className={`lm-cell lm-cell--clickable ${open ? 'lm-cell--active' : ''} ${incomplete ? 'lm-cell--incomplete' : ''}`}
                    style={{ left: 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                    onClick={e => handleCellClick(e, mod.key, todayIso)}
                  >
                    {Array.isArray(label)
                      ? <div className="lm-cell-stack">
                          {label.map(l => (
                            <span key={l} className="lm-cell-label lm-cell-label--act" style={{ color: ACTIVITY_TEXT[l] ?? '#64748b' }}>{l}</span>
                          ))}
                        </div>
                      : label && <span className="lm-cell-label">{label}</span>
                    }
                    {open && (
                      <Popover
                        ref={popoverRef}
                        mod={mod}
                        date={todayIso}
                        dayData={dayData ?? {}}
                        onSet={(fk, v) => setFieldValue(mod.key, todayIso, fk, v)}
                      />
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })}

      {/* ── Cycle ── */}
      <div className="lm-row">
        <div className="lm-label"><span className="lm-label-emoji">🌸</span> Cycle</div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso      = d.toISOString().slice(0, 10)
            const onPeriod = !!logs[iso]?.period
            const isFuture = iso > todayIso
            return (
              <div
                key={iso}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${onPeriod ? 'lm-cell--period' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2 }}
                onClick={isFuture ? undefined : () => togglePeriod(iso)}
                title={onPeriod ? 'Remove period marker' : 'Mark as period'}
              >
                {onPeriod && <span className="lm-period-dot" />}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const onPeriod = !!logs[todayIso]?.period
          return (
            <div className="lm-today-col">
              <div
                className={`lm-cell lm-cell--clickable ${onPeriod ? 'lm-cell--period' : ''}`}
                style={{ left: 1, width: DAY_WIDTH - 2 }}
                onClick={() => togglePeriod(todayIso)}
              >
                {onPeriod && <span className="lm-period-dot" />}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Gratitude ── */}
      <div className="lm-row lm-row--gratitude">
        <div className="lm-label"><span className="lm-label-emoji">🙏</span> Gratitude</div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso      = d.toISOString().slice(0, 10)
            const text     = logs[iso]?.gratitude ?? null
            const isEditing = gratEdit?.date === iso
            const isFuture  = iso > todayIso
            return (
              <div
                key={iso}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${isEditing ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2 }}
                onClick={isFuture ? undefined : () => { if (!isEditing) setGratEdit({ date: iso, value: text ?? '' }) }}
              >
                {isEditing ? (
                  <div className="lm-grat-popover" ref={gratRef} onClick={e => e.stopPropagation()}>
                    <input
                      className="lm-grat-input"
                      autoFocus
                      placeholder="What are you grateful for?"
                      value={gratEdit.value}
                      onChange={e => setGratEdit(g => ({ ...g, value: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveGratitude(); if (e.key === 'Escape') setGratEdit(null) }}
                    />
                  </div>
                ) : text ? (
                  <span className="lm-grat-emoji" data-tooltip={text}>🙏</span>
                ) : null}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const text = logs[todayIso]?.gratitude ?? null
          const isEditing = gratEdit?.date === todayIso
          return (
            <div className="lm-today-col">
              <div
                className={`lm-cell lm-cell--clickable ${isEditing ? 'lm-cell--active' : ''}`}
                style={{ left: 1, width: DAY_WIDTH - 2 }}
                onClick={() => { if (!isEditing) setGratEdit({ date: todayIso, value: text ?? '' }) }}
              >
                {isEditing ? (
                  <div className="lm-grat-popover" ref={gratRef} onClick={e => e.stopPropagation()}>
                    <input
                      className="lm-grat-input"
                      autoFocus
                      placeholder="What are you grateful for?"
                      value={gratEdit.value}
                      onChange={e => setGratEdit(g => ({ ...g, value: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveGratitude(); if (e.key === 'Escape') setGratEdit(null) }}
                    />
                  </div>
                ) : text ? (
                  <span className="lm-grat-emoji" data-tooltip={text}>🙏</span>
                ) : null}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Transcript ── */}
      <div className="lm-row lm-row--transcript">
        <div className="lm-label"><span className="lm-label-emoji">📝</span> Journal</div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso = d.toISOString().slice(0, 10)
            const transcripts = logs[iso]?.transcripts ?? []
            const hasEntry = transcripts.length > 0
            const isOpen = transcriptOpen === iso
            const isFuture = iso > todayIso
            return (
              <div
                key={iso}
                ref={el => { transcriptCellRefs.current[iso] = el }}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : hasEntry ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2 }}
                onClick={!isFuture && hasEntry ? () => setTranscriptOpen(isOpen ? null : iso) : undefined}
              >
                {hasEntry && (
                  <span className="lm-transcript-dot" title={`${transcripts.length} entry`}>📝</span>
                )}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const transcripts = logs[todayIso]?.transcripts ?? []
          const hasEntry = transcripts.length > 0
          const isOpen = transcriptOpen === todayIso
          return (
            <div className="lm-today-col">
              <div
                ref={el => { transcriptCellRefs.current[todayIso] = el }}
                className={`lm-cell ${hasEntry ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''}`}
                style={{ left: 1, width: DAY_WIDTH - 2 }}
                onClick={hasEntry ? () => setTranscriptOpen(isOpen ? null : todayIso) : undefined}
              >
                {hasEntry && <span className="lm-transcript-dot" title={`${transcripts.length} entry`}>📝</span>}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Transcript portal popover ── */}
      {transcriptOpen && (() => {
        const cellEl = transcriptCellRefs.current[transcriptOpen]
        const transcripts = logs[transcriptOpen]?.transcripts ?? []
        if (!cellEl) return null
        const rect = cellEl.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 340)
        const top = rect.top - 10
        return createPortal(
          <div
            ref={transcriptRef}
            className="lm-transcript-popover"
            style={{ top, left, transform: 'translateY(-100%)' }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="lm-transcript-header">
              <span className="lm-transcript-date">{fmtDate(transcriptOpen)}</span>
              <button className="lm-transcript-close" onClick={() => setTranscriptOpen(null)}>✕</button>
            </div>
            <div className="lm-transcript-body">
              {transcripts.map((t, idx) => (
                <div key={`${transcriptOpen}-${idx}`} className="lm-transcript-entry">
                  {transcripts.length > 1 && (
                    <div className="lm-transcript-time">
                      {new Date(t.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  <TranscriptTextarea
                    initialText={t.text}
                    onSave={newText => {
                      const updated = transcripts.map((entry, i) =>
                        i === idx ? { ...entry, text: newText } : entry
                      )
                      setLogs(prev => ({
                        ...prev,
                        [transcriptOpen]: { ...(prev[transcriptOpen] ?? {}), transcripts: updated },
                      }))
                    }}
                  />
                </div>
              ))}
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}

// ─── TranscriptTextarea ───────────────────────────────────────────────────────
// Own local state so typing works regardless of parent re-renders

function TranscriptTextarea({ initialText, onSave }) {
  const [text, setText] = useState(initialText)
  return (
    <textarea
      className="lm-transcript-text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text !== initialText) onSave(text) }}
    />
  )
}

// ─── WeekLines ────────────────────────────────────────────────────────────────

function WeekLines({ days }) {
  return days.map((d, i) =>
    d.getDay() === 1
      ? <div key={i} className="lm-week-line" style={{ left: i * DAY_WIDTH }} />
      : <div key={i} className="lm-day-line" style={{ left: i * DAY_WIDTH }} />
  )
}

// ─── Popover ──────────────────────────────────────────────────────────────────

import { forwardRef } from 'react'

const Popover = forwardRef(function Popover({ mod, date, dayData, onSet }, ref) {
  return (
    <div className="lm-popover" ref={ref} onClick={e => e.stopPropagation()}>
      <div className="lm-popover-title">
        <span className="lm-popover-module">{mod.label}</span>
        <span className="lm-popover-date">{fmtDate(date)}</span>
      </div>

      {mod.fields.map(field => (
        <PopoverField
          key={field.key}
          field={field}
          value={dayData[field.key] ?? null}
          onSet={v => onSet(field.key, v)}
        />
      ))}
    </div>
  )
})

// ─── PopoverField ─────────────────────────────────────────────────────────────

function PopoverField({ field, value, onSet }) {
  if (field.type === 'score') {
    const opts = Array.from({ length: field.max - field.min + 1 }, (_, i) => field.min + i)
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">{field.label}</span>
        <div className="lm-pf-controls">
          {opts.map(v => (
            <button
              key={v}
              className={`lm-pf-btn ${value === v ? 'lm-pf-btn--active' : ''}`}
              style={field.colors?.[v] ? { background: field.colors[v] } : undefined}
              onClick={() => onSet(value === v ? null : v)}
            >{v === 0 && field.zeroLabel ? field.zeroLabel : v}</button>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'options') {
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">{field.label}</span>
        <div className="lm-pf-controls">
          {field.options.map(opt => (
            <button
              key={opt}
              className={`lm-pf-btn ${value === opt ? 'lm-pf-btn--active' : ''}`}
              style={field.colors?.[opt] ? { background: field.colors[opt] } : undefined}
              onClick={() => onSet(value === opt ? null : opt)}
            >{opt}</button>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'toggle') {
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">{field.label}</span>
        <div className="lm-pf-controls">
          <button
            className={`lm-pf-toggle ${value ? 'lm-pf-toggle--on' : ''}`}
            onClick={() => onSet(value ? null : true)}
          >
            {value ? (field.onLabel ?? 'Taken ✓') : (field.offLabel ?? 'Not taken')}
          </button>
        </div>
      </div>
    )
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    function toggle(opt) {
      const next = selected.includes(opt)
        ? selected.filter(s => s !== opt)
        : [...selected, opt]
      onSet(next.length ? next : null)
    }
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">{field.label}</span>
        <div className="lm-pf-controls lm-pf-controls--wrap">
          {field.options.map(opt => {
            const on = selected.includes(opt)
            const color = field.colors?.[opt]
            return (
              <button
                key={opt}
                className={`lm-pf-pill ${on ? 'lm-pf-pill--on' : ''}`}
                style={on && color ? { background: color, borderColor: color, color: '#1e293b' } : undefined}
                onClick={() => toggle(opt)}
              >{opt}</button>
            )
          })}
        </div>
      </div>
    )
  }

  if (field.type === 'text') {
    return (
      <div className="lm-pf-row lm-pf-row--text">
        <span className="lm-pf-label">{field.label}</span>
        <textarea
          className="lm-pf-textarea"
          placeholder="Optional note…"
          value={value ?? ''}
          onChange={e => onSet(e.target.value || null)}
        />
      </div>
    )
  }

  if (field.type === 'count') {
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">{field.label}</span>
        <div className="lm-pf-controls">
          {field.options.map(opt => (
            <button
              key={opt}
              className={`lm-pf-btn ${value === opt ? 'lm-pf-btn--active' : ''}`}
              onClick={() => onSet(value === opt ? null : opt)}
            >{opt}</button>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">{field.label}</span>
        <div className="lm-pf-controls">
          <input
            className="lm-pf-number"
            type="number"
            placeholder={field.placeholder}
            value={value ?? ''}
            onChange={e => onSet(e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      </div>
    )
  }

  return null
}

export { MODULES, MODULE_EMOJI, COMPLETE_CHECK, PopoverField }
