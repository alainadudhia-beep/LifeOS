import { useState, useRef, useCallback, useEffect } from 'react'
import Timeline from './components/Timeline'
import LifeModules from './components/LifeModules'
import Insights from './components/Insights'
import TodayPanel from './components/TodayPanel'
import MobileTodayModules from './components/MobileTodayModules'
import VoiceCheckin from './components/VoiceCheckin'
import AuthGate from './components/AuthGate'
import { exportData, importData } from './utils/exportImport'
import { parseTranscript } from './utils/parseTranscript'
import { applyCheckin } from './utils/applyCheckin'
import { buildCheckinContext } from './utils/buildCheckinContext'
import './App.css'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

const NUDGE_TEXT = {
  mood:            'Mood - not logged yet today, worth adding',
  sleep:           'Sleep - not mentioned yet today',
  career_updates:  'Career - any work updates worth logging?',
}

export default function App() {
  const isMobile       = useIsMobile()
  const [mobileTab, setMobileTab] = useState('today')
  const lifeScrollRef  = useRef(null)
  const importRef      = useRef(null)
  const todayRef       = useRef(null)
  const thisWeekRef    = useRef(null)

  useEffect(() => {
    if (mobileTab !== 'life') return
    requestAnimationFrame(() => {
      if (lifeScrollRef.current)
        lifeScrollRef.current.scrollLeft = lifeScrollRef.current.scrollWidth
    })
  }, [mobileTab])

  const [checkinStatus, setCheckinStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState(null)

  const [leftWidth, setLeftWidth] = useState(() => {
    return parseInt(localStorage.getItem('lifetracker-left-width') ?? '340', 10)
  })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, width: 0 })

  const onResizerMouseDown = useCallback(e => {
    dragging.current = true
    dragStart.current = { x: e.clientX, width: leftWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [leftWidth])

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current) return
      const next = Math.max(240, Math.min(520, dragStart.current.width + e.clientX - dragStart.current.x))
      setLeftWidth(next)
    }
    function onMouseUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setLeftWidth(w => { localStorage.setItem('lifetracker-left-width', w); return w })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  async function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      await importData(file)
      window.location.reload()
    } catch (err) {
      alert(err.message)
    } finally {
      e.target.value = ''
    }
  }

  async function handleTranscript(text) {
    setCheckinStatus('parsing')
    setErrorMsg(null)
    try {
      const trackNames = (() => {
        try {
          const raw = JSON.parse(localStorage.getItem('lifetracker-tracks-v3'))
          const arr = Array.isArray(raw) ? raw : Object.values(raw ?? {})
          return arr.map(t => t.name).filter(Boolean)
        } catch { return [] }
      })()

      const recentContext = buildCheckinContext()
      const parsed = await parseTranscript(text, trackNames, recentContext)
      applyCheckin(parsed, text)

      const insightsToAdd = [...(parsed.insights ?? [])]

      if (parsed.daily_win) {
        insightsToAdd.push({ text: parsed.daily_win, positive: true, actionable: false })
      }

      const todayLog = (() => {
        try {
          const logs = JSON.parse(localStorage.getItem('lifetracker-life-logs')) ?? {}
          return logs[new Date().toISOString().slice(0, 10)] ?? {}
        } catch { return {} }
      })()
      for (const field of parsed.missing_important ?? []) {
        if (field === 'sleep'  && todayLog.sleep?.hours)  continue
        if (field === 'mood'   && Object.values(todayLog.mood ?? {}).some(v => v != null)) continue
        const nudgeText = NUDGE_TEXT[field] ?? `${field} - not logged yet today`
        insightsToAdd.push({ text: nudgeText, positive: false, actionable: true })
      }

      if (insightsToAdd.length) {
        thisWeekRef.current?.addInsights(insightsToAdd)
      }

      setCheckinStatus('done')
    } catch (err) {
      console.error('[VoiceCheckin] parse error:', err)
      setErrorMsg(err.message)
      setCheckinStatus('error')
    }
  }

  if (isMobile) {
    return (
      <AuthGate>
        <div className="app app--mobile">
          <header className="app-mobile-header">
            <div className="app-mobile-header-row">
              <h1 className="app-title">Life OS</h1>
              {checkinStatus === 'parsing' && <span className="app-mobile-status">Parsing…</span>}
              {checkinStatus === 'error'   && <span className="app-mobile-status app-mobile-status--error">{errorMsg ?? 'Error'}</span>}
            </div>
            <VoiceCheckin onTranscript={handleTranscript} disabled={checkinStatus === 'parsing'} />
          </header>

          <div className="app-mobile-content">
            {mobileTab === 'today' && (
              <div className="app-mobile-scroll">
                <MobileTodayModules />
                <Insights ref={thisWeekRef} />
              </div>
            )}
            {mobileTab === 'life' && (
              <div className="app-mobile-gantt-scroll" ref={lifeScrollRef}>
                <LifeModules mobile />
              </div>
            )}
            {mobileTab === 'work' && <Timeline mobile />}
          </div>

          <nav className="app-mobile-tabs">
            {[
              { key: 'today', label: 'Today',  icon: '✦' },
              { key: 'life',  label: 'Life',   icon: '🌿' },
              { key: 'work',  label: 'Work',   icon: '💼' },
            ].map(t => (
              <button
                key={t.key}
                className={`app-tab-btn ${mobileTab === t.key ? 'app-tab-btn--active' : ''}`}
                onClick={() => setMobileTab(t.key)}
              >
                <span className="app-tab-icon">{t.icon}</span>
                <span className="app-tab-label">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </AuthGate>
    )
  }

  return (
    <AuthGate>
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Life OS</h1>
        <div className="app-header-spacer" />
        <button className="app-toggle-btn" onClick={exportData}>Export backup</button>
        <button className="app-toggle-btn" onClick={() => importRef.current.click()}>Import backup</button>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
      </header>

      <main className="app-main">
        <div className="app-left" style={{ width: leftWidth, minWidth: leftWidth }}>
          <TodayPanel
            ref={todayRef}
            checkinStatus={checkinStatus}
            errorMsg={errorMsg}
            onTranscript={handleTranscript}
          />
          <Insights ref={thisWeekRef} />
        </div>
        <div className="app-resizer" onMouseDown={onResizerMouseDown} />
        <Timeline />
      </main>
    </div>
    </AuthGate>
  )
}
