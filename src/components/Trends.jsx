import { useState, useEffect } from 'react'
import { dbWrite, dbRead } from '../lib/db'
import './Trends.css'

// ── Effect group definitions ──────────────────────────────────────────────────

const EFFECT_GROUPS = [
  { id: 'eczema',       label: 'Eczema',               effects: ['eczema'] },
  { id: 'hayfever',     label: 'Hayfever',             effects: ['hayfever'] },
  { id: 'gut',          label: 'Gut',                  effects: ['gut', 'bloating', 'cramps', 'diarrhoea'] },
  { id: 'pain',         label: 'Nerve & joint pain',   effects: ['nerve_pain', 'knee_pain'] },
  { id: 'eyes_skin',    label: 'Eyes & skin',          effects: ['episcleritis', 'dryness'] },
  { id: 'energy',       label: 'Energy',               effects: ['energy'] },
  { id: 'mood',         label: 'Mood',                 effects: ['work_mood', 'life_mood'] },
  { id: 'cognitive',    label: 'Brain fog & focus',    effects: ['brain_fog', 'focus'] },
  { id: 'headache',     label: 'Headache',             effects: ['headache'] },
  { id: 'sleep',        label: 'Sleep',                effects: ['sleep'] },
]

const HIGHER_IS_BAD = new Set([
  'eczema', 'hayfever', 'gut', 'nerve_pain', 'knee_pain',
  'episcleritis', 'dryness',
  'bloating', 'cramps', 'diarrhoea', 'brain_fog', 'headache',
])

const EFFECT_LABELS = {
  eczema: 'eczema', hayfever: 'hayfever', gut: 'gut severity',
  nerve_pain: 'nerve pain', knee_pain: 'knee pain',
  episcleritis: 'episcleritis', dryness: 'dryness',
  energy: 'energy', focus: 'focus',
  work_mood: 'work mood', life_mood: 'life mood',
  brain_fog: 'brain fog', headache: 'headaches',
  sleep: 'sleep quality',
  bloating: 'bloating', cramps: 'cramps', diarrhoea: 'diarrhoea',
}

const SEV_LABEL = v => {
  if (v == null) return '?'
  if (v <= 0.3)  return 'none'
  if (v <= 0.7)  return 'very low'
  if (v <= 1.2)  return 'low'
  if (v <= 1.7)  return 'low-medium'
  if (v <= 2.2)  return 'medium'
  if (v <= 2.7)  return 'medium-high'
  return 'high'
}

const MOOD_LABEL = v => {
  if (v == null) return '?'
  if (v <= 1.5)  return 'very low'
  if (v <= 2.2)  return 'low'
  if (v <= 3.0)  return 'moderate'
  if (v <= 3.7)  return 'good'
  if (v <= 4.3)  return 'high'
  return 'very high'
}

function scoreLabel(effectId, val) {
  if (val == null) return '?'
  if (['focus', 'energy', 'work_mood', 'life_mood', 'sleep'].includes(effectId)) return MOOD_LABEL(val)
  if (['brain_fog', 'headache', 'bloating', 'cramps', 'diarrhoea'].includes(effectId)) return val >= 0.5 ? 'present' : 'absent'
  return SEV_LABEL(val)
}

function lagPhrase(lag) {
  if (lag === 0) return 'on the same day'
  if (lag === 1) return 'the following day'
  return `${lag} days later`
}

// ── Direction helpers ─────────────────────────────────────────────────────────

function findingDirection(f) {
  const higherIsBad = HIGHER_IS_BAD.has(f.effect_id)
  if (f.type === 'binary') {
    if (f.direction === 'higher_with' && higherIsBad)  return 'bad'
    if (f.direction === 'higher_with' && !higherIsBad) return 'good'
    if (f.direction === 'lower_with'  && higherIsBad)  return 'good'
    return 'bad'
  }
  if (f.type === 'continuous') {
    const positive = f.direction === 'positive'
    if (positive && higherIsBad)  return 'bad'
    if (positive && !higherIsBad) return 'good'
    if (!positive && higherIsBad) return 'good'
    return 'bad'
  }
  return 'neutral'
}

// ── Sentence rendering (JSX, with bold) ───────────────────────────────────────

function FindingSentence({ f }) {
  const effectLabel = EFFECT_LABELS[f.effect_id] ?? f.effect_label
  const higherIsBad = HIGHER_IS_BAD.has(f.effect_id)
  const lag = lagPhrase(f.lag)

  if (f.type === 'binary') {
    const worsen  = f.direction === 'higher_with' && higherIsBad
    const improve = f.direction === 'higher_with' && !higherIsBad
    const reduce  = f.direction === 'lower_with'  && higherIsBad

    if (worsen)  return <span className="trd-sentence"><strong>{f.cause_label}</strong> <strong className="trd-dir--bad">tends to worsen</strong> your {effectLabel}, {lag}</span>
    if (improve) return <span className="trd-sentence"><strong>{f.cause_label}</strong> correlates with <strong className="trd-dir--good">better</strong> {effectLabel}, {lag}</span>
    if (reduce)  return <span className="trd-sentence"><strong>{f.cause_label}</strong> correlates with <strong className="trd-dir--good">lower</strong> {effectLabel}, {lag}</span>
    return         <span className="trd-sentence"><strong>{f.cause_label}</strong> correlates with <strong className="trd-dir--bad">lower</strong> {effectLabel}, {lag}</span>
  }

  if (f.type === 'continuous') {
    const positive = f.direction === 'positive'
    const worsen   = positive && higherIsBad
    const improve  = positive && !higherIsBad
    const reduce   = !positive && higherIsBad

    if (worsen)  return <span className="trd-sentence">Higher <strong>{f.cause_label.toLowerCase()}</strong> correlates with <strong className="trd-dir--bad">worse</strong> {effectLabel}, {lag}</span>
    if (improve) return <span className="trd-sentence">Higher <strong>{f.cause_label.toLowerCase()}</strong> correlates with <strong className="trd-dir--good">better</strong> {effectLabel}, {lag}</span>
    if (reduce)  return <span className="trd-sentence">Higher <strong>{f.cause_label.toLowerCase()}</strong> correlates with <strong className="trd-dir--good">lower</strong> {effectLabel}, {lag}</span>
    return         <span className="trd-sentence">Higher <strong>{f.cause_label.toLowerCase()}</strong> correlates with <strong className="trd-dir--bad">lower</strong> {effectLabel}, {lag}</span>
  }

  return <span className="trd-sentence">{f.cause_label} → {effectLabel}</span>
}

// ── Plain-English sentence (string, for modal title) ──────────────────────────

function shortSentence(f) {
  const effectLabel = EFFECT_LABELS[f.effect_id] ?? f.effect_label
  const lag = lagPhrase(f.lag)
  const higherIsBad = HIGHER_IS_BAD.has(f.effect_id)

  if (f.type === 'binary') {
    const worsen  = f.direction === 'higher_with' && higherIsBad
    const improve = f.direction === 'higher_with' && !higherIsBad
    const reduce  = f.direction === 'lower_with'  && higherIsBad
    if (worsen)  return `${f.cause_label} tends to worsen your ${effectLabel}, ${lag}`
    if (improve) return `${f.cause_label} correlates with better ${effectLabel}, ${lag}`
    if (reduce)  return `${f.cause_label} correlates with lower ${effectLabel}, ${lag}`
    return `${f.cause_label} correlates with lower ${effectLabel}, ${lag}`
  }

  if (f.type === 'continuous') {
    const positive = f.direction === 'positive'
    const worsen   = positive && higherIsBad
    const improve  = positive && !higherIsBad
    const reduce   = !positive && higherIsBad
    if (worsen)  return `Higher ${f.cause_label.toLowerCase()} correlates with worse ${effectLabel}, ${lag}`
    if (improve) return `Higher ${f.cause_label.toLowerCase()} correlates with better ${effectLabel}, ${lag}`
    if (reduce)  return `Higher ${f.cause_label.toLowerCase()} correlates with lower ${effectLabel}, ${lag}`
    return `Higher ${f.cause_label.toLowerCase()} correlates with lower ${effectLabel}, ${lag}`
  }

  return `${f.cause_label} → ${effectLabel} (lag ${f.lag}d)`
}

// ── Full modal explanation ────────────────────────────────────────────────────

function fullExplanation(f) {
  const effectLabel = EFFECT_LABELS[f.effect_id] ?? f.effect_label
  const higherIsBad = HIGHER_IS_BAD.has(f.effect_id)

  if (f.type === 'binary') {
    const withLabel    = scoreLabel(f.effect_id, f.mean_with)
    const withoutLabel = scoreLabel(f.effect_id, f.mean_without)
    const lagText = f.lag === 0 ? 'on the same day'
      : f.lag === 1 ? 'the day after'
      : `${f.lag} days after`
    const direction = f.direction === 'higher_with'
      ? (higherIsBad ? 'higher (worse)' : 'higher (better)')
      : (higherIsBad ? 'lower (better)' : 'lower (worse)')
    const totalN = f.n

    return [
      `On the ${f.n_with} day${f.n_with !== 1 ? 's' : ''} when you had ${f.cause_label.toLowerCase()}, your ${effectLabel} was ${withLabel} ${lagText} (avg ${f.mean_with}/scale).`,
      `On the ${f.n_without} day${f.n_without !== 1 ? 's' : ''} without, it was ${withoutLabel} (avg ${f.mean_without}/scale).`,
      `That's ${direction} — a difference of ${Math.abs(f.diff).toFixed(1)} points.`,
      totalN < 14 ? `Small sample (${totalN} days total) — treat as an early signal.` : `Based on ${totalN} days of data.`,
    ].join(' ')
  }

  if (f.type === 'continuous') {
    const rStrength = Math.abs(f.pearson_r) >= 0.6 ? 'strong' : Math.abs(f.pearson_r) >= 0.35 ? 'moderate' : 'weak'
    const positive = f.direction === 'positive'
    const lagText = f.lag === 0 ? 'on the same day' : f.lag === 1 ? 'the following day' : `${f.lag} days later`
    // positive r = higher cause → higher effect; negative r = higher cause → lower effect
    const isBeneficial = (positive && !higherIsBad) || (!positive && higherIsBad)
    const outcomeWord = isBeneficial ? 'better' : 'worse'

    return [
      `${f.cause_label} and your ${effectLabel} are ${rStrength}ly correlated ${lagText} (r = ${f.pearson_r}).`,
      `Higher ${f.cause_label.toLowerCase()} tends to mean ${outcomeWord} ${effectLabel}.`,
      f.n < 14 ? `Small sample (${f.n} days) — early signal only.` : `Based on ${f.n} days of data.`,
    ].join(' ')
  }

  return ''
}

// ── Effect size icon ──────────────────────────────────────────────────────────

function strengthDots(effectSize, direction) {
  const filled = effectSize >= 0.5 ? 3 : effectSize >= 0.3 ? 2 : 1
  const cls = direction === 'bad' ? 'trd-dot--bad' : direction === 'good' ? 'trd-dot--good' : 'trd-dot--neutral'
  return Array.from({ length: 3 }, (_, i) => (
    <span key={i} className={`trd-dot${i < filled ? ` ${cls}` : ''}`} />
  ))
}

// ── Collapse to best lag per (cause, effect) pair ────────────────────────────

function bestLagFindings(findings) {
  const map = new Map()
  for (const f of findings) {
    const key = `${f.cause_id}::${f.effect_id}`
    const existing = map.get(key)
    if (!existing || f.effect_size > existing.effect_size) map.set(key, f)
  }
  return [...map.values()]
}

const MIN_EFFECT_SIZE = 0.3
const MIN_N = 10

const HIDDEN_KEY = 'lifetracker-trends-hidden'
function loadHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY)) ?? []) } catch { return new Set() }
}
function saveHidden(set) {
  try {
    const arr = [...set]
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(arr))
    dbWrite(HIDDEN_KEY, arr).catch(() => {})
  } catch {}
}

const FEEDBACK_KEY = 'lifetracker-trends-feedback'
function feedbackKey(f) {
  return `${f.cause_id}::${f.effect_id}::${findingDirection(f)}`
}
function loadFeedback() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(FEEDBACK_KEY)) ?? {})) } catch { return new Map() }
}
function saveFeedback(map) {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(Object.fromEntries(map)))
    dbWrite(FEEDBACK_KEY, Object.fromEntries(map)).catch(() => {})
  } catch {}
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Trends() {
  const [findings, setFindings] = useState([])
  const [computedAt, setComputedAt] = useState(null)
  const [nDays, setNDays] = useState(0)
  const [loading, setLoading] = useState(true)
  const [openGroups, setOpenGroups] = useState({})
  const [openSubGroups, setOpenSubGroups] = useState({})
  const [selectedFinding, setSelectedFinding] = useState(null)
  const [hidden, setHidden] = useState(loadHidden)
  const [feedback, setFeedback] = useState(loadFeedback)

  useEffect(() => {
    async function load() {
      try {
        const [res, hiddenRemote, feedbackRemote] = await Promise.all([
          fetch('/api/trends'),
          dbRead(HIDDEN_KEY),
          dbRead(FEEDBACK_KEY),
        ])
        const data = await res.json()
        if (data.findings?.length) {
          setFindings(
            bestLagFindings(data.findings)
              .filter(f => f.effect_size >= MIN_EFFECT_SIZE && f.n >= MIN_N)
              .filter(f => {
                if (!HIGHER_IS_BAD.has(f.effect_id) || f.lag !== 0) return true
                // Allow same-day for hayfever/eczema driven by environment (pollen, wind)
                return f.cause_group === 'environment' && (f.effect_id === 'hayfever' || f.effect_id === 'eczema')
              })
          )
          setComputedAt(data.computed_at)
          setNDays(data.n_days)
        }
        if (hiddenRemote) {
          const s = new Set(hiddenRemote)
          setHidden(s)
          localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]))
        }
        if (feedbackRemote) {
          const m = new Map(Object.entries(feedbackRemote))
          setFeedback(m)
          localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedbackRemote))
        }
      } catch (err) {
        console.error('[Trends] load failed', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function toggleGroup(id) {
    setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleSubGroup(id) {
    setOpenSubGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function hideFinding(f) {
    const key = `${f.cause_id}::${f.effect_id}`
    setHidden(prev => {
      const next = new Set(prev)
      next.add(key)
      saveHidden(next)
      return next
    })
    if (selectedFinding && `${selectedFinding.cause_id}::${selectedFinding.effect_id}` === key) {
      setSelectedFinding(null)
    }
  }

  function resetHidden() {
    setHidden(new Set())
    saveHidden(new Set())
  }

  function voteFinding(f, vote) {
    const key = feedbackKey(f)
    setFeedback(prev => {
      const next = new Map(prev)
      next.set(key, vote)
      saveFeedback(next)
      return next
    })
    if (vote === 'disagree') hideFinding(f)
    else setSelectedFinding(null)
  }

  const visibleFindings = findings.filter(f => !hidden.has(`${f.cause_id}::${f.effect_id}`))

  const activeGroups = EFFECT_GROUPS
    .map(group => {
      const groupFindings = visibleFindings
        .filter(f => group.effects.includes(f.effect_id))
        .sort((a, b) => b.effect_size - a.effect_size)

      const effectIds = [...new Set(groupFindings.map(f => f.effect_id))]
      const isMultiEffect = effectIds.length > 1

      const subGroups = isMultiEffect
        ? effectIds.map(eid => ({
            id: eid,
            label: (EFFECT_LABELS[eid] ?? eid).replace(/^\w/, c => c.toUpperCase()),
            findings: groupFindings.filter(f => f.effect_id === eid),
          })).filter(sg => sg.findings.length > 0)
        : null

      return { ...group, findings: groupFindings, isMultiEffect, subGroups }
    })
    .filter(g => g.findings.length > 0)

  if (loading) {
    return <div className="trd-empty">Loading patterns…</div>
  }

  if (!findings.length) {
    return (
      <div className="trd-empty">
        <p>No patterns yet.</p>
        <p className="trd-empty-sub">Trends run daily at 7am once enough data has built up.</p>
      </div>
    )
  }

  return (
    <div className="trd-panel">
      {computedAt && (
        <div className="trd-meta">
          {nDays} days of data · updated {computedAt}
        </div>
      )}

      {activeGroups.map(group => {
        const isOpen = openGroups[group.id] !== false  // default open
        return (
          <div key={group.id} className="trd-group">
            <button className="trd-group-header" onClick={() => toggleGroup(group.id)}>
              <span className="trd-group-label">{group.label}</span>
              <span className="trd-group-count">{group.findings.length}</span>
              <span className="trd-group-arrow">{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && (
              group.isMultiEffect ? (
                group.subGroups.map(sg => {
                  const sgKey = `${group.id}::${sg.id}`
                  const sgOpen = openSubGroups[sgKey] === true  // default collapsed
                  return (
                    <div key={sg.id} className="trd-subgroup">
                      <button className="trd-subgroup-header" onClick={() => toggleSubGroup(sgKey)}>
                        <span className="trd-subgroup-label">{sg.label}</span>
                        <span className="trd-group-count">{sg.findings.length}</span>
                        <span className="trd-group-arrow">{sgOpen ? '▾' : '▸'}</span>
                      </button>
                      {sgOpen && sg.findings.map(f => (
                        <FindingRow key={`${f.cause_id}::${f.effect_id}`} f={f} onSelect={setSelectedFinding} vote={feedback.get(feedbackKey(f))} />
                      ))}
                    </div>
                  )
                })
              ) : (
                group.findings.map(f => (
                  <FindingRow key={`${f.cause_id}::${f.effect_id}`} f={f} onSelect={setSelectedFinding} vote={feedback.get(feedbackKey(f))} />
                ))
              )
            )}
          </div>
        )
      })}

      {hidden.size > 0 && (
        <button className="trd-reset-hidden" onClick={resetHidden}>
          Show {hidden.size} hidden finding{hidden.size !== 1 ? 's' : ''}
        </button>
      )}

      {selectedFinding && (
        <div className="trd-modal-overlay" onClick={() => setSelectedFinding(null)}>
          <div className="trd-modal" onClick={e => e.stopPropagation()}>
            <div className="trd-modal-title">{shortSentence(selectedFinding)}</div>
            <p className="trd-modal-body">{fullExplanation(selectedFinding)}</p>
            <div className="trd-modal-vote-label">Does this match your experience?</div>
            <div className="trd-modal-actions">
              <button className="trd-modal-vote trd-modal-vote--disagree" onClick={() => voteFinding(selectedFinding, 'disagree')}>
                <span>👎</span> Disagree
              </button>
              <button className="trd-modal-vote trd-modal-vote--unsure" onClick={() => voteFinding(selectedFinding, 'unsure')}>
                <span>🤷‍♀️</span> Not sure
              </button>
              <button className="trd-modal-vote trd-modal-vote--agree" onClick={() => voteFinding(selectedFinding, 'agree')}>
                <span>👍</span> Agree
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FindingRow({ f, onSelect, vote }) {
  const dir = findingDirection(f)
  return (
    <div className="trd-finding-row">
      <button className="trd-finding" onClick={() => onSelect(f)}>
        <span className="trd-strength">{strengthDots(f.effect_size, dir)}</span>
        <FindingSentence f={f} />
        {vote === 'agree' && <span className="trd-vote-badge">👍</span>}
        {vote === 'unsure' && <span className="trd-vote-badge trd-vote-badge--unsure">🤷‍♀️</span>}
        <span className="trd-chevron">›</span>
      </button>
    </div>
  )
}
