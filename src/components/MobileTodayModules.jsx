import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import {
  MODULES, MODULE_EMOJI, COMPLETE_CHECK, PopoverField,
  EXERCISE_MODULE, BODY_MODULE,
  sleepColorFromFitbit, sleepColorFromOldData, sleepEffLabel, fmtMins,
} from './LifeModules'
import './LifeModules.css'
import './MobileTodayModules.css'

const H5 = { 1: '#fee2e2', 2: '#fde8c8', 3: '#fef9c3', 4: '#dcfce7', 5: '#86efac' }
const WATER_CYCLE   = [1, 2, 3, 4, 5, 6, 7, '8+', null]
const ALCOHOL_CYCLE = [1, 2, 3, 4, '5+', null]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function MobileTodayModules() {
  const [logs, setLogs]       = useLocalStorage('lifetracker-life-logs', {})
  const [fitbitRaw]           = useLocalStorage('lifetracker-fitbit-raw', {})
  const [activeModule, setActiveModule] = useState(null)
  const [gratEdit, setGratEdit]         = useState(false)

  useEffect(() => {
    function onLogsUpdated() {
      try {
        const raw = localStorage.getItem('lifetracker-life-logs')
        if (raw) setLogs(JSON.parse(raw))
      } catch {}
    }
    window.addEventListener('lifetracker-logs-updated', onLogsUpdated)
    return () => window.removeEventListener('lifetracker-logs-updated', onLogsUpdated)
  }, []) // eslint-disable-line

  const today    = todayIso()
  const todayLog = logs[today] ?? {}
  const transcripts = todayLog.transcripts ?? []

  function setFieldValue(moduleKey, fieldKey, value) {
    setLogs(prev => ({
      ...prev,
      [today]: {
        ...(prev[today] ?? {}),
        [moduleKey]: {
          ...((prev[today] ?? {})[moduleKey] ?? {}),
          [fieldKey]: value,
        },
      },
    }))
  }

  function openModule(key) {
    const mod = [...MODULES, EXERCISE_MODULE, BODY_MODULE].find(m => m.key === key)
    if (mod?.defaults) {
      setLogs(prev => {
        const current = prev[today]?.[key] ?? {}
        const patch = Object.fromEntries(
          Object.entries(mod.defaults).filter(([k]) => current[k] == null)
        )
        if (!Object.keys(patch).length) return prev
        return { ...prev, [today]: { ...(prev[today] ?? {}), [key]: { ...current, ...patch } } }
      })
    }
    setActiveModule(key)
  }

  // ── Water / Alcohol tap-increment ─────────────────────────────────────────

  function incrementWater() {
    const current = todayLog.water?.glasses
    const idx  = WATER_CYCLE.findIndex(v => String(v ?? '') === String(current ?? ''))
    const next = WATER_CYCLE[(idx < 0 ? 0 : idx + 1) % WATER_CYCLE.length]
    setFieldValue('water', 'glasses', next)
  }

  function incrementAlcohol() {
    const current = todayLog.alcohol?.level
    const idx  = ALCOHOL_CYCLE.findIndex(v => String(v ?? '') === String(current ?? ''))
    const next = ALCOHOL_CYCLE[(idx < 0 ? 0 : idx + 1) % ALCOHOL_CYCLE.length]
    setFieldValue('alcohol', 'level', next)
  }

  // ── Fitbit: sleep ─────────────────────────────────────────────────────────

  const fitbitToday  = fitbitRaw[today] ?? {}
  const sleepMin     = fitbitToday.sleep_minutes
  const inBedMin     = fitbitToday.in_bed_minutes
  const oldSleep     = todayLog.sleep
  const hasFitbitSleep = sleepMin != null
  const hasOldSleep    = !hasFitbitSleep && oldSleep?.hours != null
  const sleepBg    = hasFitbitSleep
    ? sleepColorFromFitbit(sleepMin, inBedMin)
    : hasOldSleep ? sleepColorFromOldData(oldSleep) : null
  const sleepLabel = hasFitbitSleep
    ? `${(sleepMin / 60).toFixed(1)}h`
    : hasOldSleep ? oldSleep.hours : null
  const hasSleepData = hasFitbitSleep || hasOldSleep

  // ── Fitbit: steps ─────────────────────────────────────────────────────────

  const steps      = fitbitToday.steps
  const stepsActive  = fitbitToday.active_energy_kcal
  const stepsResting = fitbitToday.resting_energy_kcal
  const stepsBg    = steps == null ? null
    : steps < 4000  ? '#fee2e2'
    : steps < 6000  ? '#fde8c8'
    : steps < 8000  ? '#fef9c3'
    : steps < 10000 ? '#dcfce7'
    : steps < 12000 ? '#bbf7d0'
    : '#86efac'
  const stepsLabel   = steps != null ? (steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : String(steps)) : null
  const hasStepsData = steps != null || stepsActive != null

  // ── Body ──────────────────────────────────────────────────────────────────

  const bodyData = todayLog.body ?? {}
  const period   = bodyData.period ?? !!todayLog.period
  const illness  = bodyData.illness
  const kg       = fitbitToday.weight_kg
  const bodyBg   = illness && illness !== 'None' ? '#fee2e2' : period ? '#fce7f3' : kg != null ? '#f1f5f9' : null

  // ── Exercise ──────────────────────────────────────────────────────────────

  const exData    = todayLog.exercise ?? null
  const energy    = exData?.energy ?? todayLog.mood?.energy ?? null
  const exerciseBg = energy != null ? (H5[energy] ?? null) : null
  const exActs    = exData?.activities
  const exLabel   = exActs?.length ? exActs.slice(0, 2).join(' · ') : null

  // ── Module refs ───────────────────────────────────────────────────────────

  const moodMod   = MODULES.find(m => m.key === 'mood')
  const healthMod = MODULES.find(m => m.key === 'health')
  const waterMod  = MODULES.find(m => m.key === 'water')
  const alcoholMod= MODULES.find(m => m.key === 'alcohol')
  const dietMod   = MODULES.find(m => m.key === 'diet')
  const socialMod = MODULES.find(m => m.key === 'social')

  // Which sheet to show
  const activeMod = activeModule && !['sleep', 'steps', 'journal'].includes(activeModule)
    ? [...MODULES, EXERCISE_MODULE, BODY_MODULE].find(m => m.key === activeModule)
    : null

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderModCard(mod, dayData, onClick) {
    const bg       = mod.cellColor(dayData)
    const rawLabel = mod.cellLabel(dayData)
    const label    = Array.isArray(rawLabel) ? rawLabel.slice(0, 2).join(' · ') : rawLabel
    const incomplete = COMPLETE_CHECK[mod.key] && !COMPLETE_CHECK[mod.key](dayData)
    return (
      <button
        key={mod.key}
        className={`mlm-card ${incomplete ? 'mlm-card--incomplete' : ''} ${activeModule === mod.key ? 'mlm-card--active' : ''}`}
        style={bg ? { background: bg } : undefined}
        onClick={onClick}
      >
        <span className="mlm-card-emoji">{MODULE_EMOJI[mod.key] ?? '•'}</span>
        <span className="mlm-card-name">{mod.label}</span>
        {label != null && <span className="mlm-card-value">{label}</span>}
      </button>
    )
  }

  function getFieldValue(mod, field) {
    if (mod.key === 'body') {
      const full = { ...bodyData, _weight_kg: kg != null ? (kg % 1 === 0 ? String(kg) : kg.toFixed(1)) : null }
      return full[field.key] ?? null
    }
    if (mod.key === 'exercise') {
      return { ...(exData ?? {}), energy: exData?.energy ?? todayLog.mood?.energy ?? undefined }[field.key] ?? null
    }
    return (todayLog[mod.key] ?? {})[field.key] ?? null
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="mlm-panel">
      <div className="mlm-header-row">
        <div className="mlm-section-label">Today's log</div>
        {transcripts.length > 0 && (
          <button className="mlm-journal-link" onClick={() => setActiveModule('journal')}>
            📝 Journal
          </button>
        )}
      </div>

      <div className="mlm-grid">

        {/* 1. Sleep — readonly Fitbit display */}
        <button
          className={`mlm-card ${activeModule === 'sleep' ? 'mlm-card--active' : ''}`}
          style={sleepBg ? { background: sleepBg } : undefined}
          onClick={() => hasSleepData && setActiveModule('sleep')}
        >
          <span className="mlm-card-emoji">😴</span>
          <span className="mlm-card-name">Sleep</span>
          {sleepLabel && <span className="mlm-card-value">{sleepLabel}</span>}
        </button>

        {/* 2. Steps — readonly Fitbit display */}
        <button
          className={`mlm-card ${activeModule === 'steps' ? 'mlm-card--active' : ''}`}
          style={stepsBg ? { background: stepsBg } : undefined}
          onClick={() => hasStepsData && setActiveModule('steps')}
        >
          <span className="mlm-card-emoji">👟</span>
          <span className="mlm-card-name">Steps</span>
          {stepsLabel && <span className="mlm-card-value">{stepsLabel}</span>}
        </button>

        {/* 3. Mind */}
        {renderModCard(moodMod, todayLog.mood ?? null, () => openModule('mood'))}

        {/* 4. Inflammation */}
        {renderModCard(healthMod, todayLog.health ?? null, () => openModule('health'))}

        {/* 5. Water — tap to increment */}
        {(() => {
          const dayData = todayLog.water ?? null
          const bg      = waterMod.cellColor(dayData)
          const label   = dayData?.glasses != null ? String(dayData.glasses) : null
          const incomplete = COMPLETE_CHECK.water && !COMPLETE_CHECK.water(dayData)
          return (
            <button
              className={`mlm-card ${incomplete ? 'mlm-card--incomplete' : ''}`}
              style={bg ? { background: bg } : undefined}
              onClick={incrementWater}
            >
              <span className="mlm-card-emoji">💧</span>
              <span className="mlm-card-name">Water</span>
              {label && <span className="mlm-card-value">{label}</span>}
            </button>
          )
        })()}

        {/* 6. Alcohol — tap to increment */}
        {(() => {
          const dayData = todayLog.alcohol ?? null
          const bg      = alcoholMod.cellColor(dayData)
          const label   = dayData?.level != null ? String(dayData.level) : null
          return (
            <button
              className="mlm-card"
              style={bg ? { background: bg } : undefined}
              onClick={incrementAlcohol}
            >
              <span className="mlm-card-emoji">🍷</span>
              <span className="mlm-card-name">Alcohol</span>
              {label && <span className="mlm-card-value">{label}</span>}
            </button>
          )
        })()}

        {/* 7. Diet */}
        {renderModCard(dietMod, todayLog.diet ?? null, () => openModule('diet'))}

        {/* 8. Exercise */}
        <button
          className={`mlm-card ${activeModule === 'exercise' ? 'mlm-card--active' : ''} ${!COMPLETE_CHECK.exercise?.(exData) ? 'mlm-card--incomplete' : ''}`}
          style={exerciseBg ? { background: exerciseBg } : undefined}
          onClick={() => openModule('exercise')}
        >
          <span className="mlm-card-emoji">🏃</span>
          <span className="mlm-card-name">Exercise</span>
          {exLabel && <span className="mlm-card-value">{exLabel}</span>}
        </button>

        {/* 9. Body (replaces Cycle) */}
        <button
          className={`mlm-card ${activeModule === 'body' ? 'mlm-card--active' : ''}`}
          style={bodyBg ? { background: bodyBg } : undefined}
          onClick={() => openModule('body')}
        >
          <span className="mlm-card-emoji">🌸</span>
          <span className="mlm-card-name">Body</span>
          {period && <span className="mlm-card-value">Period</span>}
        </button>

        {/* 10. Social */}
        {renderModCard(socialMod, todayLog.social ?? null, () => openModule('social'))}

      </div>

      {/* Gratitude */}
      <div className="mlm-gratitude">
        <span className="mlm-gratitude-emoji">🙏</span>
        {gratEdit ? (
          <input
            className="mlm-gratitude-input"
            autoFocus
            placeholder="What are you grateful for?"
            defaultValue={todayLog.gratitude ?? ''}
            onBlur={e => {
              const text = e.target.value.trim()
              setLogs(prev => ({
                ...prev,
                [today]: { ...(prev[today] ?? {}), gratitude: text || null },
              }))
              setGratEdit(false)
            }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
          />
        ) : (
          <span
            className={`mlm-gratitude-text ${!todayLog.gratitude ? 'mlm-gratitude-text--empty' : ''}`}
            onClick={() => setGratEdit(true)}
          >
            {todayLog.gratitude ?? 'Add gratitude…'}
          </span>
        )}
      </div>

      {/* ── Module edit bottom sheet ── */}
      {activeMod && createPortal(
        <>
          <div className="mlm-overlay" onClick={() => setActiveModule(null)} />
          <div className="mlm-sheet">
            <div className="mlm-sheet-handle" />
            <div className="mlm-sheet-header">
              <span className="mlm-sheet-title">
                {activeMod.key === 'body' || activeMod.key === 'exercise'
                  ? { body: '🌸', exercise: '🏃' }[activeMod.key]
                  : MODULE_EMOJI[activeMod.key] ?? ''
                } {activeMod.label}
              </span>
              <span className="mlm-sheet-date">{fmtDate(today)}</span>
              <button className="mlm-sheet-close" onClick={() => setActiveModule(null)}>✕</button>
            </div>
            <div className="mlm-sheet-fields">
              {activeMod.fields.map(field => (
                <PopoverField
                  key={field.key}
                  field={field}
                  value={getFieldValue(activeMod, field)}
                  onSet={v => {
                    if (activeMod.key === 'body' && field.key.startsWith('_')) return
                    setFieldValue(activeMod.key, field.key, v)
                  }}
                />
              ))}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── Sleep detail sheet ── */}
      {activeModule === 'sleep' && createPortal(
        <>
          <div className="mlm-overlay" onClick={() => setActiveModule(null)} />
          <div className="mlm-sheet mlm-sheet--compact">
            <div className="mlm-sheet-handle" />
            <div className="mlm-sheet-header">
              <span className="mlm-sheet-title">😴 Sleep</span>
              <span className="mlm-sheet-date">{fmtDate(today)}</span>
              <button className="mlm-sheet-close" onClick={() => setActiveModule(null)}>✕</button>
            </div>
            <div className="mlm-sheet-fields">
              {hasFitbitSleep ? (
                <>
                  <div className="mlm-info-row"><span>Asleep</span><strong>{fmtMins(sleepMin)}</strong></div>
                  <div className="mlm-info-row"><span>In bed</span><strong>{fmtMins(inBedMin)}</strong></div>
                  {sleepMin && inBedMin && (
                    <div className="mlm-info-row">
                      <span>Efficiency</span>
                      <strong>{Math.round(sleepMin / inBedMin * 100)}% — {sleepEffLabel(sleepMin, inBedMin)}</strong>
                    </div>
                  )}
                </>
              ) : hasOldSleep ? (
                <>
                  <div className="mlm-info-row"><span>Hours</span><strong>{oldSleep.hours}</strong></div>
                  {oldSleep.quality && <div className="mlm-info-row"><span>Quality</span><strong>{oldSleep.quality}</strong></div>}
                  {oldSleep.melatonin && <div className="mlm-info-row"><span>Melatonin</span><strong>Yes</strong></div>}
                </>
              ) : null}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── Steps detail sheet ── */}
      {activeModule === 'steps' && createPortal(
        <>
          <div className="mlm-overlay" onClick={() => setActiveModule(null)} />
          <div className="mlm-sheet mlm-sheet--compact">
            <div className="mlm-sheet-handle" />
            <div className="mlm-sheet-header">
              <span className="mlm-sheet-title">👟 Steps</span>
              <span className="mlm-sheet-date">{fmtDate(today)}</span>
              <button className="mlm-sheet-close" onClick={() => setActiveModule(null)}>✕</button>
            </div>
            <div className="mlm-sheet-fields">
              {steps != null && (
                <div className="mlm-info-row"><span>Steps</span><strong>{steps.toLocaleString()}</strong></div>
              )}
              {stepsActive != null && (
                <>
                  <div className="mlm-info-row">
                    <span>Total calories</span>
                    <strong>{Math.round(stepsActive + (stepsResting ?? 0))} kcal</strong>
                  </div>
                  <div className="mlm-info-row mlm-info-row--sub">
                    <span>Active {Math.round(stepsActive)}</span>
                    <span>Resting {Math.round(stepsResting ?? 0)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── Journal read-only sheet ── */}
      {activeModule === 'journal' && createPortal(
        <>
          <div className="mlm-overlay" onClick={() => setActiveModule(null)} />
          <div className="mlm-sheet">
            <div className="mlm-sheet-handle" />
            <div className="mlm-sheet-header">
              <span className="mlm-sheet-title">📝 Journal</span>
              <span className="mlm-sheet-date">{fmtDate(today)}</span>
              <button className="mlm-sheet-close" onClick={() => setActiveModule(null)}>✕</button>
            </div>
            <div className="mlm-journal-entries">
              {transcripts.map((t, i) => (
                <div key={i} className="mlm-journal-entry">
                  {transcripts.length > 1 && (
                    <div className="mlm-journal-time">
                      {new Date(t.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  <p className="mlm-journal-text">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
