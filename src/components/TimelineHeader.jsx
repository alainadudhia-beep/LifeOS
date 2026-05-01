import { getMonths, getWeeks, dateToPx, TIMELINE_WIDTH, MONTH_NAMES } from '../utils/timeline'
import { TIMELINE_START } from '../data/initialData'
import './TimelineHeader.css'

const months = getMonths()
const weeks = getWeeks()

export default function TimelineHeader() {
  return (
    <div className="th-wrap" style={{ width: TIMELINE_WIDTH }}>
      <div className="th-months">
        {months.map((m, i) => {
          const nextMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1)
          const left = dateToPx(m < TIMELINE_START ? TIMELINE_START : m)
          const right = TIMELINE_WIDTH - dateToPx(nextMonth)
          return (
            <div key={i} className="th-month" style={{ left, right: Math.max(0, right) }}>
              {MONTH_NAMES[m.getMonth()]}
            </div>
          )
        })}
      </div>
      <div className="th-weeks">
        {weeks.map((w, i) => (
          <div key={i} className="th-week-tick" style={{ left: dateToPx(w) }} />
        ))}
      </div>
    </div>
  )
}
