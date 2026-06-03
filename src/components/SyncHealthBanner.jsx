import { useEffect, useState } from 'react'
import { dbRead } from '../lib/db'
import './SyncHealthBanner.css'

/**
 * SyncHealthBanner — shows a top-of-app warning when Google Health sync is failing.
 *
 * Reads `lifetracker-sync-health` from Supabase on mount (no localStorage cache).
 * Two states:
 *   token_error → "Health sync issue — re-authentication needed" (tappable link)
 *   api_error   → "Health sync issue — check diagnostic"
 */
export default function SyncHealthBanner() {
  const [health, setHealth]     = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    dbRead('lifetracker-sync-health')
      .then(data => setHealth(data))
      .catch(() => {})
  }, [])

  if (!health || health.status === 'ok' || dismissed) return null

  const isTokenError = health.status === 'token_error'
  const lastOkText   = health.last_ok
    ? `Last synced ${new Date(health.last_ok).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    : null

  return (
    <div className={`sync-banner sync-banner--${health.status}`} role="alert">
      <span className="sync-banner__icon">⚠️</span>
      <span className="sync-banner__text">
        {isTokenError ? (
          <>
            Health sync issue —{' '}
            <a
              href="/api/google-health-auth"
              className="sync-banner__link"
              target="_blank"
              rel="noreferrer"
            >
              re-authentication needed
            </a>
          </>
        ) : health.slack_url ? (
          <>
            Health sync issue —{' '}
            <a
              href={health.slack_url}
              className="sync-banner__link"
              onClick={e => {
                e.preventDefault()
                // Try slack:// deep link first (opens app on mobile/desktop)
                // Fall back to web URL after 1.5s if app didn't open
                const match = health.slack_url.match(/\/client\/([^/]+)\/([^/?]+)/)
                if (match) {
                  window.location.href = `slack://channel?team=${match[1]}&id=${match[2]}`
                  setTimeout(() => window.open(health.slack_url, '_blank'), 1500)
                } else {
                  window.open(health.slack_url, '_blank')
                }
              }}
            >
              check Slack
            </a>
          </>
        ) : (
          'Health sync issue — check diagnostic'
        )}
        {lastOkText && <span className="sync-banner__sub"> · {lastOkText}</span>}
      </span>
      <button
        className="sync-banner__dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  )
}
