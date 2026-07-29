import { useEffect, useState } from 'react'

/** Subscribe to a CSS media query from JS, for layout decisions CSS can't make. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false)

  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list) return
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

/**
 * The breakpoint where the plan and the side pane fit side by side. Chosen so
 * an iPad in portrait (834pt on an 11", 820pt on an Air) gets the split view
 * and phones do not.
 */
export const WIDE_QUERY = '(min-width: 820px)'

/**
 * Fraction of the plan's height covered by the sign sheet on a phone. Shared
 * with the `max-height` in index.css so the map can centre a sign in the part
 * of the plan that is still visible.
 */
export const SHEET_FRACTION = 0.62
