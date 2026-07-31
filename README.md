# Transit Map Generator

Draw bus, tram and rail routes on top of real OpenStreetMap data, then let the app turn them
into a clean, London-style schematic diagram.

## Ready-made file

`dist-single/transit-map-generator.html` is the whole app in one self-contained file — open it
in a browser and it runs. No install, no server, no build step. Rebuild it after code changes
with `npm run build:single`.

If the browser blocks the app's calls to OpenStreetMap because the page was opened straight off
the disk (the app tells you when that happens), serve the folder over http instead — e.g.
`npx serve dist-single` — or run the dev server below.

## Running from source

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # static bundle in dist/
npm run build:single  # one self-contained .html in dist-single/
```

Everything runs in the browser. The project is kept in `localStorage` and can be exported to
JSON at any time.

## Workflow

### 1. Map data

- **Find a place** — search by name (Nominatim) and jump there.
- **Draw bounding box** — drag a rectangle over the area you care about.
- **Load stops in area** — queries Overpass for stops inside the box. Choose which kinds to
  fetch (bus, tram, rail/metro, ferry).
- **Stops and platforms** — the two sides of a street are one *stop* with two *platforms*. Records
  that share a name within the merge radius (45 m by default) are folded together, and names like
  `Market Square (east)`, `Hauptbahnhof Nord`, `High Street / Stand C` or `Рынок (север)` count as
  the same stop. Every platform keeps its own coordinates and its own dot on the map, so routes are
  traced along the correct kerb while the diagram shows a single station. A stop that legitimately
  ends in a compass word (`Flughafen Süd`) keeps its full name.
- **Merge duplicate stops** re-runs that grouping over stops already in the project — useful if you
  imported them before, or with merging switched off. Routes are rewired to the merged stops and
  keep the platform they were drawn through, so no geometry is lost.
- **Link two stops** is the manual version, for names automatic grouping can't recognise as the
  same place — the classic example is a stop with a completely different name on each side of the
  road (Gibraltar has several). Click the tool, click one stop, then click its unrelated-looking
  twin: they become one stop with both names (shown as `Name A ⇄ Name B`) and one marker on the
  schematic. **✂** in the stop list splits a link back apart.
- **Import a route from OpenStreetMap** takes a route relation's ID or its openstreetmap.org URL
  — the same relation you reach by clicking a stop there and picking a route — and brings in its
  stops plus its actual road/rail geometry (not a straight-line guess) as a ready-to-edit route.
  A `route_master` relation brings in both directions at once. Any section whose OSM ways don't
  chain together cleanly is left for the app's own routing to fill in, same as a section drawn by
  hand — you'll see a note if that happens.
- Stops can also be placed by hand, renamed inline, and deleted.

### 2. Routes

- **New route** gives you a number, name, colour, mode and a road-snapping toggle.
- Pick **Outbound**, then click the stops on the map in order. Each section between two stops is
  routed along the road network (OSRM) automatically.
- **Wrong road?** Click the drawn line to drop a **waypoint** where you clicked, or drag the line
  to where it should go. The section re-routes through the waypoint; waypoints can be dragged to
  fine-tune and right-clicked to remove, and right-clicking the line clears the section's waypoints.
- **Which platform** a call uses is shown under each stop in the sequence and can be changed from
  the dropdown — handy when the return runs along the opposite kerb.
- A section that ends up several times longer than the direct distance is flagged in amber: that
  usually means the router looped around a block, and a waypoint puts it right.
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
- **Direction arrows** — only where a route genuinely runs one way: it needs both directions
  defined, and the arrows appear on the sections whose *stops* differ (an extra stop on the
  return, say). A route drawn in one direction only, or one whose return simply takes different
  streets between the same stops, is drawn as a single plain line.
- **Rotation** turns the whole diagram around its centre, in the Orientation section (a free
  slider, or -90°/+90°/180° buttons). It's a display transform only — the layout underneath isn't
  recomputed, so dragged stations and exports stay consistent at any angle.
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
station wants to move. Every redraw actually runs the whole solve **three times** from different
random shuffles (for networks up to about 150 stations) and keeps whichever attempt has the
fewest line crossings — a single hill-climb can get stuck in a mediocre local optimum, and trying
a few more nearly always finds a tidier result without you needing to click *New variation* by
hand. A final pass also nudges stations that landed almost — but not quite — on the same row or
column onto it exactly, which is a big part of what gives the finished map its rhythm. *Angle
strictness* scales the angle term; *New variation* reshuffles the random order for a different
result; manually dragged stations are pinned and the rest of the network is optimised around
them.

## Layout of the code

| Path | What lives there |
| --- | --- |
| `src/state/project.js` | The whole project document + reducer (stops, platforms, routes, settings) |
| `src/lib/stopNames.js` | Name tidying that decides which platforms belong to the same stop |
| `src/services/` | Overpass (stops + routes), OSM route parsing, Nominatim (search), OSRM (routing + cache) |
| `src/map/MapCanvas.jsx` | Leaflet map: bounding box, platform layer, route drawing, waypoint editing |
| `src/schematic/graph.js` | Routes → network graph (nodes, shared edges, direction usage) |
| `src/schematic/layout.js` | The angle-snapping layout solver |
| `src/schematic/build.js` | Parallel offsets, corners, markers, arrows, label placement |
| `src/schematic/SchematicView.jsx` | SVG renderer, pan/zoom, station dragging, export |
| `src/ui/` | Sidebar panels |
| `src/sample/demo.js` | A small fictional network for trying things out offline |

## Third-party services

The app talks to public community services: **Overpass** for stop data and route relations,
**Nominatim** for search, **OSRM's demo server** for road routing, and OSM/CARTO/Esri tiles. They
are rate-limited and occasionally busy — when routing fails, the section falls back to a straight
line and says so, and you can retry it with **↻**. Routed sections are cached locally so editing
does not re-query the same geometry.
