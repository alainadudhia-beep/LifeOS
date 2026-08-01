import { TIMELINE_START, TIMELINE_END, DAY_WIDTH } from '../data/initialData'

export const TOTAL_DAYS = Math.ceil(
  (TIMELINE_END - TIMELINE_START) / (1000 * 60 * 60 * 24)
)

export const TIMELINE_WIDTH = TOTAL_DAYS * DAY_WIDTH

// Returns a date as YYYY-MM-DD in the device's local timezone.
// Uses Intl (not toISOString) so the day boundary follows the local clock,
// not UTC — entries logged at 10pm EDT stay on that local date, not UTC's next day.
export function localDateStr(d) {
  return new Intl.DateTimeFormat('en-CA').format(d)
}

export function dateToPx(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const days = (d - TIMELINE_START) / (1000 * 60 * 60 * 24)
  return Math.round(Math.max(0, Math.min(TIMELINE_WIDTH, days * DAY_WIDTH)))
}

export function pxToDate(px) {
  const days = Math.round(px / DAY_WIDTH)
  return localDateStr(new Date(TIMELINE_START.getTime() + days * 24 * 60 * 60 * 1000))
}

export function getDays() {
  const days = []
  const endStr = localDateStr(TIMELINE_END)
  let isoStr = localDateStr(TIMELINE_START)
  while (isoStr <= endStr) {
    const [y, m, d] = isoStr.split('-').map(Number)
    // Noon UTC: getDate()/getDay()/getMonth() return the correct calendar day
    // in any timezone from UTC-12 to UTC+14, avoiding local-midnight ambiguity.
    days.push(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)))
    isoStr = localDateStr(new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0)))
  }
  return days
}

export function getMonths() {
  const months = []
  const d = new Date(TIMELINE_START.getFullYear(), TIMELINE_START.getMonth(), 1)
  while (d <= TIMELINE_END) {
    months.push(new Date(d))
    d.setMonth(d.getMonth() + 1)
  }
  return months
}

export const DAY_ABBR   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function currentStatus(track) {
  const hist = track.status_history
  if (hist?.length) return hist[hist.length - 1].status
  return track.status || 'in_progress'
}

export function formatTimestamp(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
