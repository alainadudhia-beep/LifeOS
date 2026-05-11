import './CheckinNudge.css'

const FIELD_LABELS = {
  mood: 'your mood',
  'mood.work': 'work mood',
  'mood.life': 'life mood',
  'mood.energy': 'energy',
  'mood.focus': 'focus',
  sleep: 'your sleep',
  'sleep.hours': 'sleep hours',
  'sleep.quality': 'sleep quality',
  health: 'your health',
  diet: 'your diet',
  exercise: 'exercise',
  water: 'water intake',
  career_updates: 'any work updates',
}

function toLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  // fallback: turn "mood.work" → "work mood", "sleep.hours" → "sleep hours"
  const parts = field.split('.')
  return parts.reverse().join(' ')
}

export default function CheckinNudge({ missing, onDismiss }) {
  if (!missing?.length) return null

  const field = missing[0]
  const label = toLabel(field)

  return (
    <div className="nudge-root" onClick={onDismiss}>
      <span className="nudge-text">
        You didn&apos;t mention {label} - want to add it?
      </span>
      <button className="nudge-dismiss" onClick={onDismiss}>✕</button>
    </div>
  )
}
