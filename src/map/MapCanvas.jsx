import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { closestSegmentIndex } from '../lib/geo.js'
import {
  dirEntries,
  entryPoint,
  makePlatform,
  platformLabelFor,
  routesAtStop,
  stopFromPlatforms,
} from '../state/project.js'

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
  onLinkStop,
}) {
  const hostRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef({})
  const tileRef = useRef(null)
  const stateRef = useRef({})
  stateRef.current = {
    project,
    dispatch,
    tool,
    editing,
    onSelectStop,
    onBbox,
    insertAt,
    onInserted,
    onLinkStop,
  }

  // --- map bootstrap
  useEffect(() => {
    const map = L.map(hostRef.current, {
      center: project.mapView.center,
      zoom: project.mapView.zoom,
      zoomControl: true,
      preferCanvas: false,
    })
    mapRef.current = map
    // Explicit stacking: stop dots must win clicks over route lines, and the
    // section being edited must sit above every other route.
    map.createPane('routesPane').style.zIndex = 400
    map.createPane('activeRoutePane').style.zIndex = 430
    map.createPane('stopsPane').style.zIndex = 460
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
        const stop = stopFromPlatforms([
          makePlatform({ name: 'New stop', lat: e.latlng.lat, lon: e.latlng.lng, kind: 'bus' }),
        ])
        stop.name = 'New stop'
        stop.manual = true
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
          const entries = dirEntries(dir)
          const a = entryPoint(project, entries[i] || {})
          const b = entryPoint(project, entries[i + 1] || {})
          if (!a || !b) continue
          const coords = leg.coords || [a, b]
          const line = L.polyline(coords, {
            pane: isActive ? 'activeRoutePane' : 'routesPane',
            color: route.color,
            weight: isActive ? 7 : 4.5,
            opacity: dim ? 0.35 : 0.9,
            dashArray: leg.status === 'road' ? null : '8 6',
            interactive: !isActive,
            bubblingMouseEvents: false,
          }).addTo(layer)
          if (dirKey === 'bwd') {
            line.setStyle({ dashArray: leg.status === 'road' ? '12 8' : '8 6' })
          }
          const tooltip = `${route.number} ${route.name} · ${
            dirKey === 'fwd' ? 'outbound' : 'return'
          }${leg.status === 'road' ? '' : ` · ${leg.status}`}`
          if (!isActive) line.bindTooltip(tooltip, { sticky: true })

          if (isActive) {
            // A fat transparent line on top makes the section easy to grab.
            const hit = L.polyline(coords, {
              pane: 'activeRoutePane',
              color: route.color,
              weight: 20,
              opacity: 0,
              interactive: true,
              bubblingMouseEvents: false,
            }).addTo(layer)
            hit.bindTooltip(`${tooltip} — click to add a waypoint`, { sticky: true })
            attachLegEditing(map, hit, line, layersRef.current.drag, stateRef, {
              routeId: route.id,
              dirKey,
              index: i,
              leg,
              coords,
            })
            hit.on('contextmenu', (e) => {
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
          icon: L.divIcon({ className: 'via-handle', iconSize: [14, 14] }),
          title: 'Waypoint — drag to move, right-click to remove',
          zIndexOffset: 800,
        }).addTo(layer)
        marker.bindTooltip('Waypoint — drag to move, right-click to remove', {
          direction: 'top',
          offset: [0, -8],
        })
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

    // Which platform (or, when unspecified, which stop) carries each sequence
    // number of the direction being edited.
    const byPlatform = new Map()
    const byStop = new Map()
    if (activeDir) {
      dirEntries(activeDir).forEach((entry, i) => {
        const key = entry.platformId || entry.stopId
        const target = entry.platformId ? byPlatform : byStop
        const list = target.get(key) || []
        list.push(i + 1)
        target.set(key, list)
      })
    }

    for (const stop of project.stops) {
      const served = stopMeta.get(stop.id) || 0
      const selected = stop.id === selectedStopId
      const platforms = stop.platforms?.length ? stop.platforms : [{ id: null, ...stop }]

      // A hairline ring around the whole stop makes it obvious that several
      // platforms belong together.
      if (platforms.length > 1) {
        L.circleMarker([stop.lat, stop.lon], {
          pane: 'stopsPane',
          radius: 3,
          color: selected ? '#2b6cff' : '#8892a6',
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.9,
          interactive: false,
        }).addTo(layer)
        for (const platform of platforms) {
          L.polyline(
            [
              [stop.lat, stop.lon],
              [platform.lat, platform.lon],
            ],
            {
              pane: 'stopsPane',
              color: '#8892a6',
              weight: 1,
              opacity: 0.55,
              interactive: false,
              dashArray: '2 3',
            },
          ).addTo(layer)
        }
      }

      platforms.forEach((platform, pIndex) => {
        const numbers = [
          ...(byPlatform.get(platform.id) || []),
          // an entry with no platform recorded belongs to the first platform
          ...(pIndex === 0 ? byStop.get(stop.id) || [] : []),
        ].sort((a, b) => a - b)

        let marker
        if (numbers.length) {
          marker = L.marker([platform.lat, platform.lon], {
            icon: L.divIcon({
              className: 'stop-seq',
              html: `<span>${numbers.join(',')}</span>`,
              iconSize: [22, 22],
            }),
            zIndexOffset: 500,
          })
        } else {
          marker = L.circleMarker([platform.lat, platform.lon], {
            pane: 'stopsPane',
            radius: selected ? 7 : served ? 5.5 : 4.5,
            color: selected ? '#2b6cff' : served ? '#111' : '#555',
            weight: selected ? 3 : 1.5,
            fillColor: served ? '#ffd84d' : '#fff',
            fillOpacity: 1,
          })
        }
        marker.addTo(layer)
        const label = platformLabelFor(stop, platform)
        marker.bindTooltip(label, { direction: 'top', offset: [0, -6] })
        marker.on('click', (e) => {
          L.DomEvent.stop(e)
          const {
            editing: ed,
            dispatch: d,
            onSelectStop: sel,
            insertAt: ins,
            tool: t,
            onLinkStop: link,
          } = stateRef.current
          sel?.(stop.id)
          if (t === 'link') {
            link?.(stop.id)
            return
          }
          if (ins) {
            d({ type: 'insertStop', ...ins, stopId: stop.id, platformId: platform.id })
            stateRef.current.onInserted?.()
            return
          }
          if (ed) {
            d({
              type: 'appendStop',
              routeId: ed.routeId,
              dirKey: ed.dirKey,
              stopId: stop.id,
              platformId: platform.id,
            })
          }
        })
      })
    }
  }, [project.stops, activeDir, selectedStopId, stopMeta])

  return <div ref={hostRef} className="map-host" />
}

// Editing a drawn section: clicking it drops a waypoint where you clicked, and
// dragging it drops one where you let go. Leaflet starts panning the map on the
// same mousedown, which would cancel the drag, so panning is switched off while
// the pointer is over an editable line.
function attachLegEditing(map, hit, line, dragLayer, stateRef, info) {
  const addVia = (latlng, grabLatLng) => {
    // Waypoints stay in travel order: count the ones that sit before the point
    // we grabbed.
    const grabIndex = closestSegmentIndex(info.coords, [grabLatLng.lat, grabLatLng.lng])
    const splits = info.leg.viaSplits || []
    const viaIndex = Math.min(
      splits.filter((s) => s <= grabIndex).length,
      info.leg.vias.length,
    )
    stateRef.current.dispatch({
      type: 'addVia',
      routeId: info.routeId,
      dirKey: info.dirKey,
      index: info.index,
      viaIndex,
      via: [latlng.lat, latlng.lng],
    })
  }

  let hovering = false
  hit.on('mouseover', () => {
    if (stateRef.current.tool === 'bbox') return
    hovering = true
    map.dragging.disable()
    line.setStyle({ weight: 10 })
  })
  hit.on('mouseout', () => {
    hovering = false
    map.dragging.enable()
    line.setStyle({ weight: 7 })
  })

  hit.on('click', (e) => {
    if (stateRef.current.tool === 'bbox') return
    L.DomEvent.stop(e)
    addVia(e.latlng, e.latlng)
  })

  hit.on('mousedown', (e) => {
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
    let dragged = false

    const onMove = (ev) => {
      dragged = true
      ghost.setLatLng(ev.latlng)
      preview.setLatLngs([e.latlng, ev.latlng])
    }
    const onUp = (ev) => {
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      if (!hovering) map.dragging.enable()
      dragLayer.clearLayers()
      if (!dragged) return // a plain click is handled by the click handler
      const moved = map
        .latLngToLayerPoint(ev.latlng)
        .distanceTo(map.latLngToLayerPoint(e.latlng))
      if (moved < 6) return
      addVia(ev.latlng, e.latlng)
    }
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
  })

  // Leaflet keeps the disabled state on the map, so make sure a removed line
  // never leaves panning switched off.
  hit.on('remove', () => {
    if (hovering) {
      hovering = false
      map.dragging.enable()
    }
  })
}
