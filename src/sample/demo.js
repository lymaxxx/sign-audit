// A small fictional network so the app can be tried out (and tested) without
// hitting OpenStreetMap. Coordinates sit on a tidy grid near Berlin.

import { defaultSchematic, makePlatform, PALETTE, stopFromPlatforms } from '../state/project.js'

const STOPS = [
  ['Nordpark', 52.545, 13.372],
  ['Hafenallee', 52.545, 13.396],
  ['Kastanienhöhe', 52.545, 13.42],
  ['Museumsplatz', 52.533, 13.36],
  ['Alte Brauerei', 52.533, 13.384],
  ['Rathaus', 52.533, 13.408],
  ['Sternwarte', 52.533, 13.432],
  ['Westbahnhof', 52.521, 13.36],
  ['Lindenmarkt', 52.521, 13.372],
  ['Universität', 52.521, 13.384],
  ['Hauptbahnhof', 52.521, 13.396],
  ['Dom', 52.521, 13.408],
  ['Ostkreuz', 52.521, 13.42],
  ['Messehallen', 52.521, 13.432],
  ['Werksiedlung', 52.509, 13.372],
  ['Südbrücke', 52.509, 13.396],
  ['Klinikum', 52.509, 13.42],
  ['Seepromenade', 52.497, 13.384],
  ['Flughafen Süd', 52.497, 13.408],
  ['Gartenstadt', 52.497, 13.432],
]

const ROUTES = [
  {
    number: '1',
    name: 'Westbahnhof – Messehallen',
    fwd: ['Westbahnhof', 'Lindenmarkt', 'Universität', 'Hauptbahnhof', 'Dom', 'Ostkreuz', 'Messehallen'],
  },
  {
    number: '2',
    name: 'Nordpark – Flughafen Süd',
    fwd: ['Nordpark', 'Alte Brauerei', 'Universität', 'Hauptbahnhof', 'Südbrücke', 'Seepromenade', 'Flughafen Süd'],
    // the return leg runs via the cathedral instead — one-way sections get arrows
    bwd: ['Flughafen Süd', 'Südbrücke', 'Dom', 'Hauptbahnhof', 'Universität', 'Alte Brauerei', 'Nordpark'],
  },
  {
    number: '7',
    name: 'Museumsplatz – Klinikum',
    fwd: ['Museumsplatz', 'Lindenmarkt', 'Hauptbahnhof', 'Dom', 'Ostkreuz', 'Klinikum'],
  },
  {
    number: '12',
    name: 'Kastanienhöhe – Gartenstadt',
    fwd: ['Kastanienhöhe', 'Sternwarte', 'Messehallen', 'Ostkreuz', 'Klinikum', 'Gartenstadt'],
  },
  {
    number: '23',
    name: 'Rathaus – Seepromenade',
    fwd: ['Rathaus', 'Dom', 'Hauptbahnhof', 'Lindenmarkt', 'Werksiedlung', 'Seepromenade'],
  },
  {
    number: 'N4',
    name: 'Hafenallee – Südbrücke',
    fwd: ['Hafenallee', 'Rathaus', 'Dom', 'Hauptbahnhof', 'Südbrücke'],
  },
]

export function demoProject() {
  const stops = STOPS.map(([name, lat, lon], i) =>
    stopFromPlatforms(
      [makePlatform({ id: `demo_p${i}`, name, lat, lon, kind: 'bus' })],
      `demo_s${i}`,
    ),
  )
  // Hauptbahnhof gets two platforms (one per side of the street) so the
  // platform handling is visible in the demo: the two directions call at
  // different kerbs but the schematic still shows a single station.
  const hbf = stops.find((s) => s.name === 'Hauptbahnhof')
  hbf.platforms.push(
    makePlatform({
      id: 'demo_p10b',
      name: 'Hauptbahnhof (south)',
      lat: hbf.lat - 0.0004,
      lon: hbf.lon + 0.0004,
      kind: 'bus',
    }),
  )

  const byName = new Map(stops.map((s) => [s.name, s]))
  // which platform each direction calls at: outbound uses the first, the
  // return uses the last (a no-op for single-platform stops)
  const platformFor = (name, dirKey) => {
    const stop = byName.get(name)
    const list = stop.platforms
    return dirKey === 'bwd' ? list[list.length - 1].id : list[0].id
  }

  const legsFor = (names) =>
    names.slice(1).map((_, i) => ({
      vias: [],
      status: 'straight',
      coords: [
        [byName.get(names[i]).lat, byName.get(names[i]).lon],
        [byName.get(names[i + 1]).lat, byName.get(names[i + 1]).lon],
      ],
    }))

  const routes = ROUTES.map((r, i) => ({
    id: `demo_r${i}`,
    number: r.number,
    name: r.name,
    color: PALETTE[i % PALETTE.length],
    mode: 'bus',
    snap: false,
    visible: true,
    dirs: {
      fwd: {
        stopIds: r.fwd.map((n) => byName.get(n).id),
        platformIds: r.fwd.map((n) => platformFor(n, 'fwd')),
        legs: legsFor(r.fwd),
      },
      bwd: r.bwd
        ? {
            stopIds: r.bwd.map((n) => byName.get(n).id),
            platformIds: r.bwd.map((n) => platformFor(n, 'bwd')),
            legs: legsFor(r.bwd),
          }
        : {
            stopIds: r.fwd.slice().reverse().map((n) => byName.get(n).id),
            platformIds: r.fwd.slice().reverse().map((n) => platformFor(n, 'bwd')),
            legs: legsFor(r.fwd.slice().reverse()),
          },
    },
  }))

  return {
    version: 1,
    name: 'Demo network',
    bbox: [52.49, 13.35, 52.55, 13.44],
    stops,
    routes,
    schematic: { ...defaultSchematic },
    overrides: {},
    mapView: { center: [52.521, 13.396], zoom: 13 },
  }
}
