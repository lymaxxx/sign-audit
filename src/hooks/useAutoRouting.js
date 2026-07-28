import { useEffect, useRef, useState } from 'react'
import { enqueue, routeThrough, straightLeg } from '../services/routing.js'
import { networkHint } from '../lib/env.js'

// Watches the project for legs that still need geometry and fills them in,
// one at a time, from the routing service (or with a straight line when the
// route has road snapping switched off).
export function useAutoRouting(project, dispatch) {
  const inFlight = useRef(new Set())
  const [status, setStatus] = useState({ pending: 0, error: null })

  useEffect(() => {
    const jobs = []
    for (const route of project.routes) {
      for (const dirKey of ['fwd', 'bwd']) {
        const dir = route.dirs[dirKey]
        if (!dir) continue
        dir.legs.forEach((leg, index) => {
          if (leg.status !== 'pending') return
          const from = project.stops.find((s) => s.id === dir.stopIds[index])
          const to = project.stops.find((s) => s.id === dir.stopIds[index + 1])
          if (!from || !to) return
          jobs.push({ route, dirKey, index, leg, from, to })
        })
      }
    }

    setStatus((prev) => ({ ...prev, pending: jobs.length }))
    if (!jobs.length) return

    for (const job of jobs.slice(0, 6)) {
      const key = `${job.route.id}:${job.dirKey}:${job.index}:${job.leg.vias.length}:${job.from.id}:${job.to.id}`
      if (inFlight.current.has(key)) continue
      inFlight.current.add(key)

      const points = [
        [job.from.lat, job.from.lon],
        ...job.leg.vias,
        [job.to.lat, job.to.lon],
      ]

      const finish = (leg) => {
        inFlight.current.delete(key)
        dispatch({
          type: 'setLeg',
          routeId: job.route.id,
          dirKey: job.dirKey,
          index: job.index,
          leg,
        })
      }

      if (job.route.snap === false) {
        finish(straightLeg(points))
        continue
      }

      enqueue(() => routeThrough(points, job.route.mode))
        .then((res) => {
          setStatus((prev) => ({ ...prev, error: null }))
          finish({ coords: res.coords, status: 'road', viaSplits: res.viaSplits })
        })
        .catch((err) => {
          setStatus((prev) => ({ ...prev, error: `${err.message}${networkHint()}` }))
          finish({ ...straightLeg(points), status: 'error', error: err.message })
        })
    }
  }, [project.routes, project.stops, dispatch])

  return status
}
