# Signage Audit

A field tool for auditing signage against a CAD plan, on an iPhone or iPad.

Load a DXF of the site, and every sign on it becomes a tappable marker on the
drawing. Tap one to record notes, photograph each face, and tick it off. Signs
missing from the drawing can be dropped onto the plan on site and are marked
"proposed" until someone decides otherwise.

It is a static web app with no backend. Everything runs on the device.

## Using it

1. **Open a DXF plan.** The importer shows the blocks it found and asks which
   are *markers* (where a sign physically is) and which are *data* callouts
   (the table holding its number) — a block can be both. It preselects its best
   guess and draws the result on the plan, live, so you can see what the audit
   will look like before committing to it.
2. **Walk the site.** Tap a sign on the plan, or find it in the Signs list.
   Set how many faces it has and which way each one looks — one photo slot
   appears per face, and each face draws as a tick on the plan. Notes and
   photos save as you type; there is no save button.
3. **Filter as you go.** By type — the layer the sign sits on, e.g.
   `_DIRECTIONAL_SIGN` — and by status. Filters apply to the plan as well as
   the list, so you can show just the ones still to do.
4. **Save your work out.** *Save project file* produces a single `.zip`
   containing the drawing, every note and every photo. It goes to Files,
   iCloud, AirDrop or Mail like any other file, and opens straight back into
   the app on another device. *Export CSV* gives you the sign table for a
   report.

### Sign states

| State | Meaning |
| --- | --- |
| Not checked | Untouched — the starting state for everything from the CAD file |
| Checked | Verified on site |
| Needs review | Something is wrong or unclear; come back to it |
| Proposed | Added on site, not on the original drawing |

## Working offline

Audits happen in basements, car parks and back-of-house corridors, so the app
is built to need no signal at all:

- The whole app is precached by a service worker on first load, so it starts
  with no network.
- Projects, notes and photos live in IndexedDB on the device. Nothing is ever
  uploaded.
- Photos are downscaled to 1600px JPEG as they are taken. A raw iPhone photo is
  3–5MB; a 200-sign audit at that size would exhaust the storage quota.

**On iOS, add it to your Home Screen.** Tap Share → Add to Home Screen. This
matters for two reasons: a home-screen app opens full screen and launches
reliably offline, and iOS Safari otherwise clears a site's storage after about
seven days without a visit. Home-screen apps are exempt. The app shows a
one-off prompt about this.

Export a project file at the end of each day regardless. It is the only copy
that survives a lost or wiped device, and the header shows "not exported" when
there is unsaved-out work.

## Hosting

New to GitHub? **[SETUP.md](SETUP.md) walks through getting this online and onto
your phone, click by click, entirely in a browser.** The rest of this section is
the short version.

`.github/workflows/deploy.yml` lints, tests and builds on every push, and
publishes to GitHub Pages from the repository's **default branch** — whatever
it happens to be called — or on demand from the Actions tab.

One-time setup: in the repository settings, under **Pages**, set **Source** to
**GitHub Actions**.

### Moving it to another repository

Nothing is tied to this repository's name. A project site is served from
`https://<user>.github.io/<repo>/`, and `vite.config.js` reads that prefix from
`GITHUB_REPOSITORY`, which GitHub Actions sets for you. So:

```sh
git remote set-url origin git@github.com:<you>/<new-repo>.git
git push -u origin HEAD
```

Then set Pages → Source → GitHub Actions on the new repository, and make sure
the branch you pushed is its default branch. Nothing to edit.

To start with clean history instead, copy the working tree into a fresh clone
and commit it as one commit — the app has no dependency on this repo's history.

For a custom domain served from the root, or any other host, set the prefix
explicitly at build time:

```sh
BASE_PATH=/ npm run build
```

## How signs are found

Signage packages separate the sign from its data: a small rotated symbol where
the sign stands, and a table of attributes parked in clear space, joined by a
leader line. The importer recovers that link from the leader — matching each
marker to the callout its leader reaches — which is exact where guessing is not.
Two cheaper approaches were tried against a real drawing and rejected: matching
a marker's block name to the callout's sign code cannot tell two instances of
the same block apart, and nearest-callout-by-distance mispairs in dense areas.

Signs drawn as loose geometry rather than blocks (a circle with a centre point)
are found by shape. Only their position is taken — how many faces they have is
set per sign in the app, because side letters vary in count and placement
between drawings and a wrong guess is only discovered on site.

A marker whose callout cannot be found still imports, flagged **needs review**.
It is on the drawing; someone has to resolve it.

## File format support

**DXF only, ASCII.** DWG is a proprietary binary format that no browser can
read — export to DXF from AutoCAD or BricsCAD first.

Supported: `LINE`, `LWPOLYLINE`, `POLYLINE` (including bulged arc segments),
`CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE`, `HATCH` (both boundary forms, solid fills
painted), `SOLID`, `3DFACE`, `POINT`, `TEXT`, `MTEXT`, `LEADER`, `MULTILEADER`,
and `INSERT` block references nested to any reasonable depth. `WIPEOUT` is
parsed and deliberately not drawn — it is a mask, and painting it would black
out the plan.

Several of these are gaps in the underlying `dxf-parser` library, filled by the
app's own handlers in `src/dxf/handlers.js`. The library also *throws* on a
zero-vertex polyline, which loses the entire file, so its `LWPOLYLINE` handler
is replaced with a tolerant one, and a truncated file is closed off and re-read
rather than abandoned.

**The import summary is honest about what it could not read.** A raw census of
the file is taken before parsing, independently of what the library surfaces, so
anything unsupported is named rather than silently dropped.

## Development

```sh
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host  # also reachable from a phone on the same network
npm test             # parses fixtures/sample-plan.dxf and checks the results
npm run lint
npm run build
npm run preview      # serve the production build, service worker included
```

`npm test` also accepts a path, which is the quickest way to see how a real
drawing would be imported without opening the app:

```sh
node scripts/check-import.mjs ~/Desktop/level-2.dxf
```

`npm run fixture` regenerates the sample plan; `npm run icons` regenerates the
PWA icons.

### Layout

```
src/dxf/        parse.js      dxf-parser wrapper, error messages, recovery
                handlers.js   entity types the library does not support
                audit.js      raw census of the file, for honest diagnostics
                flatten.js    blocks -> world coordinates -> baked SVG paths
                geometry.js   transforms and entity -> path conversion
                link.js       matching sign markers to their data callouts
                detectSigns.js the import recipe and the signs it produces
src/map/        Plan canvas: pan/zoom viewport, baked layer paths, markers
src/state/      IndexedDB, the store, project file import/export
src/ui/         Import wizard, sign panel, sides editor, list, filters
```

Two design decisions shape most of the code:

- **Geometry is baked at import time** into one SVG path per layer and colour.
  A 40,000-entity drawing becomes a couple of dozen DOM nodes, which is what
  makes it usable on a phone.
- **The mutable audit data is stored apart from the drawing.** Autosave fires
  on every keystroke, and re-serialising megabytes of path data each time would
  stall the UI.
- **Nothing is guessed silently.** Where the app has to infer something — which
  blocks are signs, which callout belongs to which marker — it shows the result
  on the plan first and lets you correct it.
