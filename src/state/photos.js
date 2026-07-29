import { useEffect, useState } from 'react'
import { getPhoto } from './db.js'

// Thumbnails are small and shown constantly, so their object URLs are kept for
// the life of the page. Full-size images are revoked as soon as the viewer
// closes, because each one pins a couple of megabytes of decoded bitmap.
const thumbCache = new Map()

/**
 * Object URL for a stored photo.
 * @param {string|null} id
 * @param {{thumb?: boolean}} [options]
 */
export function usePhotoUrl(id, { thumb = false } = {}) {
  const [url, setUrl] = useState(() => (thumb && id ? (thumbCache.get(id) ?? null) : null))

  useEffect(() => {
    if (!id) {
      setUrl(null)
      return
    }
    if (thumb && thumbCache.has(id)) {
      setUrl(thumbCache.get(id))
      return
    }

    let cancelled = false
    let created = null

    getPhoto(id)
      .then((photo) => {
        const blob = thumb ? (photo?.thumb ?? photo?.blob) : photo?.blob
        if (cancelled || !blob) return
        created = URL.createObjectURL(blob)
        if (thumb) thumbCache.set(id, created)
        setUrl(created)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })

    return () => {
      cancelled = true
      if (created && !thumb) URL.revokeObjectURL(created)
    }
  }, [id, thumb])

  return url
}
