const KEYS = [
  'lifetracker-tracks-v3',
  'lifetracker-commitments',
  'lifetracker-life-logs',
  'lifetracker-this-week-focuses',
  'lifetracker-this-week-tasks',
]

export async function exportData() {
  const data = {}
  for (const key of KEYS) {
    const val = localStorage.getItem(key)
    if (val !== null) data[key] = JSON.parse(val)
  }
  const json = JSON.stringify(data, null, 2)
  const filename = `lifeos-backup-${new Date().toISOString().slice(0, 10)}.json`

  // Use File System Access API if available (lets user pick/remember the BackUps folder)
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return
    } catch (e) {
      if (e.name === 'AbortError') return // user cancelled
    }
  }

  // Fallback for browsers without File System Access API
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function importData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        for (const [key, val] of Object.entries(data)) {
          localStorage.setItem(key, JSON.stringify(val))
        }
        resolve()
      } catch {
        reject(new Error('Invalid backup file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
