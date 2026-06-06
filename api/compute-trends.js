// Correlation engine — compute-trends.js
// Systematic sweep of all (cause × effect × lag) triples.
// Returns ALL findings (no UI filtering here) sorted by effect_size descending.
// Caller decides what to surface.

// ── Severity / scale helpers ──────────────────────────────────────────────────

const SEV      = { None: 0, Low: 1, Med: 2, Bad: 3 }
const SLEEP_H  = { '<5': 4.5, '5': 5, '6': 6, '7': 7, '8': 8, '9+': 9 }
const WATER_N  = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '7+': 7 }
const ALCO_N   = { None: 0, '1': 1, '2': 2, '3': 3, '4': 4, '5+': 5 }
const QUAL_N   = { None: 0, Low: 1, Medium: 2, High: 3 }  // caffeine/sugar/carbs/protein/snacking
const ANTI_N   = { None: 0, '1': 1, '2': 2, '3+': 3 }
const FV_N     = v => { const n = parseInt(v); return isNaN(n) ? null : Math.min(n, 6) }

function sevOf(log, field) {
  if (field === 'gut') return SEV[log.body?.gut ?? log.health?.gut] ?? null
  if (field === 'nerve_pain') return SEV[log.body?.wrist_nerve_pain] ?? null
  if (field === 'knee_pain')  return SEV[log.body?.knee_pain] ?? null
  if (field === 'eczema')     return SEV[log.health?.eczema] ?? null
  if (field === 'hayfever')   return SEV[log.health?.hayfever] ?? null
  if (field === 'episcleritis') return SEV[log.health?.episcleritis] ?? null
  return null
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length }
function r2(n)     { return Math.round(n * 100) / 100 }

// ── Effect extractors ─────────────────────────────────────────────────────────
// Returns { id, label, scale, getValue(log) }

function buildEffects() {
  return [
    // Symptom severity (0–3)
    { id: 'eczema',         label: 'Eczema',          scale: 3, maxLag: 3, getValue: l => sevOf(l, 'eczema') },
    { id: 'hayfever',       label: 'Hayfever',        scale: 3, maxLag: 1, getValue: l => sevOf(l, 'hayfever') },
    { id: 'gut',            label: 'Gut severity',    scale: 3, maxLag: 1, getValue: l => sevOf(l, 'gut') },
    { id: 'nerve_pain',     label: 'Nerve pain',      scale: 3, maxLag: 1, getValue: l => sevOf(l, 'nerve_pain') },
    { id: 'knee_pain',      label: 'Knee pain',       scale: 3, maxLag: 1, getValue: l => sevOf(l, 'knee_pain') },
    { id: 'episcleritis',   label: 'Episcleritis',    scale: 3, maxLag: 1, getValue: l => sevOf(l, 'episcleritis') },
    { id: 'dryness',        label: 'Dryness',         scale: 3, maxLag: 1, getValue: l => l.health?.dryness?.length ?? null },
    // Gut symptoms (binary)
    { id: 'bloating',   label: 'Bloating',   scale: 1, maxLag: 1, getValue: l => { const s = l.body?.gut_symptoms ?? l.health?.gut_symptoms; return s ? (s.includes('Bloating')  ? 1 : 0) : null } },
    { id: 'cramps',     label: 'Cramps',     scale: 1, maxLag: 1, getValue: l => { const s = l.body?.gut_symptoms ?? l.health?.gut_symptoms; return s ? (s.includes('Cramps')    ? 1 : 0) : null } },
    { id: 'diarrhoea',  label: 'Diarrhoea',  scale: 1, maxLag: 1, getValue: l => { const s = l.body?.gut_symptoms ?? l.health?.gut_symptoms; return s ? (s.includes('Diarrhoea') ? 1 : 0) : null } },

    // Cognitive symptoms (binary)
    { id: 'brain_fog',  label: 'Brain fog',  scale: 1, maxLag: 1, getValue: l => { const s = l.mood?.symptoms ?? []; return s.some(x => /brain.?fog|fog/i.test(x)) ? 1 : 0 } },
    { id: 'headache',   label: 'Headache',   scale: 1, maxLag: 1, getValue: l => { const s = l.mood?.symptoms ?? []; return s.some(x => /headache/i.test(x)) ? 1 : 0 } },

    // Performance (1–5) — mood excluded (too noisy / confounded)
    { id: 'focus',      label: 'Focus',      scale: 4, maxLag: 1, getValue: l => l.mood?.focus  ?? null },
    { id: 'energy',     label: 'Energy',     scale: 4, maxLag: 1, getValue: l => l.mood?.energy ?? null },

    // Sleep next night (continuous)
    { id: 'sleep',      label: 'Sleep hours', scale: 4.5, maxLag: 1, getValue: l => SLEEP_H[l.sleep?.hours] ?? null },
  ]
}

// ── Cause extractors ──────────────────────────────────────────────────────────
// Returns array of { id, label, group, maxLag, isBinary, getValue(log, meta) }
// isBinary=true  → split into with/without buckets
// isBinary=false → treat as continuous, correlate with Pearson-like mean diff

function buildCauses(logs, weatherStore, fitbitRaw) {
  const causes = []

  // ── Allergens ───────────────────────────────────────────────────────────────
  // Discover allergen types actually in the data
  const allergenSet = new Set()
  for (const log of Object.values(logs)) {
    for (const a of (log.diet?.allergens ?? [])) allergenSet.add(a)
  }
  for (const allergen of allergenSet) {
    causes.push({
      id: `allergen:${allergen}`, label: allergen, group: 'allergen', maxLag: 5, isBinary: true,
      getValue: log => (log.diet?.allergens ?? []).includes(allergen),
    })
  }
  if (allergenSet.size > 1) {
    causes.push({
      id: 'allergen:any', label: 'Any allergen', group: 'allergen', maxLag: 5, isBinary: true,
      getValue: log => (log.diet?.allergens ?? []).length > 0,
    })
  }

  // ── Alcohol ─────────────────────────────────────────────────────────────────
  causes.push({
    id: 'alcohol:any', label: 'Alcohol (any)', group: 'alcohol', maxLag: 5, isBinary: true,
    getValue: log => (ALCO_N[log.alcohol?.level] ?? 0) > 0,
  })
  causes.push({
    id: 'alcohol:high', label: 'Alcohol high (2+)', group: 'alcohol', maxLag: 5, isBinary: true,
    getValue: log => (ALCO_N[log.alcohol?.level] ?? 0) >= 2,
  })
  // Also continuous — let the correlation engine pick up dose-response
  causes.push({
    id: 'alcohol:level', label: 'Alcohol level', group: 'alcohol', maxLag: 5, isBinary: false,
    getValue: log => ALCO_N[log.alcohol?.level] ?? null,
  })
  // Per-type — different histamine/sulfite/gluten profiles
  for (const type of ['Wine', 'Beer', 'Spirits']) {
    causes.push({
      id: `alcohol:${type.toLowerCase()}`, label: `${type}`, group: 'alcohol', maxLag: 5, isBinary: true,
      getValue: log => (ALCO_N[log.alcohol?.level] ?? 0) > 0 && (log.alcohol?.type ?? []).includes(type),
    })
  }
  // Beer specifically at high quantity (gluten/yeast load)
  causes.push({
    id: 'alcohol:beer_high', label: 'Beer high (2+)', group: 'alcohol', maxLag: 5, isBinary: true,
    getValue: log => (ALCO_N[log.alcohol?.level] ?? 0) >= 2 && (log.alcohol?.type ?? []).includes('Beer'),
  })
  // Cross-checks: beer/wine pooled with yeast allergen (shared yeast/sulfite mechanism)
  causes.push({
    id: 'alcohol:beer_or_yeast', label: 'Beer or Yeast allergen', group: 'alcohol', maxLag: 5, isBinary: true,
    getValue: log => ((log.alcohol?.type ?? []).includes('Beer') && (ALCO_N[log.alcohol?.level] ?? 0) > 0) ||
                     (log.diet?.allergens ?? []).some(a => /yeast/i.test(a)),
  })
  causes.push({
    id: 'alcohol:wine_or_yeast', label: 'Wine or Yeast allergen', group: 'alcohol', maxLag: 5, isBinary: true,
    getValue: log => ((log.alcohol?.type ?? []).includes('Wine') && (ALCO_N[log.alcohol?.level] ?? 0) > 0) ||
                     (log.diet?.allergens ?? []).some(a => /yeast/i.test(a)),
  })

  // ── Water ───────────────────────────────────────────────────────────────────
  causes.push({
    id: 'water:level', label: 'Water intake', group: 'water', maxLag: 3, isBinary: false,
    getValue: log => WATER_N[log.water?.glasses] ?? null,
  })

  // ── Sleep ───────────────────────────────────────────────────────────────────
  causes.push({
    id: 'sleep:hours', label: 'Sleep hours', group: 'sleep', maxLag: 3, isBinary: false,
    getValue: log => SLEEP_H[log.sleep?.hours] ?? null,
  })

  // ── Exercise ────────────────────────────────────────────────────────────────
  causes.push({
    id: 'exercise:yes', label: 'Exercise', group: 'exercise', maxLag: 3, isBinary: true,
    getValue: (log, _, fitbit) => {
      const hasAct  = (log.exercise?.activities?.length ?? 0) > 0
      const hasStep = (fitbit?.steps ?? 0) > 7000
      return hasAct || hasStep
    },
  })

  // ── Diet — ordinal treated as continuous ────────────────────────────────────
  causes.push({
    id: 'caffeine', label: 'Caffeine', group: 'diet', maxLag: 3, isBinary: false,
    getValue: log => QUAL_N[log.diet?.caffeine] ?? null,
  })
  causes.push({
    id: 'sugar', label: 'Sugar', group: 'diet', maxLag: 3, isBinary: false,
    getValue: log => QUAL_N[log.diet?.sugar] ?? null,
  })
  causes.push({
    id: 'carbs', label: 'Carbs', group: 'diet', maxLag: 3, isBinary: false,
    getValue: log => QUAL_N[log.diet?.carbs] ?? null,
  })
  causes.push({
    id: 'snacking', label: 'Snacking', group: 'diet', maxLag: 3, isBinary: false,
    getValue: log => QUAL_N[log.diet?.snacking] ?? null,
  })
  causes.push({
    id: 'protein', label: 'Protein', group: 'diet', maxLag: 3, isBinary: false,
    getValue: log => QUAL_N[log.diet?.protein] ?? null,
  })
  causes.push({
    id: 'fruit_veg', label: 'Fruit & veg portions', group: 'diet', maxLag: 3, isBinary: false,
    getValue: log => FV_N(log.diet?.fruit_veg),
  })

  // ── Meds ────────────────────────────────────────────────────────────────────
  causes.push({
    id: 'melatonin', label: 'Melatonin', group: 'meds', maxLag: 1, isBinary: true,
    getValue: log => log.mood?.melatonin === true,
  })
  causes.push({
    id: 'adhd_meds', label: 'Attentin', group: 'meds', maxLag: 1, isBinary: true,
    getValue: log => { const v = log.mood?.attentin ?? log.mood?.adhd_meds; return v != null && v !== 'None' },
  })
  causes.push({
    id: 'antihistamines_input', label: 'Antihistamines taken', group: 'meds', maxLag: 2, isBinary: true,
    getValue: log => (ANTI_N[log.health?.antihistamines] ?? 0) > 0,
  })
  causes.push({
    id: 'steroid_cream', label: 'Steroid cream', group: 'meds', maxLag: 3, isBinary: true,
    getValue: log => log.health?.steroid_cream === true || log.body?.steroid_cream === true,
  })

  // ── Environment ─────────────────────────────────────────────────────────────
  causes.push({
    id: 'pollen:high', label: 'High pollen + wind', group: 'environment', maxLag: 1, isBinary: true,
    getValue: (log, weather) => {
      const grass = weather?.grass_pollen ?? 0
      const wind  = weather?.wind_speed_max ?? 0
      return grass >= 50 || (grass >= 30 && wind >= 35)
    },
  })
  causes.push({
    id: 'grass_pollen', label: 'Grass pollen level', group: 'environment', maxLag: 1, isBinary: false,
    getValue: (log, weather) => weather?.grass_pollen ?? null,
  })

  return causes
}

// ── Core correlation ──────────────────────────────────────────────────────────

const MIN_N_PER_BUCKET = 3  // minimum data points per bucket to report a finding

function correlate(dates, cause, effect, lag, logs, weatherStore, fitbitRaw) {
  const withVals = [], withoutVals = []   // binary cause
  const causeVals = [], effectVals = []   // continuous cause

  for (const iso of dates) {
    const causeLog     = logs[iso]
    const causeWeather = weatherStore[iso]
    const causeFitbit  = fitbitRaw[iso]
    const effectLog    = logs[addDays(iso, lag)]
    if (!causeLog || !effectLog) continue

    const effectVal = effect.getValue(effectLog)
    if (effectVal == null) continue

    if (cause.isBinary) {
      const active = cause.getValue(causeLog, causeWeather, causeFitbit)
      if (active)      withVals.push(effectVal)
      else             withoutVals.push(effectVal)
    } else {
      const causeVal = cause.getValue(causeLog, causeWeather, causeFitbit)
      if (causeVal == null) continue
      causeVals.push(causeVal)
      effectVals.push(effectVal)
    }
  }

  if (cause.isBinary) {
    if (withVals.length < MIN_N_PER_BUCKET || withoutVals.length < MIN_N_PER_BUCKET) return null
    const avgWith    = mean(withVals)
    const avgWithout = mean(withoutVals)
    const diff       = avgWith - avgWithout
    const effectSize = Math.abs(diff) / effect.scale
    return {
      cause_id:    cause.id,
      cause_label: cause.label,
      cause_group: cause.group,
      effect_id:   effect.id,
      effect_label: effect.label,
      lag,
      type:        'binary',
      n_with:      withVals.length,
      n_without:   withoutVals.length,
      n:           withVals.length + withoutVals.length,
      mean_with:   r2(avgWith),
      mean_without: r2(avgWithout),
      diff:        r2(diff),
      effect_size: r2(effectSize),
      direction:   diff > 0 ? 'higher_with' : diff < 0 ? 'lower_with' : 'none',
    }
  } else {
    if (causeVals.length < MIN_N_PER_BUCKET * 2) return null
    // Pearson correlation + effect size from regression slope
    const n    = causeVals.length
    const mx   = mean(causeVals)
    const my   = mean(effectVals)
    let num = 0, dxSq = 0, dySq = 0
    for (let i = 0; i < n; i++) {
      const dx = causeVals[i] - mx
      const dy = effectVals[i] - my
      num  += dx * dy
      dxSq += dx * dx
      dySq += dy * dy
    }
    if (dxSq === 0 || dySq === 0) return null
    const r    = num / Math.sqrt(dxSq * dySq)
    const slope = num / dxSq  // dy per unit of cause
    const effectSize = Math.abs(r)  // |Pearson r| as effect size
    return {
      cause_id:    cause.id,
      cause_label: cause.label,
      cause_group: cause.group,
      effect_id:   effect.id,
      effect_label: effect.label,
      lag,
      type:        'continuous',
      n,
      pearson_r:   r2(r),
      slope:       r2(slope),
      effect_size: r2(effectSize),
      direction:   r > 0 ? 'positive' : r < 0 ? 'negative' : 'none',
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeTrends(logs, weatherStore = {}, fitbitRaw = {}) {
  const dates  = Object.keys(logs).sort()
  const causes  = buildCauses(logs, weatherStore, fitbitRaw)
  const effects = buildEffects()
  const findings = []

  for (const cause of causes) {
    for (let lag = 0; lag <= cause.maxLag; lag++) {
      for (const effect of effects) {
        // Respect per-effect lag cap
        if (lag > effect.maxLag) continue

        // Skip: cause and effect are the same metric (e.g. sleep→sleep at lag 0)
        if (cause.id.includes(effect.id) || effect.id.includes(cause.id.split(':')[0])) {
          if (lag === 0) continue
        }
        // Skip antihistamines-as-input → antihistamines-as-output (same metric)
        if (cause.id === 'antihistamines_input' && effect.id === 'antihistamines') continue

        const finding = correlate(dates, cause, effect, lag, logs, weatherStore, fitbitRaw)
        if (finding) findings.push(finding)
      }
    }
  }

  // Sort by effect_size descending — strongest signals first
  findings.sort((a, b) => b.effect_size - a.effect_size)

  return {
    computed_at: new Date().toISOString().slice(0, 10),
    n_days:      dates.length,
    findings,
  }
}
