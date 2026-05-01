import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { STATUSES, DAY_WIDTH, TIMELINE_END } from '../data/initialData'
import { dateToPx, TIMELINE_WIDTH, formatTimestamp, pxToDate, currentStatus } from '../utils/timeline'
import './CareerTrackRow.css'

// ── Status dropdown (portal) ──────────────────────────────────────────────────
function StatusDropdown({ anchorEl, onSelect, activeStatus, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    function handle(e) {
      if (!ref.current?.contains(e.target) && !anchorEl?.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [anchorEl, onClose])
  if (!anchorEl) return null
  const rect = anchorEl.getBoundingClientRect()
  return createPortal(
    <div ref={ref} className="status-dropdown" style={{ top: rect.bottom + 4, left: rect.left }}>
      {Object.entries(STATUSES).map(([key, sv]) => (
        <button
          key={key}
          className={`status-dropdown-item ${activeStatus === key ? 'active' : ''}`}
          onMouseDown={e => { e.preventDefault(); onSelect(key) }}
        >
          <span className="sd-dot" style={{ background: sv.bar }} />
          {sv.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

// ── Quick note popover (portal) ───────────────────────────────────────────────
function NotePopover({ anchorEl, onClose, onSubmit }) {
  const ref  = useRef(null)
  const [text, setText] = useState('')
  useEffect(() => {
    ref.current?.querySelector('textarea')?.focus()
    function handle(e) {
      if (!ref.current?.contains(e.target) && !anchorEl?.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [anchorEl, onClose])
  if (!anchorEl) return null
  const rect = anchorEl.getBoundingClientRect()
  const left = Math.min(rect.left, window.innerWidth - 260)
  function submit() { if (text.trim()) onSubmit(text.trim()); onClose() }
  return createPortal(
    <div ref={ref} className="tr-note-portal" style={{ top: rect.bottom + 6, left }}>
      <textarea
        className="tr-note-input"
        placeholder="Add today's note… (Enter to save)"
        value={text}
        rows={3}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          if (e.key === 'Escape') onClose()
        }}
      />
    </div>,
    document.body
  )
}

// ── Milestone tooltip + edit (portal) ────────────────────────────────────────
function MilestonePopover({ milestone, anchorEl, onClose, onSave }) {
  const ref  = useRef(null)
  const [editing, setEditing] = useState(false)
  const [text,    setText]    = useState(milestone.label)

  useEffect(() => {
    function handle(e) {
      if (!ref.current?.contains(e.target) && !anchorEl?.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [anchorEl, onClose])

  if (!anchorEl) return null
  const rect = anchorEl.getBoundingClientRect()
  const left = Math.min(rect.left, window.innerWidth - 220)

  return createPortal(
    <div ref={ref} className="milestone-popover" style={{ top: rect.bottom + 6, left }}>
      <div className="mp-date">{milestone.date}</div>
      {editing ? (
        <input
          className="mp-input"
          value={text}
          autoFocus
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onSave(milestone.id, text); onClose() }
            if (e.key === 'Escape') { setEditing(false); setText(milestone.label) }
          }}
          onBlur={() => { onSave(milestone.id, text); onClose() }}
        />
      ) : (
        <div className="mp-label" onClick={() => setEditing(true)}>{milestone.label}</div>
      )}
      {!editing && <button className="mp-edit" onClick={() => setEditing(true)}>Edit</button>}
    </div>,
    document.body
  )
}

// ── Main row ─────────────────────────────────────────────────────────────────
export default function CareerTrackRow({ track, onClick, onStatusChange, onAddNote, onAddMilestone, onEditMilestone }) {
  const [statusOpen,       setStatusOpen]       = useState(false)
  const [noteOpen,         setNoteOpen]         = useState(false)
  const [noteHover,        setNoteHover]        = useState(false)
  const [pendingMilestone, setPendingMilestone] = useState(null)
  const [activeMilestone,  setActiveMilestone]  = useState(null)
  const pipRef        = useRef(null)
  const noteAnchorRef = useRef(null)
  const nameRef       = useRef(null)
  const labelInputRef = useRef(null)
  const milestoneRefs = useRef({})

  const curStatus  = currentStatus(track)
  const s          = STATUSES[curStatus] || STATUSES.in_progress
  const milestones = track.milestones || []
  const latestNote = track.notes_log?.[0]

  const history     = track.status_history || []
  const hasTrackEnd = !!track.end_date
  const horizonIso  = hasTrackEnd ? track.end_date : TIMELINE_END.toISOString().slice(0, 10)

  useEffect(() => { if (pendingMilestone) labelInputRef.current?.focus() }, [pendingMilestone])

  function handleGridClick(e) {
    if (e.target.closest('.milestone-hit')) return
    const rect    = e.currentTarget.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const dayIdx  = Math.floor(offsetX / DAY_WIDTH)
    const snapped = dayIdx * DAY_WIDTH + DAY_WIDTH / 2
    const date    = pxToDate(dayIdx * DAY_WIDTH)
    setPendingMilestone({ date, x: snapped })
  }

  function submitMilestone(label) {
    if (label.trim()) onAddMilestone(track.id, pendingMilestone.date, label.trim())
    setPendingMilestone(null)
  }

  const updatedStr = latestNote
    ? new Date(latestNote.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className={`track-row ${track.archived ? 'track-row--archived' : ''}`}>
      {/* ── sticky label ── */}
      <div className="tr-label">
        <div className="tr-status-wrap">
          <button
            ref={pipRef}
            className="tr-status-pip"
            style={{ background: s.bar }}
            onClick={e => { e.stopPropagation(); setStatusOpen(v => !v) }}
            title="Change status"
          />
          {statusOpen && (
            <StatusDropdown
              anchorEl={pipRef.current}
              activeStatus={curStatus}
              onSelect={key => { onStatusChange(track.id, key); setStatusOpen(false) }}
              onClose={() => setStatusOpen(false)}
            />
          )}
        </div>

        <div className="tr-label-text">
          <span
            className="tr-name"
            ref={nameRef}
            onClick={onClick}
            onMouseEnter={() => latestNote && setNoteHover(true)}
            onMouseLeave={() => setNoteHover(false)}
          >
            {track.name}
            {track.priority && (
              <span className={`tr-priority tr-priority--${track.priority}`}>
                {track.priority[0].toUpperCase()}
              </span>
            )}
          </span>
          <span
            ref={noteAnchorRef}
            className={`tr-updated ${latestNote ? 'tr-updated--has-note' : ''}`}
            onClick={e => { e.stopPropagation(); setNoteOpen(v => !v) }}
          >
            {updatedStr ? `Updated ${updatedStr}` : 'Add note'}
          </span>
        </div>
      </div>

      {/* ── timeline bar + milestones ── */}
      <div className="tr-grid" style={{ width: TIMELINE_WIDTH }} onClick={handleGridClick}>
        {history.map((seg, i) => {
          const sv      = STATUSES[seg.status] || STATUSES.in_progress
          const isFirst = i === 0
          const isLast  = i === history.length - 1
          const segEnd  = seg.end_date || (isLast ? horizonIso : null)
          if (!segEnd) return null
          const segLeft  = dateToPx(seg.start_date)
          const segRight = dateToPx(segEnd)
          const segW     = Math.max(segRight - segLeft, 0)
          if (segW === 0) return null
          const dotted  = isLast && !seg.end_date && !hasTrackEnd
          const rLeft   = isFirst ? '6px' : '0'
          const rRight  = isLast ? '6px' : '0'
          return (
            <div key={seg.id} className={`tr-bar-segment ${dotted ? 'tr-bar-segment--open' : ''}`} style={{
              left: segLeft,
              width: segW,
              background: sv.bg,
              borderColor: sv.bar,
              borderRadius: `${rLeft} ${rRight} ${rRight} ${rLeft}`,
            }} />
          )
        })}

        {milestones.map(m => {
          const cx = dateToPx(m.date) + DAY_WIDTH / 2
          return (
            <div
              key={m.id}
              ref={el => milestoneRefs.current[m.id] = el}
              className="milestone-hit"
              style={{ left: cx }}
              onClick={e => {
                e.stopPropagation()
                setActiveMilestone(
                  activeMilestone?.milestone.id === m.id ? null : { milestone: m, el: milestoneRefs.current[m.id] }
                )
              }}
            >
              <div className="milestone-diamond" />
            </div>
          )
        })}

        {pendingMilestone && (
          <div
            className="milestone-hit milestone-hit--pending"
            style={{ left: pendingMilestone.x }}
            onClick={e => e.stopPropagation()}
          >
            <div className="milestone-diamond milestone-diamond--pending" />
            <input
              ref={labelInputRef}
              className="milestone-input"
              placeholder="Label…"
              onKeyDown={e => {
                if (e.key === 'Enter')  submitMilestone(e.target.value)
                if (e.key === 'Escape') setPendingMilestone(null)
              }}
              onBlur={e => submitMilestone(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* note hover tooltip (portal) */}
      {noteHover && latestNote && nameRef.current && createPortal(
        <div className="tr-name-tooltip" style={{
          top:  nameRef.current.getBoundingClientRect().bottom + 6,
          left: nameRef.current.getBoundingClientRect().left,
        }}>
          {latestNote.text}
        </div>,
        document.body
      )}

      {/* quick note portal */}
      {noteOpen && (
        <NotePopover
          anchorEl={noteAnchorRef.current}
          onClose={() => setNoteOpen(false)}
          onSubmit={text => onAddNote(track.id, text)}
        />
      )}

      {/* milestone popover */}
      {activeMilestone && (
        <MilestonePopover
          milestone={activeMilestone.milestone}
          anchorEl={activeMilestone.el}
          onClose={() => setActiveMilestone(null)}
          onSave={(id, label) => onEditMilestone(track.id, id, label)}
        />
      )}
    </div>
  )
}
