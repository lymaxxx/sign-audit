import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { closestSegmentIndex } from '../lib/geo.js'
import { routesAtStop } from '../state/project.js'

export const BASEMAPS = {
  osm: {
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  light: {
    label: 'Carto Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  dark: {
    label: 'Carto Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  imagery: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri',
    maxZoom: 19,
  },
}

export default function MapCanvas({
  project,
  dispatch,
  tool,
  editing,
  selectedStopId,
  onSelectStop,
  onBbox,
  focus,
  basemap,
  insertAt,
  onInserted,
}) {
  const hostRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef({})
  const tileRef = useRef(null)
  const stateRef = useRef({})
  stateRef.current = { project, dispatch, tool, editing, onSelectStop, onBbox, insertAt, onInserted }

  // --- map bootstrap
  useEffect(() => {
    const map = L.map(hostRef.current, {
      center: project.mapView.center,
      zoom: project.mapView.zoom,
      zoomControl: true,
      preferCanvas: false,
    })
    mapRef.current = map
    layersRef.current = {
      routes: L.layerGroup().addTo(map),
      stops: L.layerGroup().addTo(map),
      vias: L.layerGroup().addTo(map),
      bbox: L.layerGroup().addTo(map),
      drag: L.layerGroup().addTo(map),
    }

    let moveTimer = null
    map.on('moveend', () => {
      clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        const c = map.getCenter()
        stateRef.current.dispatch({
          type: 'setMapView',
          view: { center: [c.lat, c.lng], zoom: map.getZoom() },
        })
      }, 600)
    })

    map.on('click', (e) => {
      const { tool: t, dispatch: d } = stateRef.current
      if (t === 'addStop') {
        const stop = {
          id: `s_manual_${Date.now().toString(36)}`,
          name: 'New stop',
          lat: e.latlng.lat,
          lon: e.latlng.lng,
          kind: 'bus',
          refs: [],
          manual: true,
        }
        d({ type: 'addStop', stop })
        stateRef.current.onSelectStop?.(stop.id)
      }
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- basemap
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileRef.current) tileRef.current.remove()
    const cfg = BASEMAPS[basemap] || BASEMAPS.osm
    tileRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map)
    tileRef.current.bringToBack()
  }, [basemap])

  // --- bounding box drawing
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    if (tool !== 'bbox') return undefined

    let start = null
    let rect = null
    const container = map.getContainer()
    container.style.cursor = 'crosshair'
    map.dragging.disable()
    map.boxZoom.disable()

    const onDown = (e) => {
      start = e.latlng
      rect = L.rectangle(L.latLngBounds(start, start), {
        color: '#2b6cff',
        weight: 2,
        dashArray: '6 4',
        fillOpacity: 0.08,
      }).addTo(layersRef.current.bbox)
    }
    const onMove = (e) => {
      if (!start || !rect) return
      rect.setBounds(L.latLngBounds(start, e.latlng))
    }
    const onUp = (e) => {
      if (!start) return
      const bounds = L.latLngBounds(start, e.latlng)
      start = null
      if (bounds.getNorth() - bounds.getSouth() < 1e-5) {
        rect?.remove()
        rect = null
        return
      }
      stateRef.current.onBbox?.([
        bounds.getSouth(),
        bounds.getWest(),
        bounds.getNorth(),
        bounds.getEast(),
      ])
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    return () => {
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      map.dragging.enable()
      map.boxZoom.enable()
      container.style.cursor = ''
    }
  }, [tool])

  // --- persistent bbox rectangle
  useEffect(() => {
    const layer = layersRef.current.bbox
    if (!layer) return
    layer.clearLayers()
    if (!project.bbox) return
    const [s, w, n, e] = project.bbox
    L.rectangle(
      [
        [s, w],
        [n, e],
      ],
      { color: '#2b6cff', weight: 2, dashArray: '6 4', fill: false },
    ).addTo(layer)
  }, [project.bbox])

  // --- focus (search results / fit to data)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    if (focus.bbox) {
      map.fitBounds([
        [focus.bbox[0], focus.bbox[1]],
        [focus.bbox[2], focus.bbox[3]],
      ])
    } else if (focus.center) {
      map.setView(focus.center, focus.zoom || 15)
    }
  }, [focus])

  const activeDir = editing ? project.routes.find((r) => r.id === editing.routeId)?.dirs[editing.dirKey] : null

  // --- routes
  useEffect(() => {
    const map = mapRef.current
    const layer = layersRef.current.routes
    if (!map || !layer) return
    layer.clearLayers()

    for (const route of project.routes) {
      if (route.visible === false) continue
      for (const dirKey of ['fwd', 'bwd']) {
        const dir = route.dirs[dirKey]
        if (!dir) continue
        const isActive = editing && editing.routeId === route.id && editing.dirKey === dirKey
        const dim = editing && !isActive
        for (let i = 0; i < dir.legs.length; i++) {
          const leg = dir.legs[i]
          const a = project.stops.find((s) => s.id === dir.stopIds[i])
          const b = project.stops.find((s) => s.id === dir.stopIds[i + 1])
          if (!a || !b) continue
          const coords = leg.coords || [
            [a.lat, a.lon],
            [b.lat, b.lon],
          ]
          const line = L.polyline(coords, {
            color: route.color,
            weight: isActive ? 7 : 4.5,
            opacity: dim ? 0.35 : 0.9,
            dashArray: leg.status === 'road' ? null : '8 6',
            interactive: true,
            bubblingMouseEvents: false,
            // a fat invisible line makes the drag target easier to hit
          }).addTo(layer)
          if (dirKey === 'bwd') {
            line.setStyle({ dashArray: leg.status === 'road' ? '12 8' : '8 6' })
          }
          line.bindTooltip(
            `${route.number} ${route.name} · ${dirKey === 'fwd' ? 'outbound' : 'return'}${
              leg.status === 'road' ? '' : ` · ${leg.status}`
            }`,
            { sticky: true },
          )

          if (isActive) {
            attachLegDragging(map, line, layersRef.current.drag, stateRef, {
              routeId: route.id,
              dirKey,
              index: i,
              leg,
              coords,
            })
            line.on('contextmenu', (e) => {
              L.DomEvent.stop(e)
              stateRef.current.dispatch({
                type: 'resetLeg',
                routeId: route.id,
                dirKey,
                index: i,
              })
            })
          }
        }
      }
    }
  }, [project.routes, project.stops, editing])

  // --- via handles for the direction being edited
  useEffect(() => {
    const layer = layersRef.current.vias
    if (!layer) return
    layer.clearLayers()
    if (!editing || !activeDir) return
    activeDir.legs.forEach((leg, index) => {
      leg.vias.forEach((via, viaIndex) => {
        const marker = L.marker(via, {
          draggable: true,
          icon: L.divIcon({ className: 'via-handle', iconSize: [12, 12] }),
          title: 'Drag to move this detour point · right-click to remove',
        }).addTo(layer)
        marker.on('dragend', () => {
          const p = marker.getLatLng()
          stateRef.current.dispatch({
            type: 'updateVia',
            routeId: editing.routeId,
            dirKey: editing.dirKey,
            index,
            viaIndex,
            via: [p.lat, p.lng],
          })
        })
        marker.on('contextmenu', (e) => {
          L.DomEvent.stop(e)
          stateRef.current.dispatch({
            type: 'updateVia',
            routeId: editing.routeId,
            dirKey: editing.dirKey,
            index,
            viaIndex,
            via: null,
          })
        })
      })
    })
  }, [activeDir, editing])

  // --- stops
  const stopMeta = useMemo(() => {
    const map = new Map()
    for (const stop of project.stops) {
      map.set(stop.id, routesAtStop(project, stop.id).length)
    }
    return map
  }, [project.stops, project.routes])

  useEffect(() => {
    const layer = layersRef.current.stops
    if (!layer) return
    layer.clearLayers()
    const sequence = new Map()
    if (activeDir) {
      activeDir.stopIds.forEach((id, i) => {
        const list = sequence.get(id) || []
        list.push(i + 1)
        sequence.set(id, list)
      })
    }

    for (const stop of project.stops) {
      const inRoute = sequence.get(stop.id)
      const served = stopMeta.get(stop.id) || 0
      const selected = stop.id === selectedStopId
      let marker
      if (inRoute) {
        marker = L.marker([stop.lat, stop.lon], {
          icon: L.divIcon({
            className: 'stop-seq',
            html: `<span>${inRoute.join(',')}</span>`,
            iconSize: [22, 22],
          }),
          zIndexOffset: 500,
        })
      } else {
        marker = L.circleMarker([stop.lat, stop.lon], {
          radius: selected ? 8 : served ? 6 : 4.5,
          color: selected ? '#2b6cff' : served ? '#111' : '#555',
          weight: selected ? 3 : 1.5,
          fillColor: served ? '#ffd84d' : '#fff',
          fillOpacity: 1,
        })
      }
      marker.addTo(layer)
      marker.bindTooltip(stop.name, { direction: 'top', offset: [0, -6] })
      marker.on('click', (e) => {
        L.DomEvent.stop(e)
        const { editing: ed, dispatch: d, onSelectStop: sel, insertAt: ins } = stateRef.current
        sel?.(stop.id)
        if (ins) {
          d({ type: 'insertStop', ...ins, stopId: stop.id })
          stateRef.current.onInserted?.()
          return
        }
        if (ed) {
          d({ type: 'appendStop', routeId: ed.routeId, dirKey: ed.dirKey, stopId: stop.id })
        }
      })
    }
  }, [project.stops, activeDir, selectedStopId, stopMeta])

  return <div ref={hostRef} className="map-host" />
}

// Dragging a leg inserts (or moves) a via point so the leg follows another road.
function attachLegDragging(map, line, dragLayer, stateRef, info) {
  line.on('mousedown', (e) => {
    if (stateRef.current.tool === 'bbox') return
    L.DomEvent.stop(e)
    map.dragging.disable()
    const ghost = L.circleMarker(e.latlng, {
      radius: 7,
      color: '#2b6cff',
      fillColor: '#fff',
      fillOpacity: 1,
      weight: 3,
    }).addTo(dragLayer)
    const preview = L.polyline([e.latlng, e.latlng], {
      color: '#2b6cff',
      weight: 2,
      dashArray: '4 4',
    }).addTo(dragLayer)

    const onMove = (ev) => {
      ghost.setLatLng(ev.latlng)
      preview.setLatLngs([e.latlng, ev.latlng])
    }
    const onUp = (ev) => {
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      map.dragging.enable()
      dragLayer.clearLayers()
      const moved = map.latLngToLayerPoint(ev.latlng).distanceTo(map.latLngToLayerPoint(e.latlng))
      if (moved < 6) return
      // Where along the leg did the drag start? Vias before that point keep
      // their order, so the new one slots in right after them.
      const grabIndex = closestSegmentIndex(info.coords, [e.latlng.lat, e.latlng.lng])
      const splits = info.leg.viaSplits || []
      let viaIndex = splits.filter((s) => s <= grabIndex).length
      viaIndex = Math.min(viaIndex, info.leg.vias.length)
      stateRef.current.dispatch({
        type: 'addVia',
        routeId: info.routeId,
        dirKey: info.dirKey,
        index: info.index,
        viaIndex,
        via: [ev.latlng.lat, ev.latlng.lng],
      })
    }
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
  })
}
