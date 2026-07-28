# Transit Map Generator

Draw bus, tram and rail routes on top of real OpenStreetMap data, then let the app turn them
into a clean, London-style schematic diagram.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

Everything runs in the browser. The project is kept in `localStorage` and can be exported to
JSON at any time.

## Workflow

### 1. Map data

- **Find a place** — search by name (Nominatim) and jump there.
- **Draw bounding box** — drag a rectangle over the area you care about.
- **Load stops in area** — queries Overpass for stops inside the box. Choose which kinds to
  fetch (bus, tram, rail/metro, ferry). Platforms on opposite sides of a street that share a
  name are merged into a single stop within the configurable radius (45 m by default), which is
  what you want for a schematic.
- Stops can also be placed by hand, renamed inline, and deleted.

### 2. Routes

- **New route** gives you a number, name, colour, mode and a road-snapping toggle.
- Pick **Outbound**, then click the stops on the map in order. Each section between two stops is
  routed along the road network (OSRM) automatically.
- **Wrong road?** Drag the drawn line onto the road you want — a detour point is inserted and the
  section is re-routed through it. Detour points can be dragged again or removed with a
  right-click; right-clicking the line resets the section.
- **Return direction**: *Mirror outbound as return* reuses the outbound geometry backwards, or
  *Draw return manually* lets you click a different sequence (different streets, extra stops —
  whatever the real route does).
- Reorder or remove stops from the sidebar, or arm **⤒** on a row and click a stop on the map to
  insert it mid-route.

### 3. Schematic

Switching to the schematic view generates the diagram automatically:

- **Angle increments** — 90°, 60°, 45° (the classic London grid), 30°, 22.5° or 15°.
- **Corner radius** and **corner softness**, from a crisp circular arc to a soft, organic,
  squircle-like bend.
- **Regular and transfer stop markers** — ticks, dots, rings, squares or a capsule spanning all
  the lines at an interchange, each with its own size, fill, outline width and colour.
- **Parallel corridors** — routes that share the same section of a corridor are drawn side by
  side with a consistent ordering instead of overlapping.
- **Direction arrows** — a section used by a route in only one direction (because the return
  runs elsewhere) is marked with arrows pointing the way of travel.
- Labels, route number badges at the termini, a legend, background colour and line casing are
  all adjustable, and any station can be dragged by hand; **Reset dragged stops** returns them to
  the solver.
- Export the result as **SVG** or **PNG**, or the whole project as JSON.

## How the schematic layout works

`src/schematic/layout.js` is a hill-climbing optimiser in the spirit of Stott & Rodgers' metro
map algorithm. It starts from the real geography (scaled so the median gap between stops equals
the configured spacing) and repeatedly offers each station a set of candidate positions — moves
along the allowed bearings, and exact snaps onto an allowed bearing from a neighbour. A move is
kept when it lowers a weighted cost built from:

- deviation of each edge from the nearest allowed angle,
- edge lengths (short edges are punished harder than long ones),
- straightness of a line running through a station,
- station/station and station/edge clearance,
- edge crossings,
- and how far an edge has drifted from its true geographic bearing.

The solver runs in animation-frame slices with a progress readout, and stops early once no
station wants to move. *Angle strictness* scales the angle term; *New variation* reshuffles the
random order for a different result; manually dragged stations are pinned and the rest of the
network is optimised around them.

## Layout of the code

| Path | What lives there |
| --- | --- |
| `src/state/project.js` | The whole project document + reducer (stops, routes, schematic settings) |
| `src/services/` | Overpass (stops), Nominatim (search), OSRM (road routing + cache) |
| `src/map/MapCanvas.jsx` | Leaflet map: bounding box, stop layer, route drawing, drag-to-reroute |
| `src/schematic/graph.js` | Routes → network graph (nodes, shared edges, direction usage) |
| `src/schematic/layout.js` | The angle-snapping layout solver |
| `src/schematic/build.js` | Parallel offsets, corners, markers, arrows, label placement |
| `src/schematic/SchematicView.jsx` | SVG renderer, pan/zoom, station dragging, export |
| `src/ui/` | Sidebar panels |
| `src/sample/demo.js` | A small fictional network for trying things out offline |

## Third-party services

The app talks to public community services: **Overpass** for stop data, **Nominatim** for search,
**OSRM's demo server** for road routing, and OSM/CARTO/Esri tiles. They are rate-limited and
occasionally busy — when routing fails, the section falls back to a straight line and says so, and
you can retry it with **↻**. Routed sections are cached locally so editing does not re-query the
same geometry.
