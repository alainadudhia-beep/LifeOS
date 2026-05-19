import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import {
  MODULES, MODULE_EMOJI, COMPLETE_CHECK, PopoverField,
  EXERCISE_MODULE, BODY_MODULE, bodyRating,
  sleepColorFromFitbit, sleepColorFromOldData, sleepEffLabel, fmtMins,
} from './LifeModules'
import './LifeModules.css'
import './MobileTodayModules.css'

const H5 = { 1: '#fee2e2', 2: '#fde8c8', 3: '#fef9c3', 4: '#dcfce7', 5: '#86efac' }
const WATER_CYCLE = ['1', '2', '3', '4', '5', '6', '7', '8+', null]

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
  const [weatherStore]        = useLocalStorage('lifetracker-weather', {})
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
  const calsBg = (() => {
    if (calsTotal == null) return null
    const h = new Date().getHours() + new Date().getMinutes() / 60
    const projected = h > 0 ? calsTotal / h * 24 : calsTotal
    return projected < 1750 ? '#fee2e2'
      : projected < 2000 ? '#fde8c8'
      : projected < 2250 ? '#fef9c3'
      : projected < 2500 ? '#bbf7d0'
      : '#86efac'
  })()

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

  const rawBodyM   = todayLog.body   ?? {}
  const rawHealthM = todayLog.health ?? {}
  // Read-time fallback for pre-migration data
  const bodyData   = {
    ...rawBodyM,
    wrist_nerve_pain: rawBodyM.wrist_nerve_pain ?? rawHealthM.wrist_nerve_pain ?? undefined,
    gut:              rawBodyM.gut              ?? rawHealthM.gut              ?? undefined,
  }
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
  const bodyR      = bodyRating(bodyData)
  const bodyBg     = bodyR != null ? bodyR.bg : null
  const bodyLabel  = period ? 'Period' : illness && illness !== 'None' ? illness : bodyR?.label ?? null

  // ── Exercise ──────────────────────────────────────────────────────────────

  const exData     = todayLog.exercise ?? null
  const energy     = exData?.energy ?? todayLog.mood?.energy ?? null
  const exerciseBg = energy != null ? (H5[energy] ?? null) : null
  const exActs  = exData?.activities
  const exLabel = exActs?.length
    ? exActs.length === 1 ? exActs[0] : `${exActs[0]} +${exActs.length - 1}`
    : energy != null ? String(energy) : null

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
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null
      if (raw.length === 1) return raw[0]
      return `${raw[0]} +${raw.length - 1}`
    }
    return raw ?? null
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

  // ── Weather banner ────────────────────────────────────────────────────────

  const todayWeather = weatherStore[today] ?? null

  // Weather banner helpers — severity → dot colour
  const W_DOT = { good: '#4ade80', med: '#fbbf24', bad: '#f87171' }
  function dot(sev) {
    return (
      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: W_DOT[sev], marginLeft: 2, verticalAlign: 'middle', flexShrink: 0 }} />
    )
  }
  function pollenSev(w) {
    const RANK = { 'Low': 1, 'Medium': 2, 'High': 3, 'Very High': 4 }
    const worst = Math.max(RANK[w?.grass_pollen_label] ?? 0, RANK[w?.birch_pollen_label] ?? 0)
    if (worst <= 1) return 'good'
    if (worst === 2) return 'med'
    return 'bad'
  }
  function windSev(kmh) {
    if (kmh == null) return null
    if (kmh < 15) return 'good'
    if (kmh < 35) return 'med'
    return 'bad'
  }
  function rainSev(mm) {
    if (mm == null || mm < 5) return 'good'
    if (mm < 15) return 'med'
    return 'bad'
  }
  function humiditySev(pct) {
    if (pct == null) return null
    if (pct >= 40 && pct <= 70) return 'good'
    return 'med'
  }
  function uvSev(uv) {
    if (uv == null) return null
    if (uv < 3) return 'good'
    if (uv < 6) return 'med'
    return 'bad'
  }
  function aqiSev(label) {
    if (!label) return null
    if (label === 'Good' || label === 'Fair') return 'good'
    if (label === 'Moderate') return 'med'
    return 'bad'
  }

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

      {/* ── Weather banner ── */}
      {todayWeather && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 14px', background: '#f0f9ff', fontSize: 16 }}>
          <span>🌿{dot(pollenSev(todayWeather))}</span>
          <span>💨{dot(windSev(todayWeather.wind_speed_max))}</span>
          <span>🌧{dot(rainSev(todayWeather.precipitation_mm))}</span>
          {todayWeather.humidity_pct != null && <span>💦{dot(humiditySev(todayWeather.humidity_pct))}</span>}
          {todayWeather.uv_index != null    && <span>☀️{dot(uvSev(todayWeather.uv_index))}</span>}
          {todayWeather.aqi_label           && <span>🌫️{dot(aqiSev(todayWeather.aqi_label))}</span>}
        </div>
      )}

      {/* ── 2×6 grid: autosync (cols 1-2) + manual (cols 3-6) ── */}
      <div className="mlm-grid">

        {/* Row 1 col 1: Sleep */}
        <button
          className="mlm-card mlm-card--sync"
          style={sleepBg ? { background: sleepBg } : undefined}
          disabled
        >
          <span className="mlm-card-emoji">😴</span>
          {sleepLabel && <span className="mlm-card-value">{sleepLabel}</span>}
        </button>

        {/* Row 1 col 2: Steps */}
        <button
          className="mlm-card mlm-card--sync"
          style={stepsBg ? { background: stepsBg } : undefined}
          disabled
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
          className="mlm-card mlm-card--sync"
          style={calsBg ? { background: calsBg } : undefined}
          disabled
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
