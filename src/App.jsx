import { useState, useRef } from 'react'
import Timeline from './components/Timeline'
import Insights from './components/Insights'
import TodayPanel from './components/TodayPanel'
import { exportData, importData } from './utils/exportImport'
import { parseTranscript } from './utils/parseTranscript'
import { applyCheckin } from './utils/applyCheckin'
import { buildCheckinContext } from './utils/buildCheckinContext'
import './App.css'

const NUDGE_TEXT = {
  mood:            'Mood - not logged yet today, worth adding',
  sleep:           'Sleep - not mentioned yet today',
  career_updates:  'Career - any work updates worth logging?',
}

export default function App() {
  const importRef   = useRef(null)
  const todayRef    = useRef(null)
  const thisWeekRef = useRef(null)

  const [checkinStatus, setCheckinStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState(null)

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

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Life OS</h1>
        <div className="app-header-spacer" />
        <button className="app-toggle-btn" onClick={exportData}>Export backup</button>
        <button className="app-toggle-btn" onClick={() => importRef.current.click()}>Import backup</button>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
      </header>

      <main className="app-main">
        <div className="app-left">
          <TodayPanel
            ref={todayRef}
            checkinStatus={checkinStatus}
            errorMsg={errorMsg}
            onTranscript={handleTranscript}
          />
          <Insights ref={thisWeekRef} />
        </div>
        <Timeline />
      </main>
    </div>
  )
}
