import { useEffect, useState } from 'react'

/**
 * Offline and installation status.
 *
 * The app is built to work with no signal — the service worker precaches the
 * whole shell and every project, photo and note lives in IndexedDB on the
 * device — but two things about iOS make that worth saying out loud:
 *
 *  1. Safari only guarantees a reliable offline launch for a web app that has
 *     been added to the Home Screen. In a browser tab it usually works, but
 *     the tab can be discarded and the cache is best-effort.
 *  2. Safari evicts a site's storage after roughly seven days without a visit.
 *     Home-screen apps are exempt. For a survey spread over a fortnight, that
 *     is the difference between keeping your work and losing it.
 *
 * So iOS Safari users get a one-off, dismissible prompt to install. It is
 * shown once and remembered, not nagged.
 */

const DISMISS_KEY = 'signage-audit:install-hint-dismissed'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS predates the standard and still reports it here.
    window.navigator.standalone === true
  )
}

function isIosSafari() {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return ios && webkit
}

export default function OfflineNotice() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      // Private browsing can block localStorage; treat that as "not dismissed".
    }
    setShowInstall(isIosSafari() && !isStandalone() && !dismissed)
  }, [])

  const dismiss = () => {
    setShowInstall(false)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Nothing to do — the hint simply reappears next session.
    }
  }

  if (!online) {
    return (
      <p className="status status--offline" role="status">
        Offline — the plan, your notes and your photos are all on this device. Everything keeps
        working.
      </p>
    )
  }

  if (!showInstall) return null

  return (
    <div className="status status--install" role="note">
      <p>
        <strong>Add to Home Screen</strong> (Share → Add to Home Screen) for full screen, reliable
        offline use, and so iOS stops clearing saved audits after a week.
      </p>
      <button type="button" className="ghost" onClick={dismiss}>
        Got it
      </button>
    </div>
  )
}
