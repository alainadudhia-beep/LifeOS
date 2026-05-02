import { useState, useRef, useEffect } from 'react'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import { INITIAL_TRACKS, INITIAL_COMMITMENTS, STATUSES, STATUS_MIGRATION, DAY_WIDTH } from '../data/initialData'
import { TIMELINE_WIDTH, getDays, getMonths, dateToPx, DAY_ABBR, MONTH_NAMES, currentStatus } from '../utils/timeline'
import CareerTrackRow from './CareerTrackRow'
import TrackEditModal from './TrackEditModal'
import CommitmentEditModal from './CommitmentEditModal'
import DecisionLine from './DecisionLine'
import LifeModules from './LifeModules'
import './Timeline.css'

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, null: 3 }

function migrateTrack(t) {
  const migrateStatus = s => STATUS_MIGRATION[s] || s
  if (t.status_history) {
    return {
      ...t,
      status_history: t.status_history.map(seg => ({ ...seg, status: migrateStatus(seg.status) }))
    }
  }
  const today = new Date().toISOString().slice(0, 10)
  return {
    ...t,
    status_history: [{ id: `sh-${t.id}-1`, status: migrateStatus(t.status || 'in_progress'), start_date: t.start_date || today, end_date: null }],
    status: undefined,
  }
}

function newTrack() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: `track-${Date.now()}`,
    name: 'New track',
    status_history: [{ id: `sh-new-${Date.now()}`, status: 'in_progress', start_date: today, end_date: null }],
    priority: null,
    group: null,
    start_date: today,
    end_date: '2026-09-01',
    milestones: [],
    notes_log: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function newCommitment() {
  const today = new Date().toISOString().slice(0, 10)
  return { id: `c-${Date.now()}`, name: 'New commitment', start_date: today, end_date: today }
}

const days     = getDays()
const months   = getMonths()
const todayIso = new Date().toISOString().slice(0, 10)

function commitmentGeometry(c) {
  const left  = dateToPx(c.start_date)
  const width = Math.max(dateToPx(c.end_date) - left + DAY_WIDTH, DAY_WIDTH)
  return { left, width }
}

// Normalise group: treat null/undefined/'' all as null
const grp = t => t.group?.trim() || null

// Score a group by its tracks' priorities: compare H count desc, then M, then L
function groupScore(tracks) {
  const counts = { high: 0, medium: 0, low: 0 }
  tracks.forEach(t => { if (t.priority) counts[t.priority]++ })
  return counts
}

function compareGroupScores(a, b) {
  if (b.high   !== a.high)   return b.high   - a.high
  if (b.medium !== a.medium) return b.medium - a.medium
  return b.low - a.low
}

function sortedTracks(tracks) {
  // Build group score map
  const byGroup = {}
  tracks.forEach(t => {
    const g = grp(t) ?? '__ungrouped__'
    if (!byGroup[g]) byGroup[g] = []
    byGroup[g].push(t)
  })
  const groupRank = {}
  const namedGroups = Object.keys(byGroup).filter(g => g !== '__ungrouped__')
  namedGroups
    .sort((a, b) => compareGroupScores(groupScore(byGroup[a]), groupScore(byGroup[b])))
    .forEach((g, i) => { groupRank[g] = i })

  return [...tracks].sort((a, b) => {
    const ga = grp(a), gb = grp(b)
    if (ga !== gb) {
      if (ga === null) return 1
      if (gb === null) return -1
      return (groupRank[ga] ?? 0) - (groupRank[gb] ?? 0)
    }
    const pa = PRIORITY_ORDER[a.priority] ?? 3
    const pb = PRIORITY_ORDER[b.priority] ?? 3
    return pa - pb
  })
}

// Build display rows: group headers + track rows
function buildRenderList(tracks) {
  const sorted = sortedTracks(tracks)
  const hasAnyGroup = sorted.some(t => grp(t) !== null)

  if (!hasAnyGroup) return sorted.map(t => ({ type: 'track', track: t }))

  const rows = []
  let lastGroup = undefined
  sorted.forEach(t => {
    const g = grp(t)
    if (g !== lastGroup) {
      rows.push({ type: 'group-header', group: g, id: `gh-${g ?? 'ungrouped'}` })
      lastGroup = g
    }
    rows.push({ type: 'track', track: t })
  })
  return rows
}

export default function Timeline({ mobile } = {}) {
  const [storedTracks, setTracks] = useLocalStorage('lifetracker-tracks-v3', null)
  const tracks = (storedTracks ?? INITIAL_TRACKS).map(migrateTrack)
  const [commitments, setCommitments] = useLocalStorage('lifetracker-commitments', INITIAL_COMMITMENTS)
  const [editingTrack,      setEditingTrack]      = useState(null)
  const [editingCommitment, setEditingCommitment] = useState(null)
  const [showArchived,      setShowArchived]      = useState(false)
  const [showLegend,        setShowLegend]        = useState(false)
  const [showAddNew,        setShowAddNew]        = useState(false)
  const scrollRef = useRef(null)

  function scrollToToday() {
    const px = dateToPx(todayIso)
    scrollRef.current?.scrollTo({ left: px - 200, behavior: 'smooth' })
  }

  useEffect(() => {
    requestAnimationFrame(() => {
      const px = dateToPx(todayIso)
      scrollRef.current?.scrollTo({ left: Math.max(0, px - (mobile ? 80 : 200)), behavior: 'instant' })
    })
  }, []) // eslint-disable-line

  useEffect(() => {
    function onTracksUpdated() {
      try {
        const raw = localStorage.getItem('lifetracker-tracks-v3')
        if (raw) setTracks(JSON.parse(raw))
      } catch { /* ignore */ }
    }
    window.addEventListener('lifetracker-tracks-updated', onTracksUpdated)
    return () => window.removeEventListener('lifetracker-tracks-updated', onTracksUpdated)
  }, []) // eslint-disable-line

  function update(fn) { setTracks(fn(tracks)) }

  function handleSaveTrack(updated) {
    update(ts => ts.map(t => t.id === updated.id ? { ...updated, updated_at: new Date().toISOString() } : t))
    setEditingTrack(null)
  }

  function handleDeleteTrack(id) {
    update(ts => ts.filter(t => t.id !== id))
    setEditingTrack(null)
  }

  function handleArchiveTrack(id) {
    update(ts => ts.map(t => t.id === id ? { ...t, archived: true } : t))
    setEditingTrack(null)
  }

  function handleStatusChange(id, newStatus) {
    const today = new Date().toISOString().slice(0, 10)
    update(ts => ts.map(t => {
      if (t.id !== id) return t
      const hist = t.status_history || []
      const closed = hist.map((seg, i) =>
        i === hist.length - 1 && seg.end_date === null ? { ...seg, end_date: today } : seg
      )
      const newSeg = { id: `sh-${id}-${Date.now()}`, status: newStatus, start_date: today, end_date: null }
      return { ...t, status_history: [...closed, newSeg], updated_at: new Date().toISOString() }
    }))
  }

  function handleAddNote(id, text) {
    const todayPrefix = new Date().toISOString().slice(0, 10)
    update(ts => ts.map(t => {
      if (t.id !== id) return t
      const log = t.notes_log || []
      const todayIdx = log.findIndex(n => n.timestamp.startsWith(todayPrefix))
      const newLog = todayIdx !== -1
        ? log.map((n, i) => i === todayIdx ? { ...n, text, timestamp: new Date().toISOString() } : n)
        : [{ id: `n-${Date.now()}`, text, timestamp: new Date().toISOString() }, ...log]
      return { ...t, notes_log: newLog, updated_at: new Date().toISOString() }
    }))
  }

  function handleAddMilestone(id, date, label) {
    const m = { id: `m-${Date.now()}`, date, label }
    update(ts => ts.map(t => t.id === id ? { ...t, milestones: [...(t.milestones || []), m] } : t))
  }

  function handleEditMilestone(trackId, milestoneId, label) {
    update(ts => ts.map(t =>
      t.id === trackId
        ? { ...t, milestones: t.milestones.map(m => m.id === milestoneId ? { ...m, label } : m) }
        : t
    ))
  }

  function handleSaveCommitment(updated) {
    setCommitments(prev =>
      prev.find(c => c.id === updated.id)
        ? prev.map(c => c.id === updated.id ? updated : c)
        : [...prev, updated]
    )
    setEditingCommitment(null)
  }

  function handleDeleteCommitment(id) {
    setCommitments(prev => prev.filter(c => c.id !== id))
    setEditingCommitment(null)
  }

  const visibleTracks  = tracks.filter(t => showArchived || !t.archived)
  const archivedCount  = tracks.filter(t => t.archived).length
  const existingGroups = [...new Set(tracks.map(t => grp(t)).filter(Boolean))]
  const renderList     = buildRenderList(visibleTracks)

  return (
    <div className="tl-panel">

      {/* ── toolbar ── */}
      <div className="tl-toolbar">
        <div className="tl-legend-btn-wrap">
          <button className="add-btn secondary" onClick={() => setShowLegend(v => !v)}>
            Legend {showLegend ? '▲' : '▼'}
          </button>
          {showLegend && (
            <div className="tl-legend-dropdown">
              {Object.entries(STATUSES).map(([key, s]) => (
                <span key={key} className="legend-item">
                  <span className="legend-swatch" style={{ background: s.bar }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="tl-toolbar-actions">
          <button className="add-btn today-btn" onClick={scrollToToday}>Today</button>
          {archivedCount > 0 && (
            <button className={`add-btn secondary ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived(v => !v)}>
              {showArchived ? 'Hide archived' : `Archived (${archivedCount})`}
            </button>
          )}
          <div className="tl-add-new-wrap">
            <button className="add-btn primary" onClick={() => setShowAddNew(v => !v)}>
              Add New {showAddNew ? '▲' : '▼'}
            </button>
            {showAddNew && (
              <div className="tl-add-new-dropdown">
                <button className="tl-add-new-item" onClick={() => { setEditingCommitment(newCommitment()); setShowAddNew(false) }}>
                  Commitment
                </button>
                <button className="tl-add-new-item" onClick={() => { const t = newTrack(); update(ts => [...ts, t]); setEditingTrack(t); setShowAddNew(false) }}>
                  Track
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ minWidth: TIMELINE_WIDTH + 240 }}>

          {/* ── commitment title row ── */}
          <div className="tl-commitment-row">
            <div className="tl-label-col tl-commitment-cell" />
            <div className="tl-commitment-title-grid" style={{ width: TIMELINE_WIDTH }}>
              {commitments.map(c => {
                const { left, width } = commitmentGeometry(c)
                return (
                  <div key={c.id} className="commitment-header-cap" style={{ left, width }}
                    onClick={() => setEditingCommitment(c)} title={`Edit: ${c.name}`}>
                    <span className="commitment-header-label">{c.name}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── month row ── */}
          <div className="tl-month-row">
            <div className="tl-label-col tl-month-cell" />
            <div className="tl-month-grid" style={{ width: TIMELINE_WIDTH }}>
              {months.map((m, i) => {
                const nextM = new Date(m.getFullYear(), m.getMonth() + 1, 1)
                const left  = dateToPx(m)
                const right = TIMELINE_WIDTH - dateToPx(nextM)
                return (
                  <div key={i} className="th-month-label" style={{ left: Math.max(0, left), right: Math.max(0, right) }}>
                    {MONTH_NAMES[m.getMonth()]} {m.getFullYear()}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── day header row ── */}
          <div className="tl-day-row">
            <div className="tl-label-col tl-day-header-cell">
              <span className="col-label">Track</span>
            </div>
            <div className="tl-day-header-grid" style={{ width: TIMELINE_WIDTH }}>
              {days.map((d, i) => {
                const iso    = d.toISOString().slice(0, 10)
                const dayIdx = d.getDay()
                return (
                  <div key={i}
                    className={`day-cell ${iso === todayIso ? 'day-today' : ''} ${dayIdx === 0 || dayIdx === 6 ? 'day-weekend' : ''}`}
                    style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}>
                    <span className="day-name">{DAY_ABBR[dayIdx].slice(0, 1)}</span>
                    <span className="day-num">{d.getDate()}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── track rows ── */}
          <div className="tl-body">
            <div className="tl-grid-lines" style={{ left: 240, width: TIMELINE_WIDTH }}>
              {days.map((d, i) =>
                d.getDay() === 1 ? <div key={i} className="grid-week-line" style={{ left: i * DAY_WIDTH }} /> : null
              )}
              <DecisionLine />
            </div>

            <div className="tl-commitment-layer" style={{ left: 240, width: TIMELINE_WIDTH }}>
              {commitments.map(c => {
                const { left, width } = commitmentGeometry(c)
                return <div key={c.id} className="commitment-band" style={{ left, width }} />
              })}
            </div>

            {renderList.map(row => {
              if (row.type === 'group-header') {
                return (
                  <div key={row.id} className="group-header-row">
                    <div className="group-header-label">{row.group ?? 'Ungrouped'}</div>
                    <div className="group-header-line" style={{ width: TIMELINE_WIDTH }} />
                  </div>
                )
              }
              return (
                <CareerTrackRow
                  key={row.track.id}
                  track={row.track}
                  onClick={() => setEditingTrack(row.track)}
                  onStatusChange={handleStatusChange}
                  onAddNote={handleAddNote}
                  onAddMilestone={handleAddMilestone}
                  onEditMilestone={handleEditMilestone}
                />
              )
            })}
          </div>

          {!mobile && <LifeModules />}

        </div>
      </div>

      {editingTrack && (
        <TrackEditModal
          track={editingTrack}
          onSave={handleSaveTrack}
          onDelete={handleDeleteTrack}
          onArchive={handleArchiveTrack}
          onClose={() => setEditingTrack(null)}
          existingGroups={existingGroups}
        />
      )}

      {editingCommitment && (
        <CommitmentEditModal
          commitment={editingCommitment}
          onSave={handleSaveCommitment}
          onDelete={handleDeleteCommitment}
          onClose={() => setEditingCommitment(null)}
        />
      )}
    </div>
  )
}
