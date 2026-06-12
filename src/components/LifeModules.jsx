import { useState, useEffect, useRef, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import { getDays, MONTH_NAMES, DAY_ABBR } from '../utils/timeline'
import { DAY_WIDTH } from '../data/initialData'
import './LifeModules.css'

// ─── colour palettes ──────────────────────────────────────────────────────────

const H5 = { 1: '#fee2e2', 2: '#fde8c8', 3: '#fef9c3', 4: '#dcfce7', 5: '#86efac' }
// Sleep: red / orange / yellow / light-green / green / dark-green  (<5 / 5-6 / 6-7 / 7-8 / 8-9 / 9+)
const SLEEP_H         = { '<5': '#fee2e2', '5': '#fde8c8', '6': '#fef9c3', '7': '#dcfce7', '8': '#bbf7d0', '9+': '#86efac' }
const SEVERITY_COLORS = { None: '#bbf7d0', Low: '#fef9c3', Med: '#fde8c8', Bad: '#fee2e2' }
const EXERCISE_SHORT  = { 'Yoga': 'Yoga', 'Pilates': 'Pilates', 'Dog walk': 'Walk', 'Gym': 'Gym' }
const ACTIVITY_TEXT   = { 'Yoga': '#6b21a8', 'Pilates': '#9d174d', 'Walk': '#0e7490', 'Gym': '#1e40af' }

// ─── sleep colour helpers (Fitbit + old manual fallback) ──────────────────────

// Fitbit-sourced colour — simple hours-based scale
function sleepColorFromFitbit(sleepMin) {
  if (sleepMin == null || sleepMin > 960) return null
  const hrs = sleepMin / 60
  return hrs >= 9 ? '#86efac'
    : hrs >= 8 ? '#bbf7d0'
    : hrs >= 7 ? '#dcfce7'
    : hrs >= 6 ? '#fef9c3'
    : hrs >= 5 ? '#fde8c8'
    : '#fee2e2'
}

// Old manual-entry colour (hours bucket)
function sleepColorFromOldData(d) {
  if (!d?.hours) return null
  return SLEEP_H[d.hours] ?? null
}

function sleepEffLabel(sleepMin, inBedMin) {
  if (!sleepMin || !inBedMin) return null
  const eff = sleepMin / inBedMin
  return eff >= 0.90 ? 'Great' : eff >= 0.82 ? 'Good' : eff >= 0.70 ? 'Fair' : 'Poor'
}

function fmtMins(mins, round = 5) {
  if (mins == null) return '—'
  const rounded = Math.round(mins / round) * round
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── scoring ──────────────────────────────────────────────────────────────────

// 5-level scale used by Diet (numeric) and categorical modules
// Great > Good > Fair > Ok > Poor
function scoreToSummary(score) {
  if (score >= 2.3) return { label: 'Great', bg: '#86efac' }
  if (score >= 2.0) return { label: 'Good',  bg: '#dcfce7' }
  if (score >= 1.7) return { label: 'Fair',  bg: '#fef9c3' }
  if (score >= 1.3) return { label: 'Poor',  bg: '#fde8c8' }
  return { label: 'Bad',  bg: '#fee2e2' }
}

const SEVERITY_SCORE = { None: 3, Low: 2, Med: 1.5, Bad: 0 }
const PROTEIN_SCORE  = { Low: 1, Med: 2, High: 3 }
const FRUIT_SCORE    = { '1': 1, '2': 1, '3': 2, '4': 2, '5': 3, '6+': 3, '1-2': 1, '3-4': 2, '5+': 3 }
const CARBS_SCORE    = { Low: 2, Med: 3, High: 1 }
const SNACKING_SCORE = { Low: 3, Med: 2, High: 0 }
const SUGAR_SCORE    = { None: 3, Low: 2, Med: 1, High: 0 }
const FATS_SCORE     = { Low: 1, Med: 3, High: 0 } // Med = sweet spot (healthy fats), Low = not enough, High = too much

// Diet field weights — fruit_veg counts 2× (biggest dietary signal), carbs/sugar 1.5×
const DIET_WEIGHTS   = { sugar: 1.5, protein: 1, fruit_veg: 2, carbs: 1.5, snacking: 1, fats: 1 }

function avg(nums) {
  const valid = nums.filter(n => n != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

// ─── categorical rating (Allergies + Body) ───────────────────────────────────
// Rules agreed with user:
//   Great — all filled values are None
//   Good  — no Meds/Bads, at least one Low and at least one None
//   Fair  — exactly 1 Med (no Bads), OR all filled are Low (no Nones, no Bads)
//   Poor  — 2+ Meds, OR any Bad

function categoricalRating(severityValues) {
  // severityValues: array of 'None'|'Low'|'Med'|'Bad' strings (pre-filtered to non-null)
  if (!severityValues.length) return null
  let nones = 0, lows = 0, meds = 0, bads = 0
  for (const v of severityValues) {
    if (v === 'None') nones++
    else if (v === 'Low') lows++
    else if (v === 'Med') meds++
    else if (v === 'Bad') bads++
  }
  // Bad:   2+ Med OR any Bad
  if (bads >= 1 || meds >= 2)                               return { label: 'Bad',   bg: '#fee2e2' }
  // Poor:  1 Med + at least 1 Low
  if (meds === 1 && lows >= 1)                              return { label: 'Poor',  bg: '#fde8c8' }
  // Fair:  2–3 Lows, rest None (no Med/Bad)
  //        OR 1 Med but everything else is None
  if ((lows >= 2 && meds === 0 && bads === 0) ||
      (meds === 1 && lows === 0 && nones > 0))              return { label: 'Fair',  bg: '#fef9c3' }
  // Good:  exactly 1 Low, rest None, no Med/Bad
  if (lows === 1 && meds === 0 && bads === 0 && nones >= 1) return { label: 'Good',  bg: '#dcfce7' }
  // Great: all None
  if (nones > 0)                                            return { label: 'Great', bg: '#86efac' }
  return null
}

function allergiesRating(d) {
  if (!d) return null
  const vals = [d.eczema, d.hayfever, d.episcleritis].filter(v => v != null)
  return categoricalRating(vals)
}

// Illness severity mapped to the same None/Low/Med/Bad scale
const ILLNESS_TO_SEV = { None: 'None', Cold: 'Low', Flu: 'Med', Sick: 'Bad' }

function bodyRating(d) {
  if (!d) return null
  const vals = [
    d.knee_pain,
    d.wrist_nerve_pain,
    d.gut,
    d.illness != null ? ILLNESS_TO_SEV[d.illness] : null,
  ].filter(v => v != null)
  return categoricalRating(vals)
}

function dietScore(d) {
  if (!d) return null
  const fields = [
    ['sugar',     SUGAR_SCORE,    d.sugar],
    ['protein',   PROTEIN_SCORE,  d.protein],
    ['fruit_veg', FRUIT_SCORE,    d.fruit_veg],
    ['carbs',     CARBS_SCORE,    d.carbs],
    ['snacking',  SNACKING_SCORE, d.snacking],
    ['fats',      FATS_SCORE,     d.fats],
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

// ─── recovery scoring ─────────────────────────────────────────────────────────

const RECOVERY_TIERS  = ['Bad', 'Poor', 'Fair', 'Good', 'Great']
const RECOVERY_BG_MAP = ['#fee2e2', '#fde8c8', '#fef9c3', '#dcfce7', '#86efac']
const TIER_IDX        = { Bad: 0, Poor: 1, Fair: 2, Good: 3, Great: 4 }

function spo2Rating(pct) {
  if (pct == null) return null
  if (pct >= 97) return { label: 'Great', bg: '#86efac' }
  if (pct >= 95) return { label: 'Good',  bg: '#dcfce7' }
  if (pct >= 93) return { label: 'Fair',  bg: '#fef9c3' }
  if (pct >= 91) return { label: 'Poor',  bg: '#fde8c8' }
  return               { label: 'Bad',   bg: '#fee2e2' }
}

function respRateRating(bpm) {
  if (bpm == null) return null
  if (bpm >= 12 && bpm <= 16) return { label: 'Great', bg: '#86efac' }
  if (bpm >= 10 && bpm <= 18) return { label: 'Good',  bg: '#dcfce7' }
  if (bpm >= 8  && bpm <= 20) return { label: 'Fair',  bg: '#fef9c3' }
  if (bpm >= 6  && bpm <= 22) return { label: 'Poor',  bg: '#fde8c8' }
  return                      { label: 'Bad',   bg: '#fee2e2' }
}

function skinTempRating(dev) {
  if (dev == null) return null
  if (dev >= -0.1 && dev <= 0.3) return { label: 'Great', bg: '#86efac' }
  if (dev >= -0.2 && dev <= 0.5) return { label: 'Good',  bg: '#dcfce7' }
  if (dev >= -0.3 && dev <= 1.0) return { label: 'Fair',  bg: '#fef9c3' }
  if (dev >= -0.5 && dev <= 1.5) return { label: 'Poor',  bg: '#fde8c8' }
  return                         { label: 'Bad',   bg: '#fee2e2' }
}

function sleepScoreRating(score) {
  if (score == null) return null
  if (score >= 83) return { label: 'Great', bg: '#86efac' }
  if (score >= 75) return { label: 'Good',  bg: '#dcfce7' }
  if (score >= 68) return { label: 'Fair',  bg: '#fef9c3' }
  if (score >= 60) return { label: 'Poor',  bg: '#fde8c8' }
  return                  { label: 'Bad',   bg: '#fee2e2' }
}

function deepPctRating(deepMin, sleepMin) {
  if (deepMin == null || sleepMin == null || sleepMin === 0) return null
  const pct = deepMin / sleepMin * 100
  if (pct >= 22) return { label: 'Great', bg: '#86efac',  pct }
  if (pct >= 18) return { label: 'Good',  bg: '#dcfce7',  pct }
  if (pct >= 14) return { label: 'Fair',  bg: '#fef9c3',  pct }
  if (pct >= 10) return { label: 'Poor',  bg: '#fde8c8',  pct }
  return                { label: 'Bad',   bg: '#fee2e2',  pct }
}

function remPctRating(remMin, sleepMin) {
  if (remMin == null || sleepMin == null || sleepMin === 0) return null
  const pct = remMin / sleepMin * 100
  if (pct >= 22) return { label: 'Great', bg: '#86efac',  pct }
  if (pct >= 18) return { label: 'Good',  bg: '#dcfce7',  pct }
  if (pct >= 14) return { label: 'Fair',  bg: '#fef9c3',  pct }
  if (pct >= 10) return { label: 'Poor',  bg: '#fde8c8',  pct }
  return                { label: 'Bad',   bg: '#fee2e2',  pct }
}

// 30-day rolling HRV average — excludes the target date itself (so today's reading compares against prior nights)
function rollingHrvAvg(fitbitRaw, iso) {
  const d = new Date(iso)
  const vals = []
  for (let i = 1; i <= 30; i++) {
    const dd = new Date(d)
    dd.setDate(dd.getDate() - i)
    const v = fitbitRaw[dd.toISOString().slice(0, 10)]?.hrv
    if (v != null) vals.push(v)
  }
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function hrvRating(hrv, avg) {
  if (hrv == null) return null
  if (avg != null) {
    const r = hrv / avg
    if (r >= 1.20) return { label: 'Great', bg: '#86efac' }
    if (r >= 0.95) return { label: 'Good',  bg: '#dcfce7' }
    if (r >= 0.80) return { label: 'Fair',  bg: '#fef9c3' }
    if (r >= 0.65) return { label: 'Poor',  bg: '#fde8c8' }
    return               { label: 'Bad',   bg: '#fee2e2' }
  }
  // Absolute fallback when fewer than 3 baseline readings exist
  if (hrv >= 55) return { label: 'Great', bg: '#86efac' }
  if (hrv >= 40) return { label: 'Good',  bg: '#dcfce7' }
  if (hrv >= 28) return { label: 'Fair',  bg: '#fef9c3' }
  if (hrv >= 18) return { label: 'Poor',  bg: '#fde8c8' }
  return              { label: 'Bad',   bg: '#fee2e2' }
}

// HRV and SpO2 are the primary recovery signals — resp rate is a stable baseline that rarely shifts
const RECOVERY_WEIGHTS = { hrv: 3, spo2: 3, stmp: 2, rr: 1 }

function recoveryComposite(raw, hrvAvg) {
  if (!raw) return null
  const { hrv, spo2, respiratory_rate: rr, skin_temp_deviation: stmp } = raw
  if (hrv == null && spo2 == null && rr == null && stmp == null) return null

  const entries = [
    ['hrv',  hrvRating(hrv, hrvAvg)],
    ['spo2', spo2Rating(spo2)],
    ['stmp', skinTempRating(stmp)],
    ['rr',   respRateRating(rr)],
  ].filter(([, r]) => r != null)
  if (!entries.length) return null

  const weightedSum = entries.reduce((sum, [k, r]) => sum + TIER_IDX[r.label] * RECOVERY_WEIGHTS[k], 0)
  const totalWeight = entries.reduce((sum, [k])    => sum + RECOVERY_WEIGHTS[k], 0)
  let tierAvg = weightedSum / totalWeight

  const hrv_r  = entries.find(([k]) => k === 'hrv')?.[1]
  const spo2_r = entries.find(([k]) => k === 'spo2')?.[1]
  const primaryTiers   = [hrv_r, spo2_r].filter(Boolean).map(r => TIER_IDX[r.label])
  const primaryWorst   = primaryTiers.length ? Math.min(...primaryTiers) : 4
  const primaryBest    = primaryTiers.length ? Math.max(...primaryTiers) : 4
  const secondaryBest  = Math.max(...entries.filter(([k]) => k !== 'hrv' && k !== 'spo2').map(([, r]) => TIER_IDX[r.label]), -1)
  const worstTier      = Math.min(...entries.map(([, r]) => TIER_IDX[r.label]))

  // SpO2 Bad (< 91%) is a clinical floor — always cap at Poor
  if (spo2Rating(spo2)?.label === 'Bad') tierAvg = Math.min(tierAvg, 1.4)

  if (primaryWorst === 0) {
    // Primary Bad: if other primary is also Fair or worse → Poor; else → Fair
    tierAvg = Math.min(tierAvg, primaryBest <= 2 ? 1.4 : 2.4)
  } else if (primaryWorst === 1) {
    // Primary Poor → cap at Fair
    tierAvg = Math.min(tierAvg, 2.4)
  } else if (primaryWorst <= 2 && primaryBest <= 2) {
    // Both primaries Fair → cap at Fair
    tierAvg = Math.min(tierAvg, 2.4)
  } else if (worstTier <= 1) {
    // Secondary metric Poor/Bad only (primaries are fine) → cap at Good
    tierAvg = Math.min(tierAvg, 2.9)
  }

  // Uplift to Great: one primary Great, other at least Good, and at least one secondary Great
  if (primaryBest >= 4 && primaryWorst >= 3 && secondaryBest >= 4) tierAvg = Math.max(tierAvg, 3.5)

  const score = tierAvg >= 3.5 ? 4 : tierAvg >= 2.5 ? 3 : tierAvg >= 1.5 ? 2 : tierAvg >= 0.5 ? 1 : 0
  return { label: RECOVERY_TIERS[score], bg: RECOVERY_BG_MAP[score] }
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
  // ── Allergies ─────────────────────────────────────────────────────────────────
  {
    key: 'health', label: 'Allergies',
    defaults: {},
    cellColor: d => { const r = allergiesRating(d); return r != null ? r.bg : (hasAny(d) ? '#f1f5f9' : null) },
    cellLabel: d => { const r = allergiesRating(d); return r?.label ?? null },
    fields: [
      { key: 'hayfever',          label: 'Hayfever',           type: 'options',     options: ['None','Low','Med','Bad'],                                                  colors: SEVERITY_COLORS },
      { key: 'hayfever_symptoms', label: 'Hayfever\nSymptoms', type: 'multiselect', options: ['Runny nose','Blocked nose','Blocked sinuses','Puffy eyes','Sneezing'] },
      { key: 'eczema',            label: 'Eczema',             type: 'options',     options: ['None','Low','Med','Bad'],                                                  colors: SEVERITY_COLORS },
      { key: 'eczema_location',   label: 'Eczema\nLocation',    type: 'multiselect', options: ['Eyes','Under mouth','Neck','Back of neck','Scalp','Forehead','Chin'] },
      { key: 'episcleritis',      label: 'Episcleritis',       type: 'options',     options: ['None','Low','Med','Bad'],                                                  colors: SEVERITY_COLORS },
      { key: 'itchy',             label: 'Itchy',              type: 'multiselect', options: ['Nose','Eyes','Throat','Throat (night)','Sinuses','Ears','Head','Neck','Body','In shower'] },
      { key: 'dryness',           label: 'Dryness',            type: 'multiselect', options: ['Eyes','Skin','Lips'] },
      { key: 'antihistamines',    label: 'Antihistamines',     type: 'options',     options: ['None','1','2','3'],                                                        colors: { None: '#f1f5f9', '1': '#e0f2fe', '2': '#bae6fd', '3': '#7dd3fc' } },
      { key: 'steroid_cream',     label: 'Steroid Cream',      type: 'toggle',      onLabel: 'Yes', offLabel: 'No' },
      { key: 'note',              label: 'Note',               type: 'text' },
    ],
  },

  // ── Mind ─────────────────────────────────────────────────────────────────────
  {
    key: 'mood', label: 'Mind',
    defaults: { attentin: 'None', ritalin: 'None', melatonin: false },
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
      { key: 'symptoms',  label: 'Symptoms',    type: 'multiselect', options: ['Fatigue','Brain fog','Anxious','Headache','Crying'] },
      { key: 'attentin',  label: 'Attentin',     type: 'options',     options: ['None','5mg','7.5mg','10mg'], colors: { None: '#f1f5f9', '5mg': '#e0f2fe', '7.5mg': '#bae6fd', '10mg': '#7dd3fc' } },
      { key: 'ritalin',   label: 'Ritalin',      type: 'options',     options: ['None','10mg','18mg'],        colors: { None: '#f1f5f9', '10mg': '#e0f2fe', '18mg': '#bae6fd' } },
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
        if (n <= 3)  return '#fee2e2'
        if (n === 4) return '#fde8c8'
        if (n === 5) return '#fef9c3'
        if (n === 6) return '#dcfce7'
        if (n === 7) return '#bbf7d0'
        return '#86efac'  // 8+
      }
      // backward compat for old bucket strings
      return { '<3': '#fee2e2', '4-6': '#fef9c3', '7+': '#86efac', '8+': '#86efac' }[v] ?? null
    },
    cellLabel: d => d?.glasses != null ? String(d.glasses) : null,
    fields: [
      { key: 'glasses', label: 'Glasses', type: 'options',
        options: ['0','1','2','3','4','5','6','7','8+'],
        colors: { '0': '#f1f5f9', '1': '#fee2e2', '2': '#fee2e2', '3': '#fee2e2', '4': '#fde8c8', '5': '#fef9c3', '6': '#dcfce7', '7': '#bbf7d0', '8+': '#86efac' },
      },
    ],
  },

  // ── Alcohol ───────────────────────────────────────────────────────────────────
  {
    key: 'alcohol', label: 'Alcohol',
    cellColor: d => {
      const v = d?.level
      if (v == null) return null
      if (v === 'None' || v === '0') return '#86efac'   // matches "Great" green
      if (v === '1' || v === '2' || v === '1-2') return '#fef9c3'
      if (v === '3' || v === '4' || v === '3-4') return '#fde8c8'
      return '#fee2e2'
    },
    cellLabel: d => d?.level ?? null,
    fields: [
      { key: 'level', label: 'Drinks', type: 'options',     options: ['None','1','2','3','4','5+'], colors: { None: '#86efac', '1': '#fef9c3', '2': '#fef9c3', '3': '#fde8c8', '4': '#fde8c8', '5+': '#fee2e2' } },
      { key: 'type',  label: 'Type',   type: 'multiselect', options: ['White wine','Red wine','Sparkling','Beer','Gin','Other spirits'] },
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
      { key: 'fats',        label: 'Fats',        type: 'options',     options: ['Low','Med','High'],           colors: { Low: '#fef9c3', Med: '#86efac', High: '#fee2e2' } },
      { key: 'snacking',    label: 'Snacking',    type: 'options',     options: ['Low','Med','High'],           colors: { Low: '#bbf7d0', Med: '#fef9c3', High: '#fee2e2' } },
      { key: 'allergens',   label: 'Allergens',   type: 'multiselect', options: ['Dairy','Gluten','Soy','Wheat','Yeast','Raw Tomato','Avocado','Spinach','Strawberry','Banana','Citrus','Fermented/pickled','Aged cheese','Leftovers','Processed'] },
      { key: 'supplements', label: 'Supplements', type: 'multiselect', options: ['Omega 3','Collagen','Turmeric','Vitamin B','Vitamin D','Biotin','Adaptogenic Mushrooms'], uiHidden: true },
      { key: 'note',        label: 'Notes',       type: 'text' },
    ],
  },

  // ── Social ────────────────────────────────────────────────────────────────────
  {
    key: 'social', label: 'Social',
    cellColor: d => d == null ? null : (d.activities?.length ? '#f1f5f9' : '#dde3eb'),
    cellLabel: d => {
      if (!d?.activities?.length) return null
      const VALID = new Set(['Friends','Family','Date','Party','Work drinks','Work from office','Used dating apps','Networking'])
      const SHORT = { 'Work drinks': 'W.drinks', 'Work from office': 'Office', 'Used dating apps': 'Apps', 'Networking': 'Network' }
      const seen = new Set()
      return d.activities.filter(a => VALID.has(a)).map(a => SHORT[a] ?? a).filter(a => seen.has(a) ? false : seen.add(a))
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
    { key: 'activities', label: 'Activities', type: 'multiselect', options: ['Yoga','Pilates','Dog walk','Gym'], colors: { 'Yoga': '#e9d5ff', 'Pilates': '#fce7f3', 'Dog walk': '#cffafe', 'Gym': '#dbeafe' } },
  ],
}

// ── Body module (custom row — weight injected from Fitbit for readonly display)
// gut / gut_symptoms / wrist_nerve_pain migrated here from health module
const BODY_MODULE = {
  key: 'body', label: 'Body',
  defaults: { illness: 'None', painkillers: '0' },
  cellColor: d => { const r = bodyRating(d); return r != null ? r.bg : null },
  fields: [
    { key: '_weight_kg',       label: 'Weight',             type: 'readonly',    unit: 'kg', autosync: true },
    { key: 'knee_pain',        label: 'Knee Pain',          type: 'options',     options: ['None','Low','Med','Bad'],   colors: SEVERITY_COLORS },
    { key: 'wrist_nerve_pain', label: 'Wrist Pain',         type: 'options',     options: ['None','Low','Med','Bad'],   colors: SEVERITY_COLORS },
    { key: 'gut',              label: 'Gut',                type: 'options',     options: ['None','Low','Med','Bad'],   colors: SEVERITY_COLORS },
    { key: 'gut_symptoms',     label: 'Gut Symptoms',       type: 'multiselect', options: ['Bloating','Cramps','Diarrhoea','Constipated','Bleeding','Mucus','Smelly flatulence'] },
    { key: 'stool',            label: 'Stool',              type: 'multiselect', options: ['1','2','3','4','5','6','7'], compact: true },
    { key: 'period',           label: 'Period',             type: 'toggle',      onLabel: 'Yes', offLabel: 'No' },
    { key: 'pill',             label: 'Contraceptive Pill', type: 'toggle',      onLabel: 'Yes', offLabel: 'No' },
    { key: 'illness',          label: 'Illness',            type: 'options',     options: ['None','Cold','Flu','Sick'], colors: { None: '#f1f5f9', Cold: '#fef9c3', Flu: '#fde8c8', Sick: '#fee2e2' } },
    { key: 'painkillers',      label: 'Painkillers',        type: 'options',     options: ['0','2','4','6'],            colors: { '0': '#f1f5f9', '2': '#e0f2fe', '4': '#bae6fd', '6': '#7dd3fc' } },
    { key: 'note',             label: 'Note',               type: 'text' },
  ],
}

// ─── completion checks ────────────────────────────────────────────────────────

const COMPLETE_CHECK = {
  health:   d => d?.eczema != null && d?.hayfever != null,
  mood:     d => d?.work != null && d?.life != null && d?.focus != null,
  water:    d => d?.glasses != null,
  alcohol:  d => d?.level != null,
  diet:     d => d?.sugar != null && d?.protein != null && d?.fruit_veg != null && d?.carbs != null && d?.snacking != null,
  exercise: d => d?.energy != null,
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

export default function LifeModules({ mobile, weatherStore: weatherStoreProp } = {}) {
  const gridDays  = mobile
    ? allDays.filter(d => d.toISOString().slice(0, 10) < todayIso)
    : allDays
  const dayW      = mobile ? 46 : DAY_WIDTH
  const gridWidth = gridDays.length * dayW

  const [logs, setLogs, refreshLogs] = useLocalStorage('lifetracker-life-logs', {})
  const [fitbitRaw]     = useLocalStorage('lifetracker-fitbit-raw', {})
  const [weatherStoreLocal] = useLocalStorage('lifetracker-weather', {})
  const weatherStore = weatherStoreProp ?? weatherStoreLocal

  const [activeCell, setActiveCell] = useState(null)
  const [sleepOpen,     setSleepOpen]     = useState(null)   // iso date
  const [stepsOpen,     setStepsOpen]     = useState(null)   // iso date
  const [recoveryOpen,  setRecoveryOpen]  = useState(null)   // iso date
  const [weatherOpen,   setWeatherOpen]   = useState(null)   // iso date

  // Carry forward last known weight — walks back to last Fitbit sync (up to 90 days)
  function lastKnownWeight(iso) {
    const d = new Date(iso)
    for (let i = 0; i < 90; i++) {
      const key = d.toISOString().slice(0, 10)
      const w = fitbitRaw[key]?.weight_kg
      if (w != null) return { value: w, isStale: i > 0 }
      d.setDate(d.getDate() - 1)
    }
    return { value: null, isStale: false }
  }
  // Carry forward pill and period from yesterday only
  function yesterdayBody(iso) {
    const d = new Date(iso)
    d.setDate(d.getDate() - 1)
    return logs[d.toISOString().slice(0, 10)]?.body ?? {}
  }


  const popoverRef     = useRef(null)
  const sleepRef       = useRef(null)
  const sleepCellRefs  = useRef({})
  const stepsRef         = useRef(null)
  const stepsCellRefs    = useRef({})
  const recoveryRef      = useRef(null)
  const recoveryCellRefs = useRef({})
  const weatherRef       = useRef(null)
  const weatherCellRefs  = useRef({})
  const gratRef        = useRef(null)
  const transcriptRef  = useRef(null)

  const [gratEdit,       setGratEdit]       = useState(null)
  const [transcriptOpen, setTranscriptOpen] = useState(null)
  const transcriptCellRefs = useRef({})

  // Sync from voice check-in writes
  useEffect(() => {
    function onLogsUpdated() { refreshLogs() }
    window.addEventListener('lifetracker-logs-updated', onLogsUpdated)
    return () => window.removeEventListener('lifetracker-logs-updated', onLogsUpdated)
  }, []) // eslint-disable-line

  // One-time migration: move wrist_nerve_pain / gut / gut_symptoms from health → body
  useEffect(() => {
    setLogs(prev => {
      let changed = false
      const next = {}
      for (const [date, day] of Object.entries(prev)) {
        const health = day.health ?? {}
        const body   = day.body   ?? {}
        const needsMigration = (
          (health.wrist_nerve_pain != null && body.wrist_nerve_pain == null) ||
          (health.gut              != null && body.gut              == null) ||
          (health.gut_symptoms     != null && body.gut_symptoms     == null)
        )
        if (needsMigration) {
          const newBody   = { ...body }
          const newHealth = { ...health }
          if (health.wrist_nerve_pain != null && body.wrist_nerve_pain == null) {
            newBody.wrist_nerve_pain = health.wrist_nerve_pain
            delete newHealth.wrist_nerve_pain
          }
          if (health.gut != null && body.gut == null) {
            newBody.gut = health.gut
            delete newHealth.gut
          }
          if (health.gut_symptoms != null && body.gut_symptoms == null) {
            newBody.gut_symptoms = health.gut_symptoms
            delete newHealth.gut_symptoms
          }
          next[date] = { ...day, health: newHealth, body: newBody }
          changed = true
        } else {
          next[date] = day
        }
      }
      return changed ? next : prev
    })
  }, []) // eslint-disable-line

  // Migration: rename hayfever_symptoms itchy values → itchy field; rename alcohol types
  useEffect(() => {
    setLogs(prev => {
      let changed = false
      const next = {}
      const ITCHY_MAP = { 'Itchy nose': 'Nose', 'Itchy eyes': 'Eyes', 'Itchy throat': 'Throat' }
      for (const [date, day] of Object.entries(prev)) {
        let newDay = day
        const health = day.health ?? {}
        const alcohol = day.alcohol ?? {}

        // Move itchy hayfever_symptoms → itchy field
        if (health.hayfever_symptoms?.some(s => ITCHY_MAP[s])) {
          const remaining = health.hayfever_symptoms.filter(s => !ITCHY_MAP[s])
          const migrated = health.hayfever_symptoms.filter(s => ITCHY_MAP[s]).map(s => ITCHY_MAP[s])
          const existing = health.itchy ?? []
          const merged = [...new Set([...existing, ...migrated])]
          newDay = { ...newDay, health: { ...health, hayfever_symptoms: remaining, itchy: merged } }
          changed = true
        }

        // Rename alcohol types: Wine → White wine, Spirits → Other spirits
        if (alcohol.type?.some(t => t === 'Wine' || t === 'Spirits')) {
          const newType = alcohol.type.map(t => t === 'Wine' ? 'White wine' : t === 'Spirits' ? 'Other spirits' : t)
          newDay = { ...newDay, alcohol: { ...alcohol, type: newType } }
          changed = true
        }

        next[date] = newDay
      }
      return changed ? next : prev
    })
  }, []) // eslint-disable-line

  // Migration: rename 'Long walk' → 'Dog walk' in exercise activities
  useEffect(() => {
    setLogs(prev => {
      let changed = false
      const next = {}
      for (const [date, day] of Object.entries(prev)) {
        const acts = day.exercise?.activities
        if (acts?.includes('Long walk')) {
          next[date] = { ...day, exercise: { ...day.exercise, activities: acts.map(a => a === 'Long walk' ? 'Dog walk' : a) } }
          changed = true
        } else {
          next[date] = day
        }
      }
      return changed ? next : prev
    })
  }, []) // eslint-disable-line

  // Migration: backfill ritalin: 'None' for all existing mood entries
  useEffect(() => {
    setLogs(prev => {
      let changed = false
      const next = {}
      for (const [date, day] of Object.entries(prev)) {
        if (day.mood != null && day.mood.ritalin == null) {
          next[date] = { ...day, mood: { ...day.mood, ritalin: 'None' } }
          changed = true
        } else {
          next[date] = day
        }
      }
      return changed ? next : prev
    })
  }, []) // eslint-disable-line

  // Migration: rename adhd_meds → attentin in mood entries
  useEffect(() => {
    setLogs(prev => {
      let changed = false
      const next = {}
      for (const [date, day] of Object.entries(prev)) {
        if (day.mood?.adhd_meds != null) {
          const { adhd_meds, ...restMood } = day.mood
          next[date] = { ...day, mood: { ...restMood, attentin: adhd_meds } }
          changed = true
        } else {
          next[date] = day
        }
      }
      return changed ? next : prev
    })
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
    if (!recoveryOpen) return
    function onDown(e) {
      if (recoveryRef.current && !recoveryRef.current.contains(e.target) &&
          !recoveryCellRefs.current[recoveryOpen]?.contains(e.target)) setRecoveryOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [recoveryOpen])

  useEffect(() => {
    if (!weatherOpen) return
    function onDown(e) {
      if (weatherRef.current && !weatherRef.current.contains(e.target) &&
          !weatherCellRefs.current[weatherOpen]?.contains(e.target)) setWeatherOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [weatherOpen])

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
    if (mobile) {
      // Blur first so iOS starts dismissing the keyboard
      document.activeElement?.blur()

      const vv = window.visualViewport
      const fullHeight = window.innerHeight

      // If keyboard is not open, close immediately
      if (!vv || vv.height >= fullHeight * 0.85) {
        window.scrollTo(0, 0)
        setGratEdit(null)
        return
      }

      // Keyboard IS open — wait for visualViewport to restore to full height,
      // then reset any iOS-induced page scroll and unmount the modal.
      // Using a resize listener is more reliable than a fixed timeout because
      // the keyboard animation duration varies by device and iOS version.
      let done = false
      const finish = () => {
        if (done) return
        done = true
        vv.removeEventListener('resize', onResize)
        clearTimeout(fallback)
        window.scrollTo(0, 0)
        // One extra rAF so the scroll settles before React re-renders
        requestAnimationFrame(() => setGratEdit(null))
      }
      const onResize = () => { if (vv.height >= fullHeight * 0.85) finish() }
      const fallback = setTimeout(finish, 600) // safety net
      vv.addEventListener('resize', onResize)
    } else {
      setGratEdit(null)
    }
  }

  function setFieldValue(moduleKey, date, fieldKey, value) {
    const today = new Date().toISOString().slice(0, 10)
    setLogs(prev => {
      const updatedModule = { ...((prev[date] ?? {})[moduleKey] ?? {}), [fieldKey]: value }
      const updatedDay = { ...(prev[date] ?? {}), [moduleKey]: updatedModule }
      if (date === today) {
        updatedDay.checkins = [
          { timestamp: new Date().toISOString(), source: 'manual', module: moduleKey, field: fieldKey, value },
          ...(updatedDay.checkins ?? []),
        ]
      }
      return { ...prev, [date]: updatedDay }
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
      const mod = [...MODULES, EXERCISE_MODULE, BODY_MODULE].find(m => m.key === moduleKey)
      setLogs(prev => {
        const current = prev[date]?.[moduleKey] ?? {}
        const patch = mod?.defaults
          ? Object.fromEntries(Object.entries(mod.defaults).filter(([k]) => current[k] == null))
          : {}
        // Carry forward pill and period from yesterday when opening body
        if (moduleKey === 'body') {
          const d = new Date(date)
          d.setDate(d.getDate() - 1)
          const yBody = prev[d.toISOString().slice(0, 10)]?.body ?? {}
          if (current.pill   === undefined && yBody.pill   != null) patch.pill   = yBody.pill
          if (current.period === undefined && yBody.period != null) patch.period = yBody.period
        }
        if (!Object.keys(patch).length) return prev
        return { ...prev, [date]: { ...(prev[date] ?? {}), [moduleKey]: { ...current, ...patch } } }
      })
      const rect = e.currentTarget.getBoundingClientRect()
      setActiveCell({ moduleKey, date, rect })
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
      ? { left: i * dayW + 1, width: dayW - 2, background: bg || undefined }
      : { left: 1, right: 1, background: bg || undefined }
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
            mobile={mobile}
            onClose={() => setActiveCell(null)}
            cellRect={mod.key !== 'water' ? activeCell?.rect : undefined}
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
          <WeekLines days={gridDays} dayW={dayW} />
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
              <div key={i} className="lm-date-cell" style={{ left: i * dayW, width: dayW }}>
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

      {/* ── 0. Environment (weather, autosync, click for detail) ── */}
      {(() => {
        const POLLEN_RANK = { 'Low': 1, 'Medium': 2, 'High': 3, 'Very High': 4 }
        function weatherCellColor(w) {
          if (w == null) return null
          const grassRank = POLLEN_RANK[w.grass_pollen_label] ?? 0
          const treeRank  = POLLEN_RANK[w.tree_pollen_label ?? w.birch_pollen_label] ?? 0
          const worst = Math.max(grassRank, treeRank)
          if (worst === 0) return '#86efac'
          if (worst === 1) return '#dcfce7'
          if (worst === 2) return '#fef9c3'
          if (worst === 3) return '#fde8c8'
          return '#fee2e2'
        }
        function weatherCellLabel(w) {
          if (w == null) return null
          const grassRank = POLLEN_RANK[w.grass_pollen_label] ?? 0
          const treeRank  = POLLEN_RANK[w.tree_pollen_label ?? w.birch_pollen_label] ?? 0
          // Only show type label if above Low (rank > 1)
          if (grassRank > 1 && grassRank >= treeRank) return 'Grass'
          if (treeRank > 1) return 'Tree'
          if (Math.max(grassRank, treeRank) === 1) return 'Low'
          return null
        }
        return (
          <div className="lm-row">
            <div className="lm-label"><span className="lm-label-emoji">🌤</span> <em>Environment</em></div>
            <div className="lm-day-grid" style={{ width: gridWidth }}>
              <WeekLines days={gridDays} dayW={dayW} />
              {gridDays.map((d, i) => {
                const iso = d.toISOString().slice(0, 10)
                const w   = weatherStore[iso] ?? null
                const bg  = weatherCellColor(w)
                const label = weatherCellLabel(w)
                const isOpen = weatherOpen === iso
                const hasData = w != null
                return (
                  <div
                    key={iso}
                    ref={el => { weatherCellRefs.current[iso] = el }}
                    className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                    style={{ left: i * dayW + 1, width: dayW - 2, background: bg || undefined }}
                    onClick={hasData ? () => setWeatherOpen(isOpen ? null : iso) : undefined}
                  >
                    {label && <span className="lm-cell-label">{label}</span>}
                  </div>
                )
              })}
            </div>
            {mobile && (() => {
              const w   = weatherStore[todayIso] ?? null
              const bg  = weatherCellColor(w)
              const label = weatherCellLabel(w)
              const isOpen = weatherOpen === todayIso
              const hasData = w != null
              return (
                <div className="lm-today-col">
                  <div
                    ref={el => { weatherCellRefs.current[todayIso] = el }}
                    className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''}`}
                    style={{ left: 1, width: dayW - 2, background: bg || undefined }}
                    onClick={hasData ? () => setWeatherOpen(isOpen ? null : todayIso) : undefined}
                  >
                    {label && <span className="lm-cell-label">{label}</span>}
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })()}

      {/* ── 1. Sleep (autosync + old manual fallback, click for detail) ── */}
      <div className="lm-row">
        <div className="lm-label"><span className="lm-label-emoji">😴</span> <em>Sleep</em></div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} dayW={dayW} />
          {gridDays.map((d, i) => {
            const iso      = d.toISOString().slice(0, 10)
            const raw      = fitbitRaw[iso]
            const oldSleep = logs[iso]?.sleep  // backward compat
            const sleepMin = raw?.sleep_minutes ?? oldSleep?._fitbit_minutes ?? null
            const inBedMin = raw?.in_bed_minutes ?? oldSleep?._in_bed_minutes ?? null
            const validSleep = sleepMin != null && sleepMin <= 960
            const hasFitbit = validSleep
            const hasOld    = !hasFitbit && oldSleep?.hours != null
            const bg        = hasFitbit ? sleepColorFromFitbit(sleepMin, inBedMin)
              : hasOld ? sleepColorFromOldData(oldSleep) : null
            const label  = hasFitbit ? fmtMins(sleepMin) : (hasOld ? oldSleep.hours : null)
            const isOpen = sleepOpen === iso
            const hasData = hasFitbit || hasOld
            return (
              <div
                key={iso}
                ref={el => { sleepCellRefs.current[iso] = el }}
                className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * dayW + 1, width: dayW - 2, background: bg || undefined }}
                onClick={hasData ? () => setSleepOpen(isOpen ? null : iso) : undefined}
              >
                {label && <span className="lm-cell-label">{label}</span>}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const raw      = fitbitRaw[todayIso]
          const oldSleep = logs[todayIso]?.sleep
          const sleepMin = raw?.sleep_minutes ?? oldSleep?._fitbit_minutes ?? null
          const inBedMin = raw?.in_bed_minutes ?? oldSleep?._in_bed_minutes ?? null
          const validSleep = sleepMin != null && sleepMin <= 960
          const hasFitbit = validSleep
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
                style={{ left: 1, width: dayW - 2, background: bg || undefined }}
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
        <div className="lm-label"><span className="lm-label-emoji">👟</span> <em>Steps</em></div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} dayW={dayW} />
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
                style={{ left: i * dayW + 1, width: dayW - 2, background: bg || undefined }}
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
                style={{ left: 1, width: dayW - 2, background: bg || undefined }}
                onClick={hasData ? () => setStepsOpen(isOpen ? null : todayIso) : undefined}
              >
                {steps != null && <span className="lm-cell-label">{steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : steps}</span>}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Recovery (autosync: HRV, SpO2, resp rate, skin temp) ── */}
      <div className="lm-row">
        <div className="lm-label"><span className="lm-label-emoji">🩺</span> <em>Recovery</em></div>
        <div className="lm-day-grid" style={{ width: gridWidth }}>
          <WeekLines days={gridDays} dayW={dayW} />
          {gridDays.map((d, i) => {
            const iso     = d.toISOString().slice(0, 10)
            const raw     = fitbitRaw[iso]
            const hrvAvg  = rollingHrvAvg(fitbitRaw, iso)
            const score   = recoveryComposite(raw, hrvAvg)
            const isOpen  = recoveryOpen === iso
            const hasData = raw?.hrv != null || raw?.spo2 != null || raw?.respiratory_rate != null || raw?.skin_temp_deviation != null
            return (
              <div
                key={iso}
                ref={el => { recoveryCellRefs.current[iso] = el }}
                className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * dayW + 1, width: dayW - 2, background: score?.bg || undefined }}
                onClick={hasData ? () => setRecoveryOpen(isOpen ? null : iso) : undefined}
              >
                {score && <span className="lm-cell-label">{score.label}</span>}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const raw     = fitbitRaw[todayIso]
          const hrvAvg  = rollingHrvAvg(fitbitRaw, todayIso)
          const score   = recoveryComposite(raw, hrvAvg)
          const isOpen  = recoveryOpen === todayIso
          const hasData = raw?.hrv != null || raw?.spo2 != null || raw?.respiratory_rate != null || raw?.skin_temp_deviation != null
          return (
            <div className="lm-today-col">
              <div
                ref={el => { recoveryCellRefs.current[todayIso] = el }}
                className={`lm-cell ${hasData ? 'lm-cell--clickable' : ''} ${isOpen ? 'lm-cell--active' : ''}`}
                style={{ left: 1, width: dayW - 2, background: score?.bg || undefined }}
                onClick={hasData ? () => setRecoveryOpen(isOpen ? null : todayIso) : undefined}
              >
                {score && <span className="lm-cell-label">{score.label}</span>}
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
          <WeekLines days={gridDays} dayW={dayW} />
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
            const incomplete = isRecent && energy == null
            return (
              <div
                key={iso}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${open ? 'lm-cell--active' : ''} ${incomplete ? 'lm-cell--incomplete' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * dayW + 1, width: dayW - 2, background: bg || undefined }}
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
                    mobile={mobile}
                    onClose={() => setActiveCell(null)}
                    cellRect={activeCell?.rect}
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
          const incomplete = energy == null
          return (
            <div className="lm-today-col">
              <div
                className={`lm-cell lm-cell--clickable ${open ? 'lm-cell--active' : ''} ${incomplete ? 'lm-cell--incomplete' : ''}`}
                style={{ left: 1, width: dayW - 2, background: bg || undefined }}
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
                  <Popover ref={popoverRef} mod={EXERCISE_MODULE} date={todayIso} dayData={{ ...(exData ?? {}), energy: exData?.energy ?? logs[todayIso]?.mood?.energy ?? undefined }} onSet={(fk, v) => setFieldValue('exercise', todayIso, fk, v)} mobile={mobile} onClose={() => setActiveCell(null)} cellRect={activeCell?.rect} />
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
          <WeekLines days={gridDays} dayW={dayW} />
          {gridDays.map((d, i) => {
            const iso      = d.toISOString().slice(0, 10)
            const rawBody  = logs[iso]?.body ?? {}
            const rawHealth = logs[iso]?.health ?? {}
            // Read-time fallback: if wrist/gut still in health (pre-migration), use it
            const bodyData = {
              ...rawBody,
              wrist_nerve_pain: rawBody.wrist_nerve_pain ?? rawHealth.wrist_nerve_pain ?? undefined,
              gut:              rawBody.gut              ?? rawHealth.gut              ?? undefined,
              gut_symptoms:     rawBody.gut_symptoms     ?? rawHealth.gut_symptoms     ?? undefined,
            }
            const period   = bodyData.period ?? !!logs[iso]?.period  // backward compat
            const { value: kg, isStale: kgStale } = lastKnownWeight(iso)
            const r        = bodyRating(bodyData)
            const bg       = r != null ? r.bg : (kg != null ? '#f1f5f9' : null)
            const open     = activeCell?.moduleKey === 'body' && activeCell?.date === iso
            const isFuture = iso > todayIso
            const fmtKg    = kg != null ? (kg % 1 === 0 ? String(kg) : kg.toFixed(1)) : null
            const yBody    = yesterdayBody(iso)
            const pillFwd  = bodyData.pill  != null ? bodyData.pill  : yBody.pill  ?? null
            const periodFwd= bodyData.period != null ? bodyData.period : yBody.period ?? null
            return (
              <div
                key={iso}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${open ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * dayW + 1, width: dayW - 2, background: bg || undefined }}
                onClick={isFuture ? undefined : e => handleCellClick(e, 'body', iso)}
              >
                {period
                  ? <span className="lm-period-dot" />
                  : r?.label && <span className="lm-cell-label">{r.label}</span>
                }
                {open && (
                  <Popover
                    ref={popoverRef}
                    mod={BODY_MODULE}
                    date={iso}
                    dayData={{ ...bodyData, pill: pillFwd, period: periodFwd, _weight_kg: fmtKg, _weight_kg_stale: kgStale }}
                    onSet={(fk, v) => { if (!fk.startsWith('_')) setFieldValue('body', iso, fk, v) }}
                    mobile={mobile}
                    onClose={() => setActiveCell(null)}
                    cellRect={activeCell?.rect}
                  />
                )}
              </div>
            )
          })}
        </div>
        {mobile && (() => {
          const rawBodyT  = logs[todayIso]?.body ?? {}
          const rawHealthT = logs[todayIso]?.health ?? {}
          const bodyData  = {
            ...rawBodyT,
            wrist_nerve_pain: rawBodyT.wrist_nerve_pain ?? rawHealthT.wrist_nerve_pain ?? undefined,
            gut:              rawBodyT.gut              ?? rawHealthT.gut              ?? undefined,
          }
          const period   = bodyData.period ?? !!logs[todayIso]?.period
          const { value: kgT, isStale: kgStaleT } = lastKnownWeight(todayIso)
          const rT       = bodyRating(bodyData)
          const bg       = rT != null ? rT.bg : (kgT != null ? '#f1f5f9' : null)
          const open     = activeCell?.moduleKey === 'body' && activeCell?.date === todayIso
          const fmtKgT   = kgT != null ? (kgT % 1 === 0 ? String(kgT) : kgT.toFixed(1)) : null
          const yBodyT   = yesterdayBody(todayIso)
          const pillFwdT = bodyData.pill   != null ? bodyData.pill   : yBodyT.pill   ?? null
          const periodFwdT = bodyData.period != null ? bodyData.period : yBodyT.period ?? null
          return (
            <div className="lm-today-col">
              <div
                className={`lm-cell lm-cell--clickable ${open ? 'lm-cell--active' : ''}`}
                style={{ left: 1, width: dayW - 2, background: bg || undefined }}
                onClick={e => handleCellClick(e, 'body', todayIso)}
              >
                {period
                  ? <span className="lm-period-dot" />
                  : rT?.label && <span className="lm-cell-label">{rT.label}</span>
                }
                {open && (
                  <Popover
                    ref={popoverRef}
                    mod={BODY_MODULE}
                    date={todayIso}
                    dayData={{ ...bodyData, pill: pillFwdT, period: periodFwdT, _weight_kg: fmtKgT, _weight_kg_stale: kgStaleT }}
                    onSet={(fk, v) => { if (!fk.startsWith('_')) setFieldValue('body', todayIso, fk, v) }}
                    mobile={mobile}
                    onClose={() => setActiveCell(null)}
                    cellRect={activeCell?.rect}
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
          <WeekLines days={gridDays} dayW={dayW} />
          {gridDays.map((d, i) => {
            const iso       = d.toISOString().slice(0, 10)
            const text      = logs[iso]?.gratitude ?? null
            const isEditing = gratEdit?.date === iso
            const isFuture  = iso > todayIso
            return (
              <div
                key={iso}
                className={`lm-cell ${isFuture ? 'lm-cell--future' : 'lm-cell--clickable'} ${isEditing ? 'lm-cell--active' : ''} ${d.getDay() === 1 ? 'lm-cell--week-start' : ''}`}
                style={{ left: i * dayW + 1, width: dayW - 2 }}
                onClick={isFuture ? undefined : () => { if (!isEditing) setGratEdit({ date: iso, value: text ?? '' }) }}
              >
                {isEditing && !mobile ? (
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
                style={{ left: 1, width: dayW - 2 }}
                onClick={() => { if (!isEditing) setGratEdit({ date: todayIso, value: text ?? '' }) }}
              >
                {isEditing && !mobile ? (
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
          <WeekLines days={gridDays} dayW={dayW} />
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
                style={{ left: i * dayW + 1, width: dayW - 2 }}
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
                style={{ left: 1, width: dayW - 2 }}
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
        const oldSleep = logs[sleepOpen]?.sleep
        const sleepMin = raw?.sleep_minutes ?? oldSleep?._fitbit_minutes ?? null
        const hasFitbit = sleepMin != null && sleepMin <= 960
        const s_score = sleepScoreRating(raw?.sleep_score)
        const s_deep  = deepPctRating(raw?.deep_minutes, raw?.sleep_minutes)
        const s_rem   = remPctRating(raw?.rem_minutes,   raw?.sleep_minutes)
        const hasChips = s_score || s_deep || s_rem
        const rect = cellEl.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 240)
        const top  = rect.bottom + 8
        const chipStyle = (color) => ({
          display: 'inline-block', background: color, borderRadius: 4,
          padding: '1px 6px', fontSize: 12, fontWeight: 500, color: '#1e293b',
        })
        const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 4 }
        return createPortal(
          <div
            ref={sleepRef}
            style={{ position: 'fixed', top, left, zIndex: 1000, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: hasChips ? 220 : 180 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{fmtDate(sleepOpen)}</span>
              {hasFitbit && <AutosyncTag />}
            </div>
            {hasFitbit ? (
              <>
                <div style={{ ...rowStyle, marginBottom: hasChips ? 8 : 0, paddingBottom: hasChips ? 8 : 0, borderBottom: hasChips ? '1px solid #f1f5f9' : 'none' }}>
                  <span>Asleep</span>
                  <strong style={{ color: '#1e293b' }}>{fmtMins(sleepMin)}</strong>
                </div>
                {s_score && (
                  <div style={rowStyle}>
                    <span>Sleep score</span>
                    <span style={chipStyle(s_score.bg)}>{s_score.label} ({raw.sleep_score})</span>
                  </div>
                )}
                {s_deep && (
                  <div style={rowStyle}>
                    <span>Deep sleep</span>
                    <span style={chipStyle(s_deep.bg)}>{s_deep.label} ({Math.round(s_deep.pct)}%)</span>
                  </div>
                )}
                {s_rem && (
                  <div style={rowStyle}>
                    <span>REM sleep</span>
                    <span style={chipStyle(s_rem.bg)}>{s_rem.label} ({Math.round(s_rem.pct)}%)</span>
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
        const raw   = fitbitRaw[stepsOpen]
        const steps = raw?.steps
        const total = raw?.total_calories_kcal ?? null
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
                Calories: <strong>{total.toLocaleString()} kcal</strong>
              </div>
            )}
          </div>,
          document.body
        )
      })()}

      {/* ── Recovery info portal ── */}
      {recoveryOpen && (() => {
        const cellEl = recoveryCellRefs.current[recoveryOpen]
        if (!cellEl) return null
        const raw    = fitbitRaw[recoveryOpen]
        if (!raw) return null
        const hrvAvg = rollingHrvAvg(fitbitRaw, recoveryOpen)
        const s_hrv  = hrvRating(raw.hrv, hrvAvg)
        const s_spo2 = spo2Rating(raw.spo2)
        const s_rr   = respRateRating(raw.respiratory_rate)
        const s_stmp = skinTempRating(raw.skin_temp_deviation)
        const rect = cellEl.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 240)
        const top  = rect.bottom + 8
        const chipStyle = (color) => ({
          display: 'inline-block', background: color, borderRadius: 4,
          padding: '1px 6px', fontSize: 12, fontWeight: 500, color: '#1e293b',
        })
        const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 4 }
        return createPortal(
          <div
            ref={recoveryRef}
            style={{ position: 'fixed', top, left, zIndex: 1000, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 220 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{fmtDate(recoveryOpen)}</span>
              <AutosyncTag />
            </div>
            {s_hrv && (
              <div style={rowStyle}>
                <span>HRV{hrvAvg != null ? ` (avg ${Math.round(hrvAvg)})` : ''}</span>
                <span style={chipStyle(s_hrv.bg)}>{s_hrv.label}{raw.hrv != null ? ` (${Math.round(raw.hrv)} ms)` : ''}</span>
              </div>
            )}
            {s_spo2 && (
              <div style={rowStyle}>
                <span>SpO2</span>
                <span style={chipStyle(s_spo2.bg)}>{s_spo2.label}{raw.spo2 != null ? ` (${raw.spo2.toFixed(1)}%)` : ''}</span>
              </div>
            )}
            {s_rr && (
              <div style={rowStyle}>
                <span>Resp rate</span>
                <span style={chipStyle(s_rr.bg)}>{s_rr.label}{raw.respiratory_rate != null ? ` (${raw.respiratory_rate.toFixed(1)} bpm)` : ''}</span>
              </div>
            )}
            {s_stmp && (
              <div style={rowStyle}>
                <span>Skin temp</span>
                <span style={chipStyle(s_stmp.bg)}>{s_stmp.label}{raw.skin_temp_deviation != null ? ` (${raw.skin_temp_deviation >= 0 ? '+' : ''}${raw.skin_temp_deviation.toFixed(2)}°C)` : ''}</span>
              </div>
            )}
          </div>,
          document.body
        )
      })()}

      {/* ── Weather info portal ── */}
      {weatherOpen && (() => {
        const cellEl = weatherCellRefs.current[weatherOpen]
        if (!cellEl) return null
        const w = weatherStore[weatherOpen] ?? null
        if (!w) return null

        function rainChip(mm) {
          if (mm == null || mm < 1) return { label: 'None', color: '#86efac' }
          if (mm < 5)  return { label: `Low (${mm.toFixed(1)}mm)`,  color: '#dcfce7' }
          if (mm < 15) return { label: `Med (${mm.toFixed(1)}mm)`,  color: '#fef9c3' }
          return { label: `High (${mm.toFixed(1)}mm)`, color: '#fde8c8' }
        }
        function windChip(kmh) {
          if (kmh == null) return null
          if (kmh < 15) return { label: `Low (${Math.round(kmh)} km/h)`,      color: '#86efac' }
          if (kmh < 35) return { label: `Moderate (${Math.round(kmh)} km/h)`, color: '#fef9c3' }
          return { label: `Strong (${Math.round(kmh)} km/h)`, color: '#fde8c8' }
        }
        function pollenChip(label, score) {
          if (!label) return { label: 'None', color: '#86efac' }
          const COLORS = { 'Low': '#dcfce7', 'Medium': '#fef9c3', 'High': '#fde8c8', 'Very High': '#fee2e2' }
          const display = score != null ? `${label} (${Math.round(score)})` : label
          return { label: display, color: COLORS[label] ?? '#f1f5f9' }
        }
        function aqiChip(label, score) {
          if (!label) return null
          const COLORS = { 'Good': '#86efac', 'Fair': '#dcfce7', 'Moderate': '#fef9c3', 'Poor': '#fde8c8', 'Very Poor': '#fee2e2' }
          const display = score != null ? `${label} (${Math.round(score)})` : label
          return { label: display, color: COLORS[label] ?? '#f1f5f9' }
        }
        function uvChip(idx) {
          if (idx == null) return null
          const label = idx <= 2 ? 'Low' : idx <= 5 ? 'Moderate' : idx <= 7 ? 'High' : idx <= 10 ? 'Very High' : 'Extreme'
          const COLORS = { 'Low': '#dcfce7', 'Moderate': '#fef9c3', 'High': '#fde8c8', 'Very High': '#fee2e2', 'Extreme': '#fee2e2' }
          return { label: `${label} (${idx.toFixed(1)})`, color: COLORS[label] }
        }

        const rain  = rainChip(w.precipitation_mm)
        const wind  = windChip(w.wind_speed_max)
        const grass = pollenChip(w.grass_pollen_label)
        const tree  = pollenChip(w.tree_pollen_label ?? w.birch_pollen_label)
        const aqi   = aqiChip(w.aqi_label, w.aqi)
        const uv    = uvChip(w.uv_index)

        const rect = cellEl.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 240)
        const top  = rect.bottom + 8

        const chipStyle = (color) => ({
          display: 'inline-block',
          background: color,
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 12,
          fontWeight: 500,
          color: '#1e293b',
        })
        const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 4 }

        return createPortal(
          <div
            ref={weatherRef}
            style={{ position: 'fixed', top, left, zIndex: 1000, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 220 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{fmtDate(weatherOpen)}</span>
              <AutosyncTag />
            </div>
            {/* Temperature */}
            <div style={rowStyle}>
              <span>Temperature</span>
              <span style={{ fontWeight: 500, color: '#334155' }}>
                {w.temp_min != null && w.temp_max != null
                  ? `${Math.round(w.temp_min)}–${Math.round(w.temp_max)}°C`
                  : w.temp_max != null ? `${Math.round(w.temp_max)}°C` : '—'}
              </span>
            </div>
            {/* Humidity */}
            <div style={rowStyle}>
              <span>Humidity</span>
              <span style={{ fontWeight: 500, color: '#334155' }}>
                {w.humidity_pct != null ? `${Math.round(w.humidity_pct)}%` : '—'}
              </span>
            </div>
            {/* Rain */}
            <div style={rowStyle}>
              <span>Rain</span>
              <span style={chipStyle(rain.color)}>{rain.label}</span>
            </div>
            {/* Wind */}
            {wind && (
              <div style={rowStyle}>
                <span>Wind</span>
                <span style={chipStyle(wind.color)}>{wind.label}</span>
              </div>
            )}
            {/* Grass pollen */}
            <div style={rowStyle}>
              <span>Grass pollen</span>
              <span style={chipStyle(grass.color)}>{grass.label}</span>
            </div>
            {/* Tree pollen */}
            <div style={rowStyle}>
              <span>Tree pollen</span>
              <span style={chipStyle(tree.color)}>{tree.label}</span>
            </div>
            {/* Air Quality */}
            {aqi && (
              <div style={rowStyle}>
                <span>Air Quality</span>
                <span style={chipStyle(aqi.color)}>{aqi.label}</span>
              </div>
            )}
            {/* UV */}
            {uv && (
              <div style={rowStyle}>
                <span>UV</span>
                <span style={chipStyle(uv.color)}>{uv.label}</span>
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

      {/* ── Mobile gratitude portal ── */}
      {mobile && gratEdit && createPortal(
        <>
          {/* Backdrop — tap anywhere outside to save and close */}
          <div
            onClick={saveGratitude}
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          />
          <div
            ref={gratRef}
            onClick={e => e.stopPropagation()}
            style={{ position: 'fixed', bottom: 90, left: 12, right: 12, zIndex: 9999, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', boxShadow: '0 8px 32px rgba(0,0,0,0.14)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Gratitude · {fmtDate(gratEdit.date)}</span>
              <button onClick={saveGratitude} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#94a3b8', padding: '0 4px' }}>×</button>
            </div>
            <input
              className="lm-grat-input"
              placeholder="What are you grateful for?"
              value={gratEdit.value}
              onChange={e => setGratEdit(g => ({ ...g, value: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') saveGratitude(); if (e.key === 'Escape') setGratEdit(null) }}
            />
          </div>
        </>,
        document.body
      )}
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

function WeekLines({ days, dayW }) {
  return days.map((d, i) =>
    d.getDay() === 1
      ? <div key={i} className="lm-week-line" style={{ left: i * dayW }} />
      : <div key={i} className="lm-day-line"  style={{ left: i * dayW }} />
  )
}

// ─── Popover ──────────────────────────────────────────────────────────────────

const POPOVER_MOBILE_STYLE = { position: 'fixed', bottom: 90, left: 12, right: 12, top: 'auto', transform: 'none', zIndex: 9999, maxWidth: 'none' }

function desktopFixedStyle(rect) {
  const POPOVER_WIDTH = 300
  const MARGIN = 10
  const HEADER_H = 80
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2
  left = Math.max(8, Math.min(left, vw - POPOVER_WIDTH - 8))
  const spaceAbove = rect.top - HEADER_H - MARGIN
  const spaceBelow = vh - rect.bottom - MARGIN
  if (spaceAbove < 150 && spaceBelow > spaceAbove) {
    return { position: 'fixed', top: rect.bottom + MARGIN, left, transform: 'none', zIndex: 9999, width: POPOVER_WIDTH, maxHeight: Math.max(150, spaceBelow - 8), overflowY: 'auto' }
  }
  return { position: 'fixed', bottom: vh - rect.top + MARGIN, left, transform: 'none', zIndex: 9999, width: POPOVER_WIDTH, maxHeight: Math.max(150, spaceAbove), overflowY: 'auto' }
}

const Popover = forwardRef(function Popover({ mod, date, dayData, onSet, mobile, onClose, cellRect }, ref) {
  const fixedStyle = !mobile && cellRect ? desktopFixedStyle(cellRect) : undefined
  const content = (
    <div className="lm-popover" ref={ref} onClick={e => e.stopPropagation()} style={mobile ? POPOVER_MOBILE_STYLE : fixedStyle}>
      <div className="lm-popover-title">
        <span className="lm-popover-module">{mod.label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="lm-popover-date">{fmtDate(date)}</span>
          {mobile && <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#94a3b8', padding: '0 2px', marginRight: -4 }}>×</button>}
        </div>
      </div>
      {mod.fields.filter(f => !f.uiHidden).map(field => (
        <PopoverField
          key={field.key}
          field={field}
          value={dayData[field.key] ?? null}
          stale={dayData[`_${field.key}_stale`] ?? false}
          onSet={v => onSet(field.key, v)}
        />
      ))}
    </div>
  )
  return (mobile || fixedStyle) ? createPortal(content, document.body) : content
})

// ─── PopoverField ─────────────────────────────────────────────────────────────

function PopoverField({ field, value, stale, onSet }) {
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
          <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>
            {display}
            {stale && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>*</span>}
          </span>
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
            onClick={() => onSet(false)}
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
            const baseStyle = field.compact ? { padding: '0 5px' } : undefined
            const activeStyle = on && color ? { background: color, borderColor: color, color: '#1e293b' } : undefined
            return (
              <button
                key={opt}
                className={`lm-pf-pill ${on ? 'lm-pf-pill--on' : ''}`}
                style={{ ...baseStyle, ...activeStyle }}
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

export { MODULES, MODULE_EMOJI, COMPLETE_CHECK, PopoverField, EXERCISE_MODULE, BODY_MODULE, bodyRating, sleepColorFromFitbit, sleepColorFromOldData, sleepEffLabel, fmtMins, rollingHrvAvg, spo2Rating, respRateRating, skinTempRating, hrvRating, recoveryComposite, sleepScoreRating, deepPctRating, remPctRating }
