import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useSyncedStorage as useLocalStorage } from '../hooks/useSyncedStorage'
import { INITIAL_COMMITMENTS, DAY_WIDTH } from '../data/initialData'
import { TIMELINE_WIDTH, getDays, getMonths, dateToPx, DAY_ABBR, MONTH_NAMES, localDateStr } from '../utils/timeline'
import CommitmentEditModal from './CommitmentEditModal'
import LifeModules from './LifeModules'
import './Timeline.css'

function newCommitment() {
  const today = localDateStr(new Date())
  return { id: `c-${Date.now()}`, name: 'New commitment', start_date: today, end_date: today }
}

const days     = getDays()
const todayIso = localDateStr(new Date())

function commitmentGeometry(c) {
  const left  = dateToPx(c.start_date)
  const width = Math.max(dateToPx(c.end_date) - left + DAY_WIDTH, DAY_WIDTH)
  return { left, width }
}

const Timeline = forwardRef(function Timeline({ mobile } = {}, ref) {
  const labelWidth = mobile ? 160 : 240
  const [commitments, setCommitments] = useLocalStorage('lifetracker-commitments', INITIAL_COMMITMENTS)
  const [editingCommitment, setEditingCommitment] = useState(null)
  const scrollRef = useRef(null)

  function scrollToToday() {
    const px = dateToPx(todayIso)
    scrollRef.current?.scrollTo({ left: px - 200, behavior: 'smooth' })
  }

  useImperativeHandle(ref, () => ({
    scrollToToday,
    openNewCommitment: () => setEditingCommitment(newCommitment()),
  }))

  useEffect(() => {
    let f1, f2
    f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el) return
        const halfGrid = Math.floor((el.clientWidth - labelWidth) / 2)
        el.scrollLeft = Math.max(0, dateToPx(todayIso) - halfGrid)
      })
    })
    return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2) }
  }, []) // eslint-disable-line

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

  return (
    <div className="tl-panel">

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ minWidth: TIMELINE_WIDTH + labelWidth }}>

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

          {/* ── day header row ── */}
          <div className="tl-day-row">
            <div className="tl-label-col tl-day-header-cell">
              <span className="col-label">Life</span>
            </div>
            <div className="tl-day-header-grid" style={{ width: TIMELINE_WIDTH }}>
              {days.map((d, i) => {
                const iso    = d.toISOString().slice(0, 10)
                const dayIdx = d.getDay()
                return (
                  <div key={i}
                    className={`day-cell ${iso === todayIso ? 'day-today' : ''} ${dayIdx === 0 || dayIdx === 6 ? 'day-weekend' : ''}`}
                    style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}>
                    <span className="day-month">{MONTH_NAMES[d.getMonth()]}</span>
                    <span className="day-name">{DAY_ABBR[dayIdx]}</span>
                    <span className="day-num">{d.getDate()}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── grid lines + commitment bands ── */}
          <div className="tl-body">
            <div className="tl-grid-lines" style={{ left: labelWidth, width: TIMELINE_WIDTH }}>
              {days.map((d, i) =>
                d.getDay() === 1 ? <div key={i} className="grid-week-line" style={{ left: i * DAY_WIDTH }} /> : null
              )}
            </div>

            <div className="tl-commitment-layer" style={{ left: labelWidth, width: TIMELINE_WIDTH }}>
              {commitments.map(c => {
                const { left, width } = commitmentGeometry(c)
                return <div key={c.id} className="commitment-band" style={{ left, width }} />
              })}
            </div>
          </div>

          {!mobile && <LifeModules />}

        </div>
      </div>

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
})

export default Timeline
