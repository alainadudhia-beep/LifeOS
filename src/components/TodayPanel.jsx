import { forwardRef } from 'react'
import VoiceCheckin from './VoiceCheckin'
import './TodayPanel.css'

function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

const TodayPanel = forwardRef(function TodayPanel({ checkinStatus, errorMsg, onTranscript }, ref) {
  return (
    <div className="today-panel">
      <div className="today-header">
        <span className="today-title">Today</span>
        <span className="today-date">{todayLabel()}</span>
      </div>

      <VoiceCheckin onTranscript={onTranscript} disabled={checkinStatus === 'parsing'} />

      {checkinStatus === 'parsing' && (
        <span className="today-status">Parsing your check-in…</span>
      )}
      {checkinStatus === 'error' && (
        <span className="today-status today-status--error">{errorMsg ?? 'Something went wrong - try again.'}</span>
      )}
    </div>
  )
})

export default TodayPanel
