import { useState, useRef } from 'react'
import './VoiceCheckin.css'

export default function VoiceCheckin({ onTranscript, disabled = false }) {
  const [status, setStatus] = useState('idle') // idle | listening | processing | done | error
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef(null)

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setStatus('error')
      return
    }

    const rec = new SpeechRecognition()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    recognitionRef.current = rec

    rec.onstart = () => setStatus('listening')

    rec.onresult = (e) => {
      let full = ''
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript
      }
      setTranscript(full)
    }

    rec.onend = () => {
      if (status !== 'idle') setStatus('done')
    }

    rec.onerror = () => setStatus('error')

    rec.start()
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setStatus('done')
  }

  function handleSend() {
    if (transcript.trim() && onTranscript) {
      onTranscript(transcript.trim())
    }
    setTranscript('')
    setStatus('idle')
  }

  function handleDiscard() {
    recognitionRef.current?.stop()
    setTranscript('')
    setStatus('idle')
  }

  if (status === 'error') {
    return (
      <div className="vc-root">
        <span className="vc-error">
          {window.SpeechRecognition || window.webkitSpeechRecognition
            ? 'Mic error - check browser permissions'
            : 'Speech recognition not supported in this browser'}
        </span>
        <button className="vc-btn-small" onClick={() => setStatus('idle')}>Dismiss</button>
      </div>
    )
  }

  return (
    <div className="vc-root">
      {status === 'idle' && (
        <button className="vc-mic-btn" onClick={startListening} title="Voice check-in" disabled={disabled}>
          🎙 Voice check-in
        </button>
      )}

      {status === 'listening' && (
        <div className="vc-listening">
          <span className="vc-dot" />
          <span className="vc-preview">{transcript || 'Listening…'}</span>
          <button className="vc-btn-small" onClick={stopListening}>Done</button>
        </div>
      )}

      {status === 'done' && (
        <div className="vc-review">
          <textarea
            className="vc-transcript"
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
          />
          <div className="vc-actions">
            <button className="vc-btn-primary" onClick={handleSend}>Log this</button>
            <button className="vc-btn-small" onClick={handleDiscard}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
