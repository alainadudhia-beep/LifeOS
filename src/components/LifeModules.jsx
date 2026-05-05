import { useState, useEffect, useRef, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import { getDays, MONTH_NAMES, DAY_ABBR } from '../utils/timeline'
import { DAY_WIDTH } from '../data/initialData'
import './LifeModules.css'

// ─── colour palettes ──────────────────────────────────────────────────────────

const H5 = { 1: '#fee2e2', 2: '#fde8c8', 3: '#fef9c3', 4: '#dcfce7', 5: '#86efac' }
const SLEEP_H         = { '<5': '#fee2e2', '5': '#fde8c8', '6': '#fef9c3', '7': '#dcfce7', '8': '#bbf7d0', '9+': '#86efac' }
const SEVERITY_COLORS = { None: '#bbf7d0', Low: '#fef9c3', Med: '#fde8c8', Bad: '#fee2e2' }
const EXERCISE_SHORT  = { 'Yoga': 'Yoga', 'Pilates': 'Pilates', 'Long walk': 'Walk', 'Gym': 'Gym' }
const ACTIVITY_TEXT   = { 'Yoga': '#6b21a8', 'Pilates': '#9d174d', 'Walk': '#0e7490', 'Gym': '#1e40af' }

// ─── sleep colour helpers (Fitbit + old manual fallback) ──────────────────────

const HOURS_SCORE   = { '<5': 0, '5': 1, '6': 2, '7': 3, '8': 4, '9+': 5 }
const QUALITY_SCORE = { Poor: 0, Fair: 1, Good: 2 }
const SLEEP_COLORS  = [
  '#fee2e2', '#fde8c8', '#fef9c3',
  '#fef9c3', '#dcfce7', '#bbf7d0',
  '#86efac', '#4ade80',
]

// Fitbit-sourced colour (sleep_minutes + in_bed_minutes)
function sleepColorFromFitbit(sleepMin, inBedMin) {
  if (sleepMin == null) return null
  const hrs     = sleepMin / 60
  const hBucket = hrs < 5 ? '<5' : hrs < 6 ? '5' : hrs < 7 ? '6' : hrs < 8 ? '7' : hrs < 9 ? '8' : '9+'
  const h       = HOURS_SCORE[hBucket]
  if (!inBedMin) return SLEEP_H[hBucket]
  const eff = sleepMin / inBedMin
  const q   = eff >= 0.85 ? 2 : eff >= 0.70 ? 1 : 0
  return SLEEP_COLORS[h + q] ?? '#4ade80'
}

// Old manual-entry colour (hours bucket + quality)
function sleepColorFromOldData(d) {
  if (!d?.hours) return null
  const h = HOURS_SCORE[d.hours]
  if (h == null) return SLEEP_H[d.hours] ?? null
  const q = d.quality != null ? (QUALITY_SCORE[d.quality] ?? null) : null
  if (q == null) return SLEEP_H[d.hours]
  return SLEEP_COLORS[h + q] ?? '#4ade80'
}

function sleepEffLabel(sleepMin, inBedMin) {
  if (!sleepMin || !inBedMin) return null
  const eff = sleepMin / inBedMin
  return eff >= 0.85 ? 'Good' : eff >= 0.70 ? 'Fair' : 'Poor'
}

function fmtMins(mins) {
  if (mins == null) return '—'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── scoring ──────────────────────────────────────────────────────────────────

function scoreToSummary(score) {
  if (score >= 2.3) return { label: 'Great', bg: '#86efac' }
  if (score >= 2.0) return { label: 'Good',  bg: '#dcfce7' }
  if (score >= 1.3) return { label: 'Fair',  bg: '#fef9c3' }
  return { label: 'Poor', bg: '#fee2e2' }
}

const SEVERITY_SCORE = { None: 3, Low: 2, Med: 1.5, Bad: 0 }
const PROTEIN_SCORE  = { Low: 1, Med: 2, High: 3 }
const FRUIT_SCORE    = { '1': 1, '2': 1, '3': 2, '4': 2, '5': 3, '6+': 3, '1-2': 1, '3-4': 2, '5+': 3 }
const CARBS_SCORE    = { Low: 2, Med: 3, High: 1 }
const SNACKING_SCORE = { Low: 3, Med: 2, High: 0 }
const SUGAR_SCORE    = { None: 3, Low: 2, Med: 1, High: 0 }

// Diet field weights — fruit_veg counts 2× (biggest dietary signal), carbs/sugar 1.5×
const DIET_WEIGHTS   = { sugar: 1.5, protein: 1, fruit_veg: 2, carbs: 1.5, snacking: 1 }

function avg(nums) {
  const valid = nums.filter(n => n != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

function inflammScore(d) {
  if (!d) return null
  return avg([
    d.eczema           != null ? SEVERITY_SCORE[d.eczema]           : null,
    d.hayfever         != null ? SEVERITY_SCORE[d.hayfever]         : null,
    d.gut              != null ? SEVERITY_SCORE[d.gut]              : null,
    d.wrist_nerve_pain != null ? SEVERITY_SCORE[d.wrist_nerve_pain] : null,
  ])
}

function dietScore(d) {
  if (!d) return null
  const fields = [
    ['sugar',     SUGAR_SCORE,    d.sugar],
    ['protein',   PROTEIN_SCORE,  d.protein],
    ['fruit_veg', FRUIT_SCORE,    d.fruit_veg],
    ['carbs',     CARBS_SCORE,    d.carbs],
    ['snacking',  SNACKING_SCORE, d.snacking],
  ]
  let sum = 0, totalWeight = 0
  for (const [key, table, val] of fields) {
    if (val == null) continue
    const score = table[val]
    if (score == null) continue
    const w = DIET_WEIGHTS[key]
    sum += score * w
    totalWeight += w
  }
  if (totalWeight < 2) return null
  return sum / totalWeight
}

function hasAny(d) {
  if (!d) return false
  return Object.values(d).some(v =>
    v !== null && v !== undefined && v !== false && !(Array.isArray(v) && !v.length)
  )
}

// ─── autosync label helper ────────────────────────────────────────────────────

const AutosyncTag = () => (
  <em style={{ fontSize: 9, color: '#94a3b8', fontStyle: 'italic', marginLeft: 4, fontWeight: 400 }}>autosync</em>
)

// ─── module definitions ───────────────────────────────────────────────────────

const MODULE_EMOJI = {
  health:   '💊',
  mood:     '🧠',
  water:    '💧',
  alcohol:  '🍷',
  diet:     '🥗',
  social:   '👥',
}

const MODULES = [
  // ── Inflammation ─────────────────────────────────────────────────────────────
  {
    key: 'health', label: 'Inflammation',
    cellColor: d => { const s = inflammScore(d); return s != null ? scoreToSummary(s).bg : (hasAny(d) ? '#f1f5f9' : null) },
    cellLabel: d => { const s = inflammScore(d); return s != null ? scoreToSummary(s).label : null },
    fields: [
      { key: 'antihistamines',    label: 'Antihistamines',    type: 'options',     options: ['None','1','2','3'],                                  colors: { None: '#f1f5f9', '1': '#e0f2fe', '2': '#bae6fd', '3': '#7dd3fc' } },
      { key: 'eczema',            label: 'Eczema',            type: 'options',     options: ['None','Low','Med','Bad'],                            colors: SEVERITY_COLORS },
      { key: 'eczema_location',   label: 'Location',          type: 'multiselect', options: ['Eyes','Under mouth','Neck','Back of neck','Scalp'] },
      { key: 'hayfever',          label: 'Hayfever',          type: 'options',     options: ['None','Low','Med','Bad'],                            colors: SEVERITY_COLORS },
      { key: 'hayfever_symptoms', label: 'Hayfever\nSymptoms', type: 'multiselect', options: ['Itchy throat','Itchy eyes','Runny nose','Itchy nose'] },
      { key: 'gut',               label: 'Gut',               type: 'options',     options: ['None','Low','Med','Bad'],                            colors: SEVERITY_COLORS },
      { key: 'gut_symptoms',      label: 'Gut Symptoms',      type: 'multiselect', options: ['Bloating','Cramps','Diarrhoea'] },
      { key: 'wrist_nerve_pain',  label: 'Wrist Nerve Pain',  type: 'options',     options: ['None','Low','Med','Bad'],                            colors: SEVERITY_COLORS },
      { key: 'dry_eyes',          label: 'Dry Eyes',          type: 'toggle',      onLabel: 'Yes', offLabel: 'No' },
      { key: 'note',              label: 'Note',              type: 'text' },
    ],
  },

  // ── Mind ─────────────────────────────────────────────────────────────────────
  {
    key: 'mood', label: 'Mind',
    cellColor: d => {
      const vals = ['work', 'life', 'focus'].map(k => d?.[k]).filter(v => v != null)
      if (!vals.length) return null
      return H5[Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)] ?? null
    },
    cellLabel: d => {
      const vals = ['work', 'life', 'focus'].map(k => d?.[k]).filter(v => v != null)
      if (!vals.length) return null
      return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
    },
    fields: [
      { key: 'work',      label: 'Mood (work)', type: 'score',       min: 1, max: 5, colors: H5 },
      { key: 'life',      label: 'Mood (life)', type: 'score',       min: 1, max: 5, colors: H5 },
      { key: 'focus',     label: 'Focus',       type: 'score',       min: 1, max: 5, colors: H5 },
      { key: 'symptoms',  label: 'Symptoms',    type: 'multiselect', options: ['Fatigue','Brain fog','Anxious','Headache'] },
      { key: 'adhd_meds', label: 'ADHD Meds',   type: 'options',     options: ['None','5mg','7.5mg','10mg'], colors: { None: '#f1f5f9', '5mg': '#e0f2fe', '7.5mg': '#bae6fd', '10mg': '#7dd3fc' } },
      { key: 'melatonin', label: 'Melatonin',   type: 'toggle' },
      { key: 'note',      label: 'Note',        type: 'text' },
    ],
  },

  // ── Water ─────────────────────────────────────────────────────────────────────
  {
    key: 'water', label: 'Water',
    cellColor: d => {
      const v = d?.glasses
      if (v == null) return null
      const n = v === '8+' ? 8 : typeof v === 'number' ? v : parseInt(v)
      if (!isNaN(n)) {
        if (n === 0) return '#f1f5f9'
        if (n <= 2) return '#fee2e2'
        if (n === 3) return '#fde8c8'
        if (n <= 5) return '#fef9c3'
        if (n === 6) return '#dcfce7'
        if (n === 7) return '#bbf7d0'
        return '#86efac'
      }
      // backward compat for old bucket strings
      return { '<3': '#fee2e2', '4-6': '#fef9c3', '7+': '#bbf7d0' }[v] ?? null
    },
    cellLabel: d => d?.glasses != null ? String(d.glasses) : null,
    fields: [
      { key: 'glasses', label: 'Glasses', type: 'options',
        options: ['0','1','2','3','4','5','6','7','8+'],
        colors: { '0': '#f1f5f9', '1': '#fee2e2', '2': '#fee2e2', '3': '#fde8c8', '4': '#fef9c3', '5': '#fef9c3', '6': '#dcfce7', '7': '#bbf7d0', '8+': '#86efac' },
      },
    ],
  },

  // ── Alcohol ───────────────────────────────────────────────────────────────────
  {
    key: 'alcohol', label: 'Alcohol',
    cellColor: d => {
      const v = d?.level
      if (v == null) return null
      if (v === 'None' || v === '0') return '#bbf7d0'
      if (v === '1' || v === '2' || v === '1-2') return '#fef9c3'
      if (v === '3' || v === '4' || v === '3-4') return '#fde8c8'
      return '#fee2e2'
    },
    cellLabel: d => d?.level ?? null,
    fields: [
      { key: 'level', label: 'Drinks', type: 'options',     options: ['None','1','2','3','4','5+'], colors: { None: '#bbf7d0', '1': '#fef9c3', '2': '#fef9c3', '3': '#fde8c8', '4': '#fde8c8', '5+': '#fee2e2' } },
      { key: 'type',  label: 'Type',   type: 'multiselect', options: ['Wine','Beer','Spirits'] },
    ],
  },

  // ── Diet ──────────────────────────────────────────────────────────────────────
  {
    key: 'diet', label: 'Diet',
    cellColor: d => { const s = dietScore(d); return s != null ? scoreToSummary(s).bg : (hasAny(d) ? '#f1f5f9' : null) },
    cellLabel: d => { const s = dietScore(d); return s != null ? scoreToSummary(s).label : null },
    fields: [
      { key: 'caffeine',    label: 'Caffeine',    type: 'options',     options: ['0','1','2','3','4+'],        colors: { '0': '#e2e8f0', '1': '#bbf7d0', '2': '#dcfce7', '3': '#fef9c3', '4+': '#fee2e2' } },
      { key: 'sugar',       label: 'Sugar',       type: 'options',     options: ['None','Low','Med','High'],    colors: { None: '#bbf7d0', Low: '#fef9c3', Med: '#fde8c8', High: '#fee2e2' } },
      { key: 'protein',     label: 'Protein',     type: 'options',     options: ['Low','Med','High'],           colors: { Low: '#fef9c3', Med: '#dcfce7', High: '#bbf7d0' } },
      { key: 'fruit_veg',   label: 'Fruit & Veg', type: 'options',     options: ['1','2','3','4','5','6+'],    colors: { '1': '#fee2e2', '2': '#fde8c8', '3': '#fef9c3', '4': '#dcfce7', '5': '#bbf7d0', '6+': '#86efac' } },
      { key: 'carbs',       label: 'Carbs',       type: 'options',     options: ['Low','Med','High'],           colors: { Low: '#fef9c3', Med: '#dcfce7', High: '#fef9c3' } },
      { key: 'snacking',    label: 'Snacking',    type: 'options',     options: ['Low','Med','High'],           colors: { Low: '#bbf7d0', Med: '#fef9c3', High: '#fee2e2' } },
      { key: 'allergens',   label: 'Allergens',   type: 'multiselect', options: ['Dairy','Gluten','Soy','Wheat','Yeast'] },
      { key: 'supplements', label: 'Supplements', type: 'multiselect', options: ['Omega 3','Collagen','Turmeric','Vitamin B','Vitamin C','Biotin','Adaptogenic Mushrooms'] },
      { key: 'note',        label: 'Notes',       type: 'text' },
    ],
  },

  // ── Social ────────────────────────────────────────────────────────────────────
  {
    key: 'social', label: 'Social',
    cellColor: d => d == null ? null : (d.activities?.length ? '#f1f5f9' : '#dde3eb'),
    cellLabel: d => {
      if (!d?.activities?.length) return null
      const SHORT = { 'Work drinks': 'W.drinks', 'Work from office': 'Office', 'Used dating apps': 'Apps', 'Networking': 'Network' }
      const seen = new Set()
      return d.activities.map(a => SHORT[a] ?? a).filter(a => seen.has(a) ? false : seen.add(a))
    },
    fields: [
      { key: 'activities', label: 'Events', type: 'multiselect', options: ['Friends','Family','Date','Party','Work drinks','Work from office','Used dating apps','Networking'] },
    ],
  },
]

// ── Exercise module (custom row — colour by energy, calories via Fitbit) ──────
const EXERCISE_MODULE = {
  key: 'exercise', label: 'Exercise',
  fields: [
    { key: 'energy',     label: 'Energy',     type: 'score',       min: 1, max: 5, colors: H5 },
    { key: 'activities', label: 'Activities', type: 'multiselect', options: ['Yoga','Pilates','Long walk','Gym'], colors: { 'Yoga': '#e9d5ff', 'Pilates': '#fce7f3', 'Long walk': '#cffafe', 'Gym': '#dbeafe' } },
  ],
}

// ── Body module (custom row — weight injected from Fitbit for readonly display)
const BODY_MODULE = {
  key: 'body', label: 'Body',
  fields: [
    { key: '_weight_kg',  label: 'Weight',             type: 'readonly', unit: 'kg', autosync: true },
    { key: 'period',      label: 'Period',             type: 'toggle',   onLabel: 'Yes', offLabel: 'No' },
    { key: 'pill',        label: 'Contraceptive Pill', type: 'toggle',   onLabel: 'Yes', offLabel: 'No' },
    { key: 'illness',     label: 'Illness',            type: 'options',  options: ['None','Cold','Flu','Sick'], colors: { None: '#f1f5f9', Cold: '#fde8c8', Flu: '#fde8c8', Sick: '#fee2e2' } },
    { key: 'painkillers', label: 'Painkillers',        type: 'options',  options: ['0','2','4','6'],           colors: { '0': '#f1f5f9', '2': '#fef9c3', '4': '#fde8c8', '6': '#fee2e2' } },
  ],
}

// ─── completion checks ────────────────────────────────────────────────────────

const COMPLETE_CHECK = {
  health:   d => d?.eczema != null && d?.hayfever != null,
  mood:     d => d?.work != null && d?.life != null && d?.focus != null,
  water:    d => d?.glasses != null,
  alcohol:  d => d?.level != null,
  diet:     d => d?.sugar != null && d?.protein != null && d?.fruit_veg != null && d?.carbs != null && d?.snacking != null,
}

// ─── derived data ─────────────────────────────────────────────────────────────

const allDays      = getDays()
const todayIso     = new Date().toISOString().slice(0, 10)
const yesterdayIso = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const DAY_SHORT = DAY_ABBR

// ─── main component ───────────────────────────────────────────────────────────

export default function LifeModules({ mobile } = {}) {
  const gridDays  = mobile
    ? allDays.filter(d => d.toISOString().slice(0, 10) < todayIso)
    : allDays
  const gridWidth = gridDays.length * DAY_WIDTH

  const [logs, setLogs] = useLocalStorage('lifetracker-life-logs', {})
  const [fitbitRaw]     = useLocalStorage('lifetracker-fitbit-raw', {})

  const [activeCell, setActiveCell] = useState(null)
  const [sleepOpen,  setSleepOpen]  = useState(null)   // iso date
  const [stepsOpen,  setStepsOpen]  = useState(null)   // iso date

  const popoverRef     = useRef(null)
  const sleepRef       = useRef(null)
  const sleepCellRefs  = useRef({})
  const stepsRef       = useRef(null)
  const stepsCellRefs  = useRef({})
  const gratRef        = useRef(null)
  const transcriptRef  = useRef(null)

  const [gratEdit,       setGratEdit]       = useState(null)
  const [transcriptOpen, setTranscriptOpen] = useState(null)
  const transcriptCellRefs = useRef({})

  // Sync from voice check-in writes
  useEffect(() => {
    function onLogsUpdated() {
      try {
        const raw = localStorage.getItem('lifetracker-life-logs')
        if (raw) setLogs(JSON.parse(raw))
      } catch { /* ignore */ }
    }
    window.addEventListener('lifetracker-logs-updated', onLogsUpdated)
    return () => window.removeEventListener('lifetracker-logs-updated', onLogsUpdated)
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!activeCell) return
    function onDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setActiveCell(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [activeCell])

  useEffect(() => {
    if (!sleepOpen) return
    function onDown(e) {
      if (sleepRef.current && !sleepRef.current.contains(e.target) &&
          !sleepCellRefs.current[sleepOpen]?.contains(e.target)) setSleepOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sleepOpen])

  useEffect(() => {
    if (!stepsOpen) return
    function onDown(e) {
      if (stepsRef.current && !stepsRef.current.contains(e.target) &&
          !stepsCellRefs.current[stepsOpen]?.contains(e.target)) setStepsOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [stepsOpen])

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
          !transcriptCellRefs.current[transcriptOpen]?.contains(e.target)) setTranscriptOpen(null)
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
      const mod = [...MODULES, EXERCISE_MODULE, BODY_MODULE].find(m => m.key === moduleKey)
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

  // ─── render helpers ──────────────────────────────────────────────────────────

  function renderCell(mod, iso, i, dayData) {
    const bg       = mod.cellColor(dayData)
    const label    = mod.cellLabel(dayData)
    const open     = activeCell?.moduleKey === mod.key && activeCell?.date === iso
    const isFuture = iso > todayIso
    const isRecent = iso === todayIso || iso === yesterdayIso
    const incomplete = isRecent && COMPLETE_CHECK[mod.key] && !COMPLETE_CHECK[mod.key](dayData)
    const isWeekStart = i != null ? new Date(iso).getDay() === 1 : false
    const style = i != null
      ? { left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2, background: bg || undefined }
      : { left: 1, width: DAY_WIDTH - 2, background: bg || undefined }
    return (
      <div
        key={iso}
        className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${open ? 'lm-cell--active' : ''} ${incomplete ? 'lm-cell--incomplete' : ''} ${isWeekStart ? 'lm-cell--week-start' : ''}`}
        style={style}
        title={dayData?.note || undefined}
        onClick={isFuture ? undefined : e => handleCellClick(e, mod.key, iso)}
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
            date={iso}
            dayData={dayData ?? {}}
            onSet={(fieldKey, value) => setFieldValue(mod.key, iso, fieldKey, value)}
          />
        )}
      </div>
    )
  }

  function renderModuleRow(mod) {
    return (
      <div key={mod.key} className="lm-row">
        <div className="lm-label">
          {MODULE_EMOJI[mod.key] && <span className="lm-label-emoji">{MODULE_EMOJI[mod.key]}</span>} {mod.label}
        </div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso = d.toISOString().slice(0, 10)
            return renderCell(mod, iso, i, logs[iso]?.[mod.key] ?? null)
          })}
        </div>
        {mobile && (
          <div className="lm-today-col">
            {renderCell(mod, todayIso, null, logs[todayIso]?.[mod.key] ?? null)}
          </div>
        )}
      </div>
    )
  }

  // ─── JSX ─────────────────────────────────────────────────────────────────────

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
            {gridDays.map((d, i) => (
              <div key={i} className="lm-date-cell" style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}>
                <span className="lm-date-cell-month">{MONTH_NAMES[d.getMonth()]}</span>
                <span className="lm-date-cell-day">{DAY_SHORT[d.getDay()]}</span>
                <span className="lm-date-cell-num">{d.getDate()}</span>
              </div>
            ))}
          </div>
          <div className="lm-today-col lm-today-col--header">
            <span className="lm-date-cell-month lm-date-cell-day--today">{MONTH_NAMES[new Date(todayIso).getMonth()]}</span>
            <span className="lm-date-cell-day lm-date-cell-day--today">{DAY_SHORT[new Date(todayIso).getDay()]}</span>
            <span className="lm-date-cell-num lm-date-cell-num--today">{new Date(todayIso).getDate()}</span>
          </div>
        </div>
      )}

      {/* ── 1. Sleep (autosync + old manual fallback, click for detail) ── */}
      <div className="lm-row">
        <div className="lm-label"><span className="lm-label-emoji">😴</span> Sleep<AutosyncTag /></div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso      = d.toISOString().slice(0, 10)
            const raw      = fitbitRaw[iso]
            const sleepMin = raw?.sleep_minutes
            const inBedMin = raw?.in_bed_minutes
            const oldSleep = logs[iso]?.sleep  // backward compat
            const hasFitbit = sleepMin != null
            const hasOld    = !hasFitbit && oldSleep?.hours != null
            const bg        = hasFitbit ? sleepColorFromFitbit(sleepMin, inBedMin)
              : hasOld ? sleepColorFromOldData(oldSleep) : null
            const hrs    = hasFitbit ? sleepMin / 60 : null
            const label  = hasFitbit ? `${hrs.toFixed(1)}h` : (hasOld ? oldSleep.hours : null)
            const isOpen = sleepOpen === iso
            const hasData = hasFitbit || hasOld
            return (
              <div
                key={iso}
                ref={el => { sleepCellRefs.current[iso] = el }}
                className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={hasData ? () => setSleepOpen(isOpen ? null : iso) : undefined}
              >
                {label && <span className="lm-cell-label">{label}</span>}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const raw      = fitbitRaw[todayIso]
          const sleepMin = raw?.sleep_minutes
          const inBedMin = raw?.in_bed_minutes
          const oldSleep = logs[todayIso]?.sleep
          const hasFitbit = sleepMin != null
          const hasOld    = !hasFitbit && oldSleep?.hours != null
          const bg     = hasFitbit ? sleepColorFromFitbit(sleepMin, inBedMin) : hasOld ? sleepColorFromOldData(oldSleep) : null
          const hrs    = hasFitbit ? sleepMin / 60 : null
          const label  = hasFitbit ? `${hrs.toFixed(1)}h` : (hasOld ? oldSleep.hours : null)
          const isOpen = sleepOpen === todayIso
          const hasData = hasFitbit || hasOld
          return (
            <div className="lm-today-col">
              <div
                ref={el => { sleepCellRefs.current[todayIso] = el }}
                className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''}`}
                style={{ left: 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={hasData ? () => setSleepOpen(isOpen ? null : todayIso) : undefined}
              >
                {label && <span className="lm-cell-label">{label}</span>}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── 2. Steps + Calories (autosync, click for detail) ── */}
      <div className="lm-row">
        <div className="lm-label"><span className="lm-label-emoji">👟</span> Steps<AutosyncTag /></div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso    = d.toISOString().slice(0, 10)
            const raw    = fitbitRaw[iso]
            const steps  = raw?.steps
            const active = raw?.active_energy_kcal
            const bg     = steps == null ? null
              : steps < 4000  ? '#fee2e2'
              : steps < 6000  ? '#fde8c8'
              : steps < 8000  ? '#fef9c3'
              : steps < 10000 ? '#dcfce7'
              : steps < 12000 ? '#bbf7d0'
              : '#86efac'
            const isOpen  = stepsOpen === iso
            const hasData = steps != null || active != null
            return (
              <div
                key={iso}
                ref={el => { stepsCellRefs.current[iso] = el }}
                className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={hasData ? () => setStepsOpen(isOpen ? null : iso) : undefined}
              >
                {steps != null && <span className="lm-cell-label">{steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : steps}</span>}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const raw    = fitbitRaw[todayIso]
          const steps  = raw?.steps
          const active = raw?.active_energy_kcal
          const bg     = steps == null ? null : steps < 4000 ? '#fee2e2' : steps < 6000 ? '#fde8c8' : steps < 8000 ? '#fef9c3' : steps < 10000 ? '#dcfce7' : steps < 12000 ? '#bbf7d0' : '#86efac'
          const isOpen  = stepsOpen === todayIso
          const hasData = steps != null || active != null
          return (
            <div className="lm-today-col">
              <div
                ref={el => { stepsCellRefs.current[todayIso] = el }}
                className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''}`}
                style={{ left: 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={hasData ? () => setStepsOpen(isOpen ? null : todayIso) : undefined}
              >
                {steps != null && <span className="lm-cell-label">{steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : steps}</span>}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── autosync / manual divider ── */}
      <div className="lm-autosync-divider" />

      {/* ── 3. Mind ── */}
      {renderModuleRow(MODULES.find(m => m.key === 'mood'))}

      {/* ── 4. Inflammation ── */}
      {renderModuleRow(MODULES.find(m => m.key === 'health'))}

      {/* ── 5. Water ── */}
      {renderModuleRow(MODULES.find(m => m.key === 'water'))}

      {/* ── 6. Alcohol ── */}
      {renderModuleRow(MODULES.find(m => m.key === 'alcohol'))}

      {/* ── 6. Diet ── */}
      {renderModuleRow(MODULES.find(m => m.key === 'diet'))}

      {/* ── 7. Exercise (colour by energy, activities as label, no calorie text) ── */}
      <div className="lm-row">
        <div className="lm-label"><span className="lm-label-emoji">🏃</span> Exercise</div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso     = d.toISOString().slice(0, 10)
            const exData  = logs[iso]?.exercise ?? null
            // Energy: prefer exercise.energy, fall back to old mood.energy for history
            const energy  = exData?.energy ?? logs[iso]?.mood?.energy ?? null
            const bg      = energy != null ? (H5[energy] ?? null) : null
            const acts    = exData?.activities
            const labels  = acts?.length ? acts.map(a => EXERCISE_SHORT[a] ?? a) : null
            const open     = activeCell?.moduleKey === 'exercise' && activeCell?.date === iso
            const isFuture = iso > todayIso
            const isRecent = iso === todayIso || iso === yesterdayIso
            const incomplete = isRecent && !COMPLETE_CHECK.exercise?.(exData)
            return (
              <div
                key={iso}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${open ? 'lm-cell--active' : ''} ${incomplete ? 'lm-cell--incomplete' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={isFuture ? undefined : e => handleCellClick(e, 'exercise', iso)}
              >
                {labels && (
                  <div className="lm-cell-stack">
                    {labels.map(l => (
                      <span key={l} className="lm-cell-label lm-cell-label--act" style={{ color: ACTIVITY_TEXT[l] ?? '#64748b' }}>{l}</span>
                    ))}
                  </div>
                )}
                {open && (
                  <Popover
                    ref={popoverRef}
                    mod={EXERCISE_MODULE}
                    date={iso}
                    dayData={{ ...(exData ?? {}), energy: exData?.energy ?? logs[iso]?.mood?.energy ?? undefined }}
                    onSet={(fk, v) => setFieldValue('exercise', iso, fk, v)}
                  />
                )}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const exData  = logs[todayIso]?.exercise ?? null
          const energy  = exData?.energy ?? logs[todayIso]?.mood?.energy ?? null
          const bg      = energy != null ? (H5[energy] ?? null) : null
          const acts    = exData?.activities
          const labels  = acts?.length ? acts.map(a => EXERCISE_SHORT[a] ?? a) : null
          const open    = activeCell?.moduleKey === 'exercise' && activeCell?.date === todayIso
          const incomplete = !COMPLETE_CHECK.exercise?.(exData)
          return (
            <div className="lm-today-col">
              <div
                className={`lm-cell lm-cell--clickable ${open ? 'lm-cell--active' : ''} ${incomplete ? 'lm-cell--incomplete' : ''}`}
                style={{ left: 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={e => handleCellClick(e, 'exercise', todayIso)}
              >
                {labels && (
                  <div className="lm-cell-stack">
                    {labels.map(l => (
                      <span key={l} className="lm-cell-label lm-cell-label--act" style={{ color: ACTIVITY_TEXT[l] ?? '#64748b' }}>{l}</span>
                    ))}
                  </div>
                )}
                {open && (
                  <Popover ref={popoverRef} mod={EXERCISE_MODULE} date={todayIso} dayData={{ ...(exData ?? {}), energy: exData?.energy ?? logs[todayIso]?.mood?.energy ?? undefined }} onSet={(fk, v) => setFieldValue('exercise', todayIso, fk, v)} />
                )}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── 8. Body (period/pill/illness/painkillers + weight readonly in popover) ── */}
      <div className="lm-row">
        <div className="lm-label"><span className="lm-label-emoji">🌸</span> Body</div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso      = d.toISOString().slice(0, 10)
            const bodyData = logs[iso]?.body ?? {}
            const period   = bodyData.period ?? !!logs[iso]?.period  // backward compat
            const illness  = bodyData.illness
            const kg       = fitbitRaw[iso]?.weight_kg
            const bg       = illness && illness !== 'None' ? '#fee2e2'
              : period ? '#fce7f3'
              : kg != null ? '#f1f5f9'
              : null
            const open     = activeCell?.moduleKey === 'body' && activeCell?.date === iso
            const isFuture = iso > todayIso
            return (
              <div
                key={iso}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${open ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={isFuture ? undefined : e => handleCellClick(e, 'body', iso)}
              >
                {period && <span className="lm-period-dot" />}
                {open && (
                  <Popover
                    ref={popoverRef}
                    mod={BODY_MODULE}
                    date={iso}
                    dayData={{ ...bodyData, _weight_kg: kg != null ? (kg % 1 === 0 ? String(kg) : kg.toFixed(1)) : null }}
                    onSet={(fk, v) => { if (!fk.startsWith('_')) setFieldValue('body', iso, fk, v) }}
                  />
                )}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const bodyData = logs[todayIso]?.body ?? {}
          const period   = bodyData.period ?? !!logs[todayIso]?.period
          const illness  = bodyData.illness
          const kg       = fitbitRaw[todayIso]?.weight_kg
          const bg       = illness && illness !== 'None' ? '#fee2e2' : period ? '#fce7f3' : kg != null ? '#f1f5f9' : null
          const open     = activeCell?.moduleKey === 'body' && activeCell?.date === todayIso
          return (
            <div className="lm-today-col">
              <div
                className={`lm-cell lm-cell--clickable ${open ? 'lm-cell--active' : ''}`}
                style={{ left: 1, width: DAY_WIDTH - 2, background: bg || undefined }}
                onClick={e => handleCellClick(e, 'body', todayIso)}
              >
                {period && <span className="lm-period-dot" />}
                {open && (
                  <Popover
                    ref={popoverRef}
                    mod={BODY_MODULE}
                    date={todayIso}
                    dayData={{ ...bodyData, _weight_kg: kg != null ? (kg % 1 === 0 ? String(kg) : kg.toFixed(1)) : null }}
                    onSet={(fk, v) => { if (!fk.startsWith('_')) setFieldValue('body', todayIso, fk, v) }}
                  />
                )}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── 10. Social ── */}
      {renderModuleRow(MODULES.find(m => m.key === 'social'))}

      {/* ── 11. Gratitude ── */}
      <div className="lm-row lm-row--gratitude">
        <div className="lm-label"><span className="lm-label-emoji">🙏</span> Gratitude</div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso       = d.toISOString().slice(0, 10)
            const text      = logs[iso]?.gratitude ?? null
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
                      className="lm-grat-input" autoFocus placeholder="What are you grateful for?"
                      value={gratEdit.value}
                      onChange={e => setGratEdit(g => ({ ...g, value: e.target.value }))}
                      onBlur={saveGratitude}
                      onKeyDown={e => { if (e.key === 'Enter') saveGratitude(); if (e.key === 'Escape') setGratEdit(null) }}
                    />
                  </div>
                ) : text ? <span className="lm-grat-emoji" data-tooltip={text}>🙏</span> : null}
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
                      className="lm-grat-input" autoFocus placeholder="What are you grateful for?"
                      value={gratEdit.value}
                      onChange={e => setGratEdit(g => ({ ...g, value: e.target.value }))}
                      onBlur={saveGratitude}
                      onKeyDown={e => { if (e.key === 'Enter') saveGratitude(); if (e.key === 'Escape') setGratEdit(null) }}
                    />
                  </div>
                ) : text ? <span className="lm-grat-emoji" data-tooltip={text}>🙏</span> : null}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── 12. Journal ── */}
      <div className="lm-row lm-row--transcript">
        <div className="lm-label"><span className="lm-label-emoji">📝</span> Journal</div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} />
          {gridDays.map((d, i) => {
            const iso         = d.toISOString().slice(0, 10)
            const transcripts = logs[iso]?.transcripts ?? []
            const hasEntry    = transcripts.length > 0
            const isOpen      = transcriptOpen === iso
            const isFuture    = iso > todayIso
            return (
              <div
                key={iso}
                ref={el => { transcriptCellRefs.current[iso] = el }}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : hasEntry ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * DAY_WIDTH + 1, width: DAY_WIDTH - 2 }}
                onClick={!isFuture && hasEntry ? () => setTranscriptOpen(isOpen ? null : iso) : undefined}
              >
                {hasEntry && <span className="lm-transcript-dot" title={`${transcripts.length} entry`}>📝</span>}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const transcripts = logs[todayIso]?.transcripts ?? []
          const hasEntry    = transcripts.length > 0
          const isOpen      = transcriptOpen === todayIso
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

      {/* ── Sleep info portal ── */}
      {sleepOpen && (() => {
        const cellEl   = sleepCellRefs.current[sleepOpen]
        if (!cellEl) return null
        const raw      = fitbitRaw[sleepOpen]
        const sleepMin = raw?.sleep_minutes
        const inBedMin = raw?.in_bed_minutes
        const oldSleep = logs[sleepOpen]?.sleep
        const hasFitbit = sleepMin != null
        const eff       = hasFitbit && inBedMin ? Math.round(sleepMin / inBedMin * 100) : null
        const effLabel  = sleepEffLabel(sleepMin, inBedMin)
        const effColor  = effLabel === 'Good' ? '#16a34a' : effLabel === 'Fair' ? '#ca8a04' : '#dc2626'
        const rect = cellEl.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 220)
        const top  = rect.bottom + 8
        return createPortal(
          <div
            ref={sleepRef}
            style={{ position: 'fixed', top, left, zIndex: 1000, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 180 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{fmtDate(sleepOpen)}</div>
            {hasFitbit ? (
              <>
                <div style={{ fontSize: 12, color: '#64748b' }}>Asleep: <strong>{fmtMins(sleepMin)}</strong></div>
                <div style={{ fontSize: 12, color: '#64748b' }}>In bed: <strong>{fmtMins(inBedMin)}</strong></div>
                {eff != null && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    Efficiency: <strong style={{ color: effColor }}>{eff}% — {effLabel}</strong>
                  </div>
                )}
              </>
            ) : oldSleep ? (
              <>
                <div style={{ fontSize: 12, color: '#64748b' }}>Hours: <strong>{oldSleep.hours}</strong></div>
                {oldSleep.quality && <div style={{ fontSize: 12, color: '#64748b' }}>Quality: <strong>{oldSleep.quality}</strong></div>}
                {oldSleep.melatonin && <div style={{ fontSize: 12, color: '#64748b' }}>Melatonin: <strong>Yes</strong></div>}
              </>
            ) : null}
          </div>,
          document.body
        )
      })()}

      {/* ── Steps + Calories info portal ── */}
      {stepsOpen && (() => {
        const cellEl  = stepsCellRefs.current[stepsOpen]
        if (!cellEl) return null
        const raw     = fitbitRaw[stepsOpen]
        const steps   = raw?.steps
        const active  = raw?.active_energy_kcal
        const resting = raw?.resting_energy_kcal
        const total   = active != null ? Math.round(active + (resting ?? 0)) : null
        const rect = cellEl.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 220)
        const top  = rect.bottom + 8
        return createPortal(
          <div
            ref={stepsRef}
            style={{ position: 'fixed', top, left, zIndex: 1000, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 180 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{fmtDate(stepsOpen)}</div>
            {steps != null && (
              <div style={{ fontSize: 12, color: '#64748b' }}>Steps: <strong>{steps.toLocaleString()}</strong></div>
            )}
            {total != null && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Calories: <strong>{total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total} kcal</strong>
              </div>
            )}
            {active != null && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                Active {Math.round(active)} · Resting {Math.round(resting ?? 0)}
              </div>
            )}
          </div>,
          document.body
        )
      })()}

      {/* ── Transcript portal ── */}
      {transcriptOpen && (() => {
        const cellEl      = transcriptCellRefs.current[transcriptOpen]
        const transcripts = logs[transcriptOpen]?.transcripts ?? []
        if (!cellEl) return null
        const rect = cellEl.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 340)
        const top  = rect.top - 10
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
      : <div key={i} className="lm-day-line"  style={{ left: i * DAY_WIDTH }} />
  )
}

// ─── Popover ──────────────────────────────────────────────────────────────────

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
  if (field.type === 'readonly') {
    if (value == null) return null
    const display = field.unit ? `${value} ${field.unit}` : String(value)
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">
          {field.label}
          {field.autosync && <AutosyncTag />}
        </span>
        <div className="lm-pf-controls">
          <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>{display}</span>
        </div>
      </div>
    )
  }

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
            >{v}</button>
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
    // Two explicit buttons — both show their selected state
    return (
      <div className="lm-pf-row">
        <span className="lm-pf-label">{field.label}</span>
        <div className="lm-pf-controls">
          <button
            className={`lm-pf-btn ${!value ? 'lm-pf-btn--active' : ''}`}
            style={!value ? { background: '#f1f5f9' } : undefined}
            onClick={() => onSet(null)}
          >{field.offLabel ?? 'No'}</button>
          <button
            className={`lm-pf-btn ${value ? 'lm-pf-btn--active' : ''}`}
            style={value ? { background: '#bbf7d0' } : undefined}
            onClick={() => onSet(true)}
          >{field.onLabel ?? 'Yes'}</button>
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
            const on    = selected.includes(opt)
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

export { MODULES, MODULE_EMOJI, COMPLETE_CHECK, PopoverField, EXERCISE_MODULE, BODY_MODULE, sleepColorFromFitbit, sleepColorFromOldData, sleepEffLabel, fmtMins }
