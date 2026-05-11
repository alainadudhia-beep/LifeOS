import { dateToPx } from '../utils/timeline'
import { DAY_WIDTH } from '../data/initialData'
import './CommitmentBands.css'

export default function CommitmentBands({ commitments, onEdit }) {
  return (
    <>
      {commitments.map(c => {
        const left  = dateToPx(c.start_date)
        const width = Math.max(dateToPx(c.end_date) - left + DAY_WIDTH, DAY_WIDTH)
        return (
          <div
            key={c.id}
            className="commitment-band"
            style={{ left, width }}
            onClick={e => { e.stopPropagation(); onEdit(c) }}
            title={c.name}
          >
            <span className="commitment-label">{c.name}</span>
          </div>
        )
      })}
    </>
  )
}
