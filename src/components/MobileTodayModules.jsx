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
const WATER_CYCLE = [1, 2, 3, 4, 5, 6, 7, '8+', null]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

function fmtSyncTime(isoStr) {
  if (!isoStr) return null
  return new Date(isoStr).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function MobileTodayModules() {
  const [logs, setLogs, refreshLogs] = useLocalStorage('lifetracker-life-logs', {})
  const [fitbitRaw]           = useLocalStorage('lifetracker-fitbit-raw', {})
  const [activeModule, setActiveModule] = useState(null)
  const [gratEdit, setGratEdit]         = useState(false)

  useEffect(() => {
    function onLogsUpdated() { refreshLogs() }
    window.addEventListener('lifetracker-logs-updated', onLogsUpdated)
    return () => window.removeEventListener('lifetracker-logs-updated', onLogsUpdated)
  }, []) // eslint-disable-line

  const today    = todayIso()
  const todayLog = logs[today] ?? {}
  const transcripts = todayLog.transcripts ?? []

  function setFieldValue(moduleKey, fieldKey, value) {
    setLogs(prev => {
      const updatedModule = { ...((prev[today] ?? {})[moduleKey] ?? {}), [fieldKey]: value }
      const updatedDay = { ...(prev[today] ?? {}), [moduleKey]: updatedModule }
      updatedDay.checkins = [
        { timestamp: new Date().toISOString(), source: 'manual', module: moduleKey, field: fieldKey, value },
        ...(updatedDay.checkins ?? []),
      ]
      return { ...prev, [today]: updatedDay }
    })
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

  function incrementWater() {
    const current = todayLog.water?.glasses
    const idx  = WATER_CYCLE.findIndex(v => String(v ?? '') === String(current ?? ''))
    const next = WATER_CYCLE[(idx < 0 ? 0 : idx + 1) % WATER_CYCLE.length]
    setFieldValue('water', 'glasses', next)
  }

  // ── Fitbit: sleep ─────────────────────────────────────────────────────────

  const fitbitToday  = fitbitRaw[today] ?? {}
  const oldSleep     = todayLog.sleep
  const sleepMin     = fitbitToday.sleep_minutes ?? oldSleep?._fitbit_minutes ?? null
  const inBedMin     = fitbitToday.in_bed_minutes ?? oldSleep?._in_bed_minutes ?? null
  const hasFitbitSleep = sleepMin != null && sleepMin <= 960
  const hasOldSleep    = !hasFitbitSleep && oldSleep?.hours != null
  const sleepBg    = hasFitbitSleep
    ? sleepColorFromFitbit(sleepMin, inBedMin)
    : hasOldSleep ? sleepColorFromOldData(oldSleep) : null
  const sleepLabel = hasFitbitSleep
    ? fmtMins(sleepMin)
    : hasOldSleep ? oldSleep.hours : null
  const sleepEff   = hasFitbitSleep ? sleepEffLabel(sleepMin, inBedMin) : null
  const hasSleepData = hasFitbitSleep || hasOldSleep

  // ── Fitbit: steps ─────────────────────────────────────────────────────────

  const steps        = fitbitToday.steps
  const stepsActive  = fitbitToday.active_energy_kcal
  const stepsResting = fitbitToday.resting_energy_kcal
  const stepsBg      = steps == null ? null
    : steps < 4000  ? '#fee2e2'
    : steps < 6000  ? '#fde8c8'
    : steps < 8000  ? '#fef9c3'
    : steps < 10000 ? '#dcfce7'
    : steps < 12000 ? '#bbf7d0'
    : '#86efac'
  const stepsLabel   = steps != null ? (steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : String(steps)) : null
  const hasStepsData = steps != null || stepsActive != null

  // ── Fitbit: calories ──────────────────────────────────────────────────────

  const calsTotal = (stepsActive != null || stepsResting != null)
    ? Math.round((stepsActive ?? 0) + (stepsResting ?? 0))
    : null
  const calsLabel = calsTotal != null ? `${calsTotal.toLocaleString()}` : null
  const calsBg    = stepsActive == null ? null
    : stepsActive < 200 ? '#fef9c3'
    : stepsActive < 400 ? '#bbf7d0'
    : '#86efac'

  // ── Fitbit: screen time ───────────────────────────────────────────────────

  const screenMins = fitbitToday.screen_time_minutes ?? null
  const screenBg   = screenMins == null ? null
    : screenMins < 120 ? '#86efac'
    : screenMins < 180 ? '#bbf7d0'
    : screenMins < 240 ? '#fef9c3'
    : screenMins < 300 ? '#fde8c8'
    : '#fee2e2'
  const screenLabel = screenMins != null ? fmtMins(screenMins) : null

  const syncTime = fmtSyncTime(fitbitToday.synced_at)

  // ── Body ──────────────────────────────────────────────────────────────────

  const bodyData = todayLog.body ?? {}
  const period   = bodyData.period ?? !!todayLog.period
  const illness  = bodyData.illness
  const { kg, kgStaleM } = (() => {
    const d = new Date(today)
    for (let i = 0; i < 90; i++) {
      const w = fitbitRaw[d.toISOString().slice(0, 10)]?.weight_kg
      if (w != null) return { kg: w, kgStaleM: i > 0 }
      d.setDate(d.getDate() - 1)
    }
    return { kg: null, kgStaleM: false }
  })()
  const yBodyM     = (() => { const d = new Date(today); d.setDate(d.getDate() - 1); return logs[d.toISOString().slice(0, 10)]?.body ?? {} })()
  const pillFwd    = bodyData.pill   != null ? bodyData.pill   : yBodyM.pill   ?? null
  const periodFwdM = bodyData.period != null ? bodyData.period : yBodyM.period ?? null
  const bodyBg     = illness && illness !== 'None' ? '#fee2e2' : period ? '#fce7f3' : kg != null ? '#f1f5f9' : null
  const bodyLabel  = period ? 'Period' : illness && illness !== 'None' ? illness : null

  // ── Exercise ──────────────────────────────────────────────────────────────

  const exData     = todayLog.exercise ?? null
  const energy     = exData?.energy ?? todayLog.mood?.energy ?? null
  const exerciseBg = energy != null ? (H5[energy] ?? null) : null
  const exActs     = exData?.activities
  const exLabel    = exActs?.length ? exActs.slice(0, 1).join('') : null

  // ── Module refs ───────────────────────────────────────────────────────────

  const moodMod    = MODULES.find(m => m.key === 'mood')
  const healthMod  = MODULES.find(m => m.key === 'health')
  const waterMod   = MODULES.find(m => m.key === 'water')
  const alcoholMod = MODULES.find(m => m.key === 'alcohol')
  const dietMod    = MODULES.find(m => m.key === 'diet')
  const socialMod  = MODULES.find(m => m.key === 'social')

  // Compact cell labels for manual cards (value only, no name)
  function compactLabel(mod, dayData) {
    const raw = mod.cellLabel(dayData)
    const label = Array.isArray(raw) ? raw.slice(0, 1).join('') : raw
    return label ?? null
  }

  const moodBg          = moodMod.cellColor(todayLog.mood ?? null)
  const moodLabel       = compactLabel(moodMod, todayLog.mood ?? null)
  const moodIncomplete  = COMPLETE_CHECK.mood && !COMPLETE_CHECK.mood(todayLog.mood ?? null)

  const healthBg        = healthMod.cellColor(todayLog.health ?? null)
  const healthLabel     = compactLabel(healthMod, todayLog.health ?? null)
  const healthIncomplete = COMPLETE_CHECK.health && !COMPLETE_CHECK.health(todayLog.health ?? null)

  const waterBg         = waterMod.cellColor(todayLog.water ?? null)
  const waterLabel      = todayLog.water?.glasses != null ? String(todayLog.water.glasses) : null
  const waterIncomplete = COMPLETE_CHECK.water && !COMPLETE_CHECK.water(todayLog.water ?? null)

  const alcoholBg         = alcoholMod.cellColor(todayLog.alcohol ?? null)
  const alcoholLabel      = compactLabel(alcoholMod, todayLog.alcohol ?? null)
  const alcoholIncomplete = COMPLETE_CHECK.alcohol && !COMPLETE_CHECK.alcohol(todayLog.alcohol ?? null)

  const dietBg          = dietMod.cellColor(todayLog.diet ?? null)
  const dietLabel       = compactLabel(dietMod, todayLog.diet ?? null)
  const dietIncomplete  = COMPLETE_CHECK.diet && !COMPLETE_CHECK.diet(todayLog.diet ?? null)

  const exIncomplete    = COMPLETE_CHECK.exercise && !COMPLETE_CHECK.exercise(todayLog.exercise ?? null)
  const bodyIncomplete  = COMPLETE_CHECK.body && !COMPLETE_CHECK.body(todayLog.body ?? null)

  const socialBg        = socialMod.cellColor(todayLog.social ?? null)
  const socialLabel     = compactLabel(socialMod, todayLog.social ?? null)
  const socialIncomplete = COMPLETE_CHECK.social && !COMPLETE_CHECK.social(todayLog.social ?? null)

  // Which sheet to show
  const activeMod = activeModule && !['sleep', 'steps', 'journal'].includes(activeModule)
    ? [...MODULES, EXERCISE_MODULE, BODY_MODULE].find(m => m.key === activeModule)
    : null

  function getFieldValue(mod, field) {
    if (mod.key === 'body') {
      const full = { ...bodyData, pill: pillFwd, period: periodFwdM, _weight_kg: kg != null ? (kg % 1 === 0 ? String(kg) : kg.toFixed(1)) : null, _weight_kg_stale: kgStaleM }
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

      {/* ── 2×6 grid: autosync (cols 1-2) + manual (cols 3-6) ── */}
      <div className="mlm-grid">

        {/* Row 1 col 1: Sleep */}
        <button
          className={`mlm-card mlm-card--sync ${activeModule === 'sleep' ? 'mlm-card--active' : ''}`}
          style={sleepBg ? { background: sleepBg } : undefined}
          onClick={() => hasSleepData && setActiveModule('sleep')}
        >
          <span className="mlm-card-emoji">😴</span>
          {sleepLabel && <span className="mlm-card-value">{sleepLabel}</span>}
          {sleepEff   && <span className="mlm-card-sub">{sleepEff}</span>}
        </button>

        {/* Row 1 col 2: Steps */}
        <button
          className={`mlm-card mlm-card--sync ${activeModule === 'steps' ? 'mlm-card--active' : ''}`}
          style={stepsBg ? { background: stepsBg } : undefined}
          onClick={() => hasStepsData && setActiveModule('steps')}
        >
          <span className="mlm-card-emoji">👟</span>
          {stepsLabel && <span className="mlm-card-value">{stepsLabel}</span>}
        </button>

        {/* Row 1 col 3: Mood */}
        <button
          className={`mlm-card ${moodIncomplete ? 'mlm-card--incomplete' : ''} ${activeModule === 'mood' ? 'mlm-card--active' : ''}`}
          style={moodBg ? { background: moodBg } : undefined}
          onClick={() => openModule('mood')}
        >
          <span className="mlm-card-emoji">🧠</span>
          {moodLabel && <span className="mlm-card-value">{moodLabel}</span>}
        </button>

        {/* Row 1 col 4: Inflammation */}
        <button
          className={`mlm-card ${healthIncomplete ? 'mlm-card--incomplete' : ''} ${activeModule === 'health' ? 'mlm-card--active' : ''}`}
          style={healthBg ? { background: healthBg } : undefined}
          onClick={() => openModule('health')}
        >
          <span className="mlm-card-emoji">💊</span>
          {healthLabel && <span className="mlm-card-value">{healthLabel}</span>}
        </button>

        {/* Row 1 col 5: Water */}
        <button
          className={`mlm-card ${waterIncomplete ? 'mlm-card--incomplete' : ''}`}
          style={waterBg ? { background: waterBg } : undefined}
          onClick={incrementWater}
        >
          <span className="mlm-card-emoji">💧</span>
          {waterLabel && <span className="mlm-card-value">{waterLabel}</span>}
        </button>

        {/* Row 1 col 6: Alcohol */}
        <button
          className={`mlm-card ${alcoholIncomplete ? 'mlm-card--incomplete' : ''} ${activeModule === 'alcohol' ? 'mlm-card--active' : ''}`}
          style={alcoholBg ? { background: alcoholBg } : undefined}
          onClick={() => openModule('alcohol')}
        >
          <span className="mlm-card-emoji">🍷</span>
          {alcoholLabel && <span className="mlm-card-value">{alcoholLabel}</span>}
        </button>

        {/* Row 2 col 1: Calories */}
        <button
          className={`mlm-card mlm-card--sync`}
          style={calsBg ? { background: calsBg } : undefined}
          onClick={() => hasStepsData && setActiveModule('steps')}
          disabled={calsTotal == null}
        >
          <span className="mlm-card-emoji">🔥</span>
          {calsLabel && <span className="mlm-card-value">{calsLabel}</span>}
        </button>

        {/* Row 2 col 2: Screen Time */}
        <button
          className="mlm-card mlm-card--sync"
          style={screenBg ? { background: screenBg } : undefined}
          disabled
        >
          <span className="mlm-card-emoji">📱</span>
          {screenLabel && <span className="mlm-card-value">{screenLabel}</span>}
        </button>

        {/* Row 2 col 3: Diet */}
        <button
          className={`mlm-card ${dietIncomplete ? 'mlm-card--incomplete' : ''} ${activeModule === 'diet' ? 'mlm-card--active' : ''}`}
          style={dietBg ? { background: dietBg } : undefined}
          onClick={() => openModule('diet')}
        >
          <span className="mlm-card-emoji">🥗</span>
          {dietLabel && <span className="mlm-card-value">{dietLabel}</span>}
        </button>

        {/* Row 2 col 4: Exercise */}
        <button
          className={`mlm-card ${exIncomplete ? 'mlm-card--incomplete' : ''} ${activeModule === 'exercise' ? 'mlm-card--active' : ''}`}
          style={exerciseBg ? { background: exerciseBg } : undefined}
          onClick={() => openModule('exercise')}
        >
          <span className="mlm-card-emoji">🏃</span>
          {exLabel && <span className="mlm-card-value">{exLabel}</span>}
        </button>

        {/* Row 2 col 5: Body */}
        <button
          className={`mlm-card ${bodyIncomplete ? 'mlm-card--incomplete' : ''} ${activeModule === 'body' ? 'mlm-card--active' : ''}`}
          style={bodyBg ? { background: bodyBg } : undefined}
          onClick={() => openModule('body')}
        >
          <span className="mlm-card-emoji">🌸</span>
          {bodyLabel && <span className="mlm-card-value">{bodyLabel}</span>}
        </button>

        {/* Row 2 col 6: Social */}
        <button
          className={`mlm-card ${socialIncomplete ? 'mlm-card--incomplete' : ''} ${activeModule === 'social' ? 'mlm-card--active' : ''}`}
          style={socialBg ? { background: socialBg } : undefined}
          onClick={() => openModule('social')}
        >
          <span className="mlm-card-emoji">👥</span>
          {socialLabel && <span className="mlm-card-value">{socialLabel}</span>}
        </button>

      </div>

      {/* Footer: sync time + journal */}
      <div className="mlm-footer">
        {syncTime
          ? <span className="mlm-sync-time">Synced {syncTime}</span>
          : <span />
        }
        {transcripts.length > 0 && (
          <button className="mlm-journal-link" onClick={() => setActiveModule('journal')}>
            📝 Journal
          </button>
        )}
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
                {activeMod.key === 'body' ? '🌸'
                  : activeMod.key === 'exercise' ? '🏃'
                  : activeMod.key === 'health' ? '💊'
                  : MODULE_EMOJI[activeMod.key] ?? ''
                } {activeMod.label}
              </span>
              <span className="mlm-sheet-date">{fmtDate(today)}</span>
              <button className="mlm-sheet-close" onClick={() => setActiveModule(null)}>✕</button>
            </div>
            <div className="mlm-sheet-fields">
              {activeMod.fields.map(field => {
                const fullData = activeMod.key === 'body'
                  ? { ...bodyData, pill: pillFwd, period: periodFwdM, _weight_kg: kg != null ? (kg % 1 === 0 ? String(kg) : kg.toFixed(1)) : null, _weight_kg_stale: kgStaleM }
                  : null
                return (
                  <PopoverField
                    key={field.key}
                    field={field}
                    value={getFieldValue(activeMod, field)}
                    stale={fullData?.[`_${field.key}_stale`] ?? false}
                    onSet={v => {
                      if (activeMod.key === 'body' && field.key.startsWith('_')) return
                      setFieldValue(activeMod.key, field.key, v)
                    }}
                  />
                )
              })}
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
