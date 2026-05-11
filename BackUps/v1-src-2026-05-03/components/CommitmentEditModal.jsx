import { useState } from 'react'
import './TrackEditModal.css'
import './CommitmentEditModal.css'

export default function CommitmentEditModal({ commitment, onSave, onDelete, onClose }) {
  const [name, setName]           = useState(commitment.name)
  const [startDate, setStartDate] = useState(commitment.start_date)
  const [endDate, setEndDate]     = useState(commitment.end_date)

  function handleSave() {
    if (!name.trim()) return
    onSave({ ...commitment, name: name.trim(), start_date: startDate, end_date: endDate })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Edit commitment</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-section">
          <label className="modal-label">Name</label>
          <input className="modal-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
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

        <div className="modal-actions commitment-actions">
          <button className="modal-btn-danger" onClick={() => onDelete(commitment.id)}>Delete</button>
          <div className="modal-actions-right">
            <button className="modal-btn-secondary" onClick={onClose}>Cancel</button>
            <button className="modal-btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
