import { useState } from 'react'
import { STATUSES } from '../data/initialData'
import { formatTimestamp } from '../utils/timeline'
import './TrackEditModal.css'

export default function TrackEditModal({ track, onSave, onDelete, onArchive, onClose, existingGroups = [] }) {
  const [name, setName]           = useState(track.name)
  const [priority, setPriority]   = useState(track.priority || null)
  const [group, setGroup]         = useState(track.group || '')
  const [startDate, setStartDate] = useState(track.start_date)
  const [endDate, setEndDate]     = useState(track.end_date)
  const [newNote, setNewNote]     = useState('')
  const [notesLog, setNotesLog]   = useState(track.notes_log || [])
  const [history, setHistory]     = useState(track.status_history || [])
  const [milestones, setMilestones] = useState(track.milestones || [])
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  function updateSeg(id, field, value) {
    setHistory(h => h.map(s => s.id === id ? { ...s, [field]: value || null } : s))
  }

  function deleteSeg(id) {
    setHistory(h => h.filter(s => s.id !== id))
  }

  function addSeg() {
    const last = history[history.length - 1]
    const today = new Date().toISOString().slice(0, 10)
    setHistory(h => [
      ...h.map((s, i) => i === h.length - 1 && s.end_date === null ? { ...s, end_date: today } : s),
      { id: `sh-${Date.now()}`, status: 'in_progress', start_date: today, end_date: null }
    ])
  }

  function addNote() {
    if (!newNote.trim()) return
    const todayPrefix = new Date().toISOString().slice(0, 10)
    const todayIdx = notesLog.findIndex(n => n.timestamp.startsWith(todayPrefix))
    if (todayIdx !== -1) {
      setNotesLog(prev => prev.map((n, i) =>
        i === todayIdx ? { ...n, text: newNote.trim(), timestamp: new Date().toISOString() } : n
      ))
    } else {
      setNotesLog(prev => [{ id: `n-${Date.now()}`, text: newNote.trim(), timestamp: new Date().toISOString() }, ...prev])
    }
    setNewNote('')
  }

  function startEditNote(n) {
    setEditingNoteId(n.id)
    setEditingNoteText(n.text)
  }

  function saveEditNote(id) {
    if (editingNoteText.trim()) {
      setNotesLog(prev => prev.map(n => n.id === id ? { ...n, text: editingNoteText.trim() } : n))
    }
    setEditingNoteId(null)
  }

  function deleteNote(id) {
    setNotesLog(prev => prev.filter(n => n.id !== id))
    if (editingNoteId === id) setEditingNoteId(null)
  }

  function updateMilestone(id, field, value) {
    setMilestones(ms => ms.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  function deleteMilestone(id) {
    setMilestones(ms => ms.filter(m => m.id !== id))
  }

  function handleSave() {
    if (!name.trim()) return
    onSave({ ...track, name: name.trim(), priority, group: group.trim() || null, start_date: startDate, end_date: endDate, notes_log: notesLog, status_history: history, milestones })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Edit track</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-section">
          <label className="modal-label">Name</label>
          <input className="modal-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>

        <div className="modal-section">
          <label className="modal-label">Priority</label>
          <div className="priority-options">
            {[['high','High'],['medium','Medium'],['low','Low']].map(([val, label]) => (
              <button
                key={val}
                className={`priority-option priority-${val} ${priority === val ? 'active' : ''}`}
                onClick={() => setPriority(priority === val ? null : val)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-section">
          <label className="modal-label">Group <span className="modal-label-hint">optional</span></label>
          <input
            className="modal-input"
            list="group-options"
            placeholder="e.g. Contracting, Permanent, Exploratory"
            value={group}
            onChange={e => setGroup(e.target.value)}
          />
          <datalist id="group-options">
            {existingGroups.map(g => <option key={g} value={g} />)}
          </datalist>
        </div>

        <div className="modal-section modal-dates">
          <div>
            <label className="modal-label">Start date</label>
            <input className="modal-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="modal-label">End date</label>
            <input className="modal-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="modal-section">
          <label className="modal-label">Status history</label>
          <div className="sh-list">
            {history.map((seg, i) => {
              const sv = STATUSES[seg.status] || STATUSES.in_progress
              return (
                <div key={seg.id} className="sh-row">
                  <select
                    className="sh-select"
                    value={seg.status}
                    onChange={e => updateSeg(seg.id, 'status', e.target.value)}
                    style={{ borderColor: sv.bar }}
                  >
                    {Object.entries(STATUSES).map(([key, s]) => (
                      <option key={key} value={key}>{s.label}</option>
                    ))}
                  </select>
                  <input className="sh-date" type="date" value={seg.start_date} onChange={e => updateSeg(seg.id, 'start_date', e.target.value)} />
                  <span className="sh-arrow">→</span>
                  <input className="sh-date" type="date" value={seg.end_date || ''} placeholder="now" onChange={e => updateSeg(seg.id, 'end_date', e.target.value)} />
                  <button className="sh-delete" onClick={() => deleteSeg(seg.id)} title="Remove">×</button>
                </div>
              )
            })}
            <button className="sh-add-btn" onClick={addSeg}>+ Add segment</button>
          </div>
        </div>

        <div className="modal-section">
          <label className="modal-label">Milestones</label>
          {milestones.length === 0 ? (
            <p className="sh-empty">No milestones - click the timeline to add one.</p>
          ) : (
            <div className="sh-list">
              {milestones.map(m => (
                <div key={m.id} className="sh-row">
                  <input className="sh-date" type="date" value={m.date} onChange={e => updateMilestone(m.id, 'date', e.target.value)} />
                  <input className="modal-input sh-label" value={m.label} onChange={e => updateMilestone(m.id, 'label', e.target.value)} placeholder="Label" />
                  <button className="sh-delete" onClick={() => deleteMilestone(m.id)} title="Remove">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-section">
          <label className="modal-label">Add note</label>
          <div className="note-input-row">
            <textarea
              className="modal-textarea"
              placeholder="What's happening with this track..."
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
            />
            <button className="add-note-btn" onClick={addNote}>Add</button>
          </div>
        </div>

        {notesLog.length > 0 && (
          <div className="modal-section notes-log">
            <label className="modal-label">Notes history</label>
            <div className="notes-list">
              {notesLog.map(n => (
                <div key={n.id} className="note-entry">
                  {editingNoteId === n.id ? (
                    <textarea
                      className="note-edit-input"
                      value={editingNoteText}
                      autoFocus
                      onChange={e => setEditingNoteText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditNote(n.id) }
                        if (e.key === 'Escape') setEditingNoteId(null)
                      }}
                      onBlur={() => saveEditNote(n.id)}
                      rows={2}
                    />
                  ) : (
                    <p className="note-text" onClick={() => startEditNote(n)}>{n.text}</p>
                  )}
                  <div className="note-footer">
                    <span className="note-time">{formatTimestamp(n.timestamp)}</span>
                    <button className="note-delete-btn" onClick={() => deleteNote(n.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <div className="modal-actions-left">
            {confirmArchive ? (
              <div className="delete-confirm">
                <span className="delete-confirm-text">Archive this track?</span>
                <button className="modal-btn-warning" onClick={() => onArchive(track.id)}>Archive</button>
                <button className="modal-btn-secondary" onClick={() => setConfirmArchive(false)}>Cancel</button>
              </div>
            ) : confirmDelete ? (
              <div className="delete-confirm">
                <span className="delete-confirm-text">Permanently delete?</span>
                <button className="modal-btn-danger" onClick={() => onDelete(track.id)}>Delete</button>
                <button className="modal-btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            ) : (
              <div className="delete-confirm">
                <button className="modal-btn-ghost-warning" onClick={() => setConfirmArchive(true)}>Archive</button>
                <button className="modal-btn-ghost-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
              </div>
            )}
          </div>
          <div className="modal-actions-right">
            <button className="modal-btn-secondary" onClick={onClose}>Cancel</button>
            <button className="modal-btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
