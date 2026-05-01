import { dateToPx } from '../utils/timeline'
import './DecisionLine.css'

export default function DecisionLine() {
  // offset by label col (200px)
  const left = 200 + dateToPx('2026-09-01')
  return (
    <div className="decision-line" style={{ left }}>
      <div className="decision-bar" />
      <span className="decision-label">decision point</span>
    </div>
  )
}
