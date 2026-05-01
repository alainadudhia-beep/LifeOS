import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { INITIAL_THIS_WEEK } from '../data/initialData'
import './ThisWeek.css'

const DISMISSED_KEY = 'lifetracker-dismissed-track-actions'

function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY)) ?? []) } catch { return new Set() }
}
function addDismissed(trackId) {
  const s = getDismissed(); s.add(trackId)
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]))
}

function getActionRequiredTracks() {
  try {
    const raw = JSON.parse(localStorage.getItem('lifetracker-tracks-v3'))
    const tracks = Array.isArray(raw) ? raw : Object.values(raw ?? {})
    return tracks.filter(t => {
      if (t.archived) return false
      const hist = t.status_history
      if (hist?.length) return hist[hist.length - 1].status === 'action_required' && !hist[hist.length - 1].end_date
      return t.status === 'action_required'
    })
  } catch { return [] }
}

function getWeekStart(date = new Date()) {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // back to Monday
  return d.toISOString().slice(0, 10)
}

function formatWeekRange(mondayIso) {
  const mon = new Date(mondayIso)
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6)
  const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(mon)} – ${fmt(sun)}`
}

function seedItems(raw) {
  return (raw ?? INITIAL_THIS_WEEK).map(item => ({
    completed: false,
    completed_at: null,
    week_of: getWeekStart(),
    carried_forward: false,
    ...item,
  }))
}

function runWeeklyReset(items) {
  const thisWeek = getWeekStart()
  const needsReset = items.some(it => it.week_of && it.week_of < thisWeek)
  if (!needsReset) return items
  return items
    .filter(it => !it.completed)
    .map(it => ({ ...it, week_of: thisWeek, carried_forward: true }))
}

const ThisWeek = forwardRef(function ThisWeek(props, ref) {
  const [stored, setStored] = useLocalStorage('lifetracker-thisweek-v1', null)
  const [items, setItemsRaw] = useState(() => runWeeklyReset(seedItems(stored)))
  const [newText, setNewText]   = useState('')
  const [newSugText, setNewSugText] = useState('')
  const inputRef = useRef(null)

  // Persist whenever items change
  function setItems(next) {
    const resolved = typeof next === 'function' ? next(items) : next
    setItemsRaw(resolved)
    setStored(resolved)
  }

  // Run reset once on mount if week has rolled over
  useEffect(() => {
    const reset = runWeeklyReset(seedItems(stored))
    setItemsRaw(reset)
    setStored(reset)
  }, []) // eslint-disable-line

  // Sync action_required tracks into Suggested
  useEffect(() => {
    function sync() {
      const dismissed = getDismissed()
      const actionTracks = getActionRequiredTracks()
      setItems(prev => {
        const existingTrackIds = new Set(prev.map(it => it.track_id).filter(Boolean))
        const toAdd = actionTracks
          .filter(t => !existingTrackIds.has(t.id) && !dismissed.has(t.id))
          .map(t => ({
            id: `w-track-${t.id}`,
            text: `${t.name} - action required`,
            order: 999,
            source: 'suggested',
            track_id: t.id,
            completed: false,
            completed_at: null,
            week_of: getWeekStart(),
            carried_forward: false,
          }))
        return toAdd.length ? [...prev, ...toAdd] : prev
      })
    }
    sync()
    window.addEventListener('lifetracker-tracks-updated', sync)
    return () => window.removeEventListener('lifetracker-tracks-updated', sync)
  }, []) // eslint-disable-line

  const weekStart  = getWeekStart()
  const manual     = items.filter(it => it.source !== 'suggested')
  const suggested  = items.filter(it => it.source === 'suggested')
  const active     = manual.filter(it => !it.completed)
  const done       = manual.filter(it => it.completed)

  function addItem(source = 'manual') {
    const text = source === 'suggested' ? newSugText.trim() : newText.trim()
    if (!text) return
    const item = {
      id: `w-${Date.now()}`,
      text,
      order: items.length,
      source,
      completed: false,
      completed_at: null,
      week_of: weekStart,
      carried_forward: false,
    }
    setItems(prev => [...prev, item])
    if (source === 'suggested') setNewSugText('')
    else setNewText('')
  }

  function toggle(id) {
    setItems(prev => prev.map(it =>
      it.id !== id ? it : {
        ...it,
        completed: !it.completed,
        completed_at: !it.completed ? new Date().toISOString() : null,
      }
    ))
  }

  function deleteItem(id) {
    setItems(prev => {
      const item = prev.find(it => it.id === id)
      if (item?.track_id) addDismissed(item.track_id)
      return prev.filter(it => it.id !== id)
    })
  }

  function handleKeyDown(e, source) {
    if (e.key === 'Enter') { e.preventDefault(); addItem(source) }
  }

  function startEditText(id, text) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, _editing: text } : it))
  }

  function saveEdit(id) {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      const text = (it._editing ?? it.text).trim()
      const { _editing, ...rest } = it
      return text ? { ...rest, text } : rest
    }))
  }

  function updateEditText(id, val) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, _editing: val } : it))
  }

  useImperativeHandle(ref, () => ({
    addSuggestions(suggestions) {
      if (!suggestions?.length) return
      setItems(prev => {
        const existingTexts = new Set(prev.map(it => it.text.toLowerCase().trim()))
        const fresh = suggestions.filter(s => !existingTexts.has(s.toLowerCase().trim()))
        if (!fresh.length) return prev
        const newItems = fresh.map(s => ({
          id: `w-${Date.now()}-${Math.random()}`,
          text: s,
          order: prev.length + 999,
          source: 'suggested',
          completed: false,
          completed_at: null,
          week_of: getWeekStart(),
          carried_forward: false,
        }))
        return [...prev, ...newItems]
      })
    }
  }))

  return (
    <div className="tw-panel">
      <div className="tw-header">
        <span className="tw-title">This Week</span>
        <span className="tw-range">{formatWeekRange(weekStart)}</span>
      </div>

      {/* ── manual items ── */}
      <div className="tw-section">
        {active.map(it => (
          <ItemRow key={it.id} item={it}
            onToggle={toggle} onDelete={deleteItem}
            onStartEdit={startEditText} onSaveEdit={saveEdit} onUpdateEdit={updateEditText}
          />
        ))}

        {/* add manual item */}
        <div className="tw-add-row">
          <input
            ref={inputRef}
            className="tw-add-input"
            placeholder="Add item…"
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => handleKeyDown(e, 'manual')}
          />
          {newText && (
            <button className="tw-add-btn" onClick={() => addItem('manual')}>Add</button>
          )}
        </div>

        {/* completed items */}
        {done.length > 0 && (
          <div className="tw-done-section">
            {done.map(it => (
              <ItemRow key={it.id} item={it}
                onToggle={toggle} onDelete={deleteItem}
                onStartEdit={startEditText} onSaveEdit={saveEdit} onUpdateEdit={updateEditText}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── suggested ── */}
      <div className="tw-divider" />
      <div className="tw-section">
        <div className="tw-suggested-label">Suggested</div>
        {suggested.map(it => (
          <ItemRow key={it.id} item={it}
            onToggle={toggle} onDelete={deleteItem}
            onStartEdit={startEditText} onSaveEdit={saveEdit} onUpdateEdit={updateEditText}
          />
        ))}
        <div className="tw-add-row">
          <input
            className="tw-add-input tw-add-input--suggested"
            placeholder="Add suggestion…"
            value={newSugText}
            onChange={e => setNewSugText(e.target.value)}
            onKeyDown={e => handleKeyDown(e, 'suggested')}
          />
          {newSugText && (
            <button className="tw-add-btn" onClick={() => addItem('suggested')}>Add</button>
          )}
        </div>
      </div>
    </div>
  )
})

export default ThisWeek

function ItemRow({ item, onToggle, onDelete, onStartEdit, onSaveEdit, onUpdateEdit }) {
  const isSuggested = item.source === 'suggested'
  const isEditing   = item._editing !== undefined

  return (
    <div className={`tw-item ${item.completed ? 'tw-item--done' : ''} ${isSuggested ? 'tw-item--suggested' : ''}`}>
      <button
        className={`tw-check ${item.completed ? 'tw-check--done' : ''}`}
        onClick={() => onToggle(item.id)}
        title={item.completed ? 'Mark incomplete' : 'Mark complete'}
      />
      <div className="tw-item-body">
        {item.carried_forward && !item.completed && (
          <span className="tw-carry-badge">carried</span>
        )}
        {isEditing ? (
          <input
            className="tw-edit-input"
            value={item._editing}
            autoFocus
            onChange={e => onUpdateEdit(item.id, e.target.value)}
            onBlur={() => onSaveEdit(item.id)}
            onKeyDown={e => {
              if (e.key === 'Enter') onSaveEdit(item.id)
              if (e.key === 'Escape') onSaveEdit(item.id)
            }}
          />
        ) : (
          <span
            className="tw-item-text"
            onDoubleClick={() => !item.completed && onStartEdit(item.id, item.text)}
          >
            {item.text}
          </span>
        )}
      </div>
      <button className="tw-delete" onClick={() => onDelete(item.id)} title="Remove">×</button>
    </div>
  )
}
