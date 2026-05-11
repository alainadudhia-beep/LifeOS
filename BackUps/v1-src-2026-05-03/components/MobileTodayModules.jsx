import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import { MODULES, MODULE_EMOJI, COMPLETE_CHECK, PopoverField } from './LifeModules'
import './LifeModules.css'
import './MobileTodayModules.css'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function MobileTodayModules() {
  const [logs, setLogs] = useLocalStorage('lifetracker-life-logs', {})
  const [activeModule, setActiveModule] = useState(null) // module key or 'journal'
  const [gratEdit, setGratEdit] = useState(false)

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

  const today = todayIso()
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

  function togglePeriod() {
    setLogs(prev => {
      const day = prev[today] ?? {}
      return { ...prev, [today]: { ...day, period: !day.period } }
    })
  }

  function openModule(key) {
    const mod = MODULES.find(m => m.key === key)
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

  const activeMod = activeModule && activeModule !== 'journal'
    ? MODULES.find(m => m.key === activeModule)
    : null

  return (
    <div className="mlm-panel">
      <div className="mlm-section-label">Today's log</div>

      <div className="mlm-grid">
        {MODULES.map(mod => {
          const dayData  = todayLog[mod.key] ?? null
          const bg       = mod.cellColor(dayData)
          const rawLabel = mod.cellLabel(dayData)
          const label    = Array.isArray(rawLabel) ? rawLabel.join(' · ') : rawLabel
          const incomplete = COMPLETE_CHECK[mod.key] && !COMPLETE_CHECK[mod.key](dayData)

          return (
            <button
              key={mod.key}
              className={`mlm-card ${incomplete ? 'mlm-card--incomplete' : ''} ${activeModule === mod.key ? 'mlm-card--active' : ''}`}
              style={bg ? { background: bg } : undefined}
              onClick={() => openModule(mod.key)}
            >
              <span className="mlm-card-emoji">{MODULE_EMOJI[mod.key]}</span>
              <span className="mlm-card-name">{mod.label}</span>
              {label != null && <span className="mlm-card-value">{label}</span>}
            </button>
          )
        })}

        {/* Cycle */}
        <button
          className={`mlm-card ${todayLog.period ? 'mlm-card--period' : ''}`}
          onClick={togglePeriod}
        >
          <span className="mlm-card-emoji">🌸</span>
          <span className="mlm-card-name">Cycle</span>
          {todayLog.period && <span className="mlm-card-value">Period</span>}
        </button>

        {/* Journal */}
        <button
          className={`mlm-card ${transcripts.length ? 'mlm-card--has-journal' : ''} ${activeModule === 'journal' ? 'mlm-card--active' : ''}`}
          onClick={() => transcripts.length && setActiveModule('journal')}
        >
          <span className="mlm-card-emoji">📝</span>
          <span className="mlm-card-name">Journal</span>
          {transcripts.length > 0 && (
            <span className="mlm-card-value">{transcripts.length} {transcripts.length === 1 ? 'entry' : 'entries'}</span>
          )}
        </button>
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

      {/* Module edit bottom sheet */}
      {activeMod && createPortal(
        <>
          <div className="mlm-overlay" onClick={() => setActiveModule(null)} />
          <div className="mlm-sheet">
            <div className="mlm-sheet-handle" />
            <div className="mlm-sheet-header">
              <span className="mlm-sheet-title">
                {MODULE_EMOJI[activeMod.key]} {activeMod.label}
              </span>
              <span className="mlm-sheet-date">{fmtDate(today)}</span>
              <button className="mlm-sheet-close" onClick={() => setActiveModule(null)}>✕</button>
            </div>
            <div className="mlm-sheet-fields">
              {activeMod.fields.map(field => (
                <PopoverField
                  key={field.key}
                  field={field}
                  value={(todayLog[activeMod.key] ?? {})[field.key] ?? null}
                  onSet={v => setFieldValue(activeMod.key, field.key, v)}
                />
              ))}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Journal read-only bottom sheet */}
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
