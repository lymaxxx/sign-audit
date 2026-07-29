import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Pan/zoom for the plan canvas.
 *
 * The view maps DXF world coordinates to CSS pixels inside the SVG:
 *
 *   screenX = tx + scale * worldX
 *   screenY = ty - scale * worldY      (DXF has Y up, screens have Y down)
 *
 * which is exactly `translate(tx, ty) scale(scale, -scale)` as an SVG
 * transform, applied once to the root group.
 *
 * Gestures use Pointer Events so one code path covers finger, trackpad and
 * mouse. The container sets `touch-action: none` so iOS Safari does not steal
 * the drag for page scrolling or its own pinch zoom.
 *
 * The authoritative view lives in a ref. Gestures update it through
 * `applyView`, which pushes to React state once per animation frame — reading
 * React state inside a pointermove handler instead would drop motion during a
 * fast pan, because several move events land between two renders. One-shot
 * actions (fit, zoom buttons, jumping to a sign) use `setViewNow` and commit
 * immediately, since there is nothing to coalesce and they must not be lost.
 */

const MIN_SCALE = 1e-6
const MAX_SCALE = 1e7
const TAP_SLOP = 10 // px of movement still counted as a tap rather than a drag

const INITIAL = { scale: 1, tx: 0, ty: 0 }

function clampScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function useViewport() {
  const containerRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState(INITIAL)

  const liveView = useRef(INITIAL)
  const frame = useRef(0)
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const movedRef = useRef(false)
  const observer = useRef(null)

  /**
   * Callback ref rather than a plain ref plus an effect. This hook is called
   * from App, which renders a loading screen before it renders the plan at all,
   * so a mount-time effect would find a null node, bail out, and — with empty
   * deps — never look again, leaving the viewport permanently 0x0 and the plan
   * stuck at its unfitted default view.
   */
  const setContainer = useCallback((node) => {
    observer.current?.disconnect()
    observer.current = null
    containerRef.current = node
    if (!node) return

    observer.current = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: box.width, height: box.height })
    })
    observer.current.observe(node)

    const box = node.getBoundingClientRect()
    setSize({ width: box.width, height: box.height })
  }, [])

  useEffect(
    () => () => {
      observer.current?.disconnect()
      observer.current = null
    },
    [],
  )

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      // Must be cleared, not just cancelled: a stale non-zero handle would make
      // applyView believe a frame was still pending and stop scheduling for
      // good. StrictMode's simulated unmount makes that reachable in
      // development, and it leaves the plan stuck at its unfitted default view.
      frame.current = 0
    },
    [],
  )

  /**
   * Per-frame view update, for gestures that fire many times between renders.
   */
  const applyView = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(liveView.current) : updater
    liveView.current = next
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setView(liveView.current)
    })
  }, [])

  /**
   * Immediate view update, for one-shot actions (fit, zoom button, jump to a
   * sign). These must not be swallowed by frame coalescing, so they cancel any
   * pending frame and commit straight away.
   */
  const setViewNow = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(liveView.current) : updater
    liveView.current = next
    cancelAnimationFrame(frame.current)
    frame.current = 0
    setView(next)
  }, [])

  const rect = useCallback(() => containerRef.current?.getBoundingClientRect() ?? null, [])

  const toWorld = useCallback(
    (clientX, clientY) => {
      const box = rect()
      if (!box) return { x: 0, y: 0 }
      const { scale, tx, ty } = liveView.current
      return { x: (clientX - box.left - tx) / scale, y: (ty - (clientY - box.top)) / scale }
    },
    [rect],
  )

  /** Fit a world-space bounding box into the container with a little padding. */
  const fitTo = useCallback(
    (bounds, padding = 0.06) => {
      const box = rect()
      if (!box?.width || !box?.height) return
      if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)) return
      const w = Math.max(bounds.maxX - bounds.minX, 1e-9)
      const h = Math.max(bounds.maxY - bounds.minY, 1e-9)
      const scale = clampScale(Math.min(box.width / w, box.height / h) * (1 - padding * 2))
      const cx = (bounds.minX + bounds.maxX) / 2
      const cy = (bounds.minY + bounds.maxY) / 2
      setViewNow({ scale, tx: box.width / 2 - scale * cx, ty: box.height / 2 + scale * cy })
    },
    [setViewNow, rect],
  )

  /**
   * Centre on a world point, optionally changing zoom.
   *
   * `bottomInset` is the fraction of the container hidden behind something —
   * on a phone, the sign sheet covers the lower part of the plan, and centring
   * in the full height would put the sign the user just tapped underneath it.
   */
  const centerOn = useCallback(
    (x, y, nextScale, bottomInset = 0) => {
      const box = rect()
      if (!box) return
      const visibleHeight = box.height * (1 - Math.min(Math.max(bottomInset, 0), 0.9))
      setViewNow((current) => {
        const scale = clampScale(nextScale ?? current.scale)
        return { scale, tx: box.width / 2 - scale * x, ty: visibleHeight / 2 + scale * y }
      })
    },
    [setViewNow, rect],
  )

  /** Zoom by a factor about a fixed point given in container pixels. */
  const zoomAt = useCallback(
    (factor, px, py) => {
      setViewNow((current) => {
        const scale = clampScale(current.scale * factor)
        const applied = scale / current.scale
        return {
          scale,
          tx: px - (px - current.tx) * applied,
          ty: py - (py - current.ty) * applied,
        }
      })
    },
    [setViewNow],
  )

  const zoomBy = useCallback(
    (factor) => {
      const box = rect()
      if (box) zoomAt(factor, box.width / 2, box.height / 2)
    },
    [rect, zoomAt],
  )

  const handlers = useMemo(() => {
    const localPoint = (event) => {
      const box = containerRef.current.getBoundingClientRect()
      return { x: event.clientX - box.left, y: event.clientY - box.top }
    }

    // Re-derive the gesture whenever the number of touching fingers changes,
    // so lifting one finger out of a pinch continues as a clean pan.
    const resetGesture = () => {
      const points = [...pointers.current.values()]
      if (points.length === 1) {
        gesture.current = { kind: 'pan', last: { x: points[0].x, y: points[0].y } }
      } else if (points.length >= 2) {
        const [a, b] = points
        gesture.current = {
          kind: 'pinch',
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        }
      } else {
        gesture.current = null
      }
    }

    return {
      onPointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        // Deliberately no setPointerCapture here. While a capture is active the
        // browser retargets the follow-up `click` to the capturing element, so
        // capturing on press would stop taps ever reaching a sign marker.
        // Capture is taken below, once the gesture is definitely a drag.
        const point = localPoint(event)
        pointers.current.set(event.pointerId, { ...point, start: point })
        if (pointers.current.size === 1) movedRef.current = false
        resetGesture()
      },

      onPointerMove(event) {
        const tracked = pointers.current.get(event.pointerId)
        if (!tracked) return
        const point = localPoint(event)
        pointers.current.set(event.pointerId, { ...tracked, ...point })

        if (Math.hypot(point.x - tracked.start.x, point.y - tracked.start.y) > TAP_SLOP) {
          if (!movedRef.current) event.currentTarget.setPointerCapture?.(event.pointerId)
          movedRef.current = true
        }

        const active = gesture.current
        if (!active) return

        if (active.kind === 'pan' && pointers.current.size === 1) {
          const dx = point.x - active.last.x
          const dy = point.y - active.last.y
          active.last = point
          applyView((current) => ({ ...current, tx: current.tx + dx, ty: current.ty + dy }))
          return
        }

        if (active.kind === 'pinch' && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()]
          const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1
          const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const previousCenter = active.center
          const factor = distance / active.distance
          active.distance = distance
          active.center = center
          movedRef.current = true
          // Zoom about the pinch centre, and pan by however far that centre
          // itself moved, so two fingers can zoom and drag in one motion.
          applyView((current) => {
            const scale = clampScale(current.scale * factor)
            const applied = scale / current.scale
            return {
              scale,
              tx: center.x - (previousCenter.x - current.tx) * applied,
              ty: center.y - (previousCenter.y - current.ty) * applied,
            }
          })
        }
      },

      onPointerUp(event) {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        pointers.current.delete(event.pointerId)
        resetGesture()
      },

      onPointerCancel(event) {
        pointers.current.delete(event.pointerId)
        resetGesture()
      },

      onWheel(event) {
        const point = localPoint(event)
        // A trackpad pinch arrives as a wheel event with ctrlKey set.
        const intensity = event.ctrlKey ? 0.02 : 0.0015
        zoomAt(Math.exp(-event.deltaY * intensity), point.x, point.y)
      },
    }
  }, [applyView, zoomAt])

  /**
   * True when the pointer moved far enough to count as a drag. Click handlers
   * check this so panning across a sign does not open it.
   */
  const wasDrag = useCallback(() => movedRef.current, [])

  const transform = `translate(${view.tx} ${view.ty}) scale(${view.scale} ${-view.scale})`

  return {
    containerRef: setContainer,
    size,
    view,
    transform,
    handlers,
    toWorld,
    fitTo,
    centerOn,
    zoomBy,
    wasDrag,
  }
}

/** World-space rectangle currently visible, grown by `margin` pixels. */
export function visibleBounds(view, size, margin = 100) {
  if (!size.width || !size.height || !view.scale) return null
  return {
    minX: (-margin - view.tx) / view.scale,
    maxX: (size.width + margin - view.tx) / view.scale,
    minY: (view.ty - (size.height + margin)) / view.scale,
    maxY: (view.ty + margin) / view.scale,
  }
}
