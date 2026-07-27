# Algach

A macOS app that turns planned timetables into print-ready schedule sheets — one for every stop.

A route has one timetable, but the same trip reaches each of its shelters at a different minute, so every
shelter in a city needs its own sheet, each differing from its neighbour by a minute or two. Setting
thousands of those by hand, and proofreading hundreds of thousands of figures, is not work a person should
be doing.

## What it does

**Reads what agencies already have.** Excel, CSV, a pasted list, or a GTFS feed. Column meanings are
guessed from the headings and can be corrected. Problems are reported per row rather than failing the
import.

**Works out how to describe the service.** Regular stretches of the day become a headway — *06–22, every
10–15 minutes* — while the rest is listed, or set out hour by hour once there is too much to list. A
typical line falls out as scattered early departures, a headway through the day, and scattered departures
again at night, which is the shape these sheets have always had.

Kinds of day are analysed *together*, not one at a time. Taken alone, a route's weekdays can read as a
headway while its weekends read as an hourly grid; laid side by side those two answers share no rows and
the block fills with holes. The shape of the day is settled once, across all of them, and each column is
filled against it.

**Lays out to any panel.** The number of route blocks per row is arithmetic, not a set of special cases:

| Panel | Result |
|---|---|
| 200 × 700 mm, tall | one column, blocks stacked |
| 900 × 300 mm, wide | five columns, blocks across |
| 420 × 420 mm, square | between the two |

Nothing in the code knows what "portrait" means. Narrow the nominal block width and more fit per row, with
the type, gutters and rules inside each block scaling together — or set the number per row directly.

**Keeps the schedule clear of the header and footer.** Those are reserved bands, not overlays: the content
area is what remains after subtracting them. Raise the footer and the blocks reflow upward rather than
being drawn over.

**Exports print-ready PDF.** Vector text with embedded, subset fonts, or outlines when nothing should be
left for a RIP to substitute. Bleed, crop marks, and correct TrimBox and BleedBox. One file per stop, or
one file for the network.

## How it is put together

The layout engine measures text against real font metrics rather than the DOM, and emits a flat list of
positioned primitives in millimetres. The SVG preview and the PDF writer consume that same list, so the
screen and the press agree by construction rather than by resemblance — and the engine runs headless,
under test, without a browser.

```
Document ──► layout() ──► Primitive[] ──┬──► renderSvg()  → preview and editing
                                        └──► renderPdf()  → the printer's file
```

```
src/
  model/      documents, master template, service-day arithmetic
  import/     xlsx · csv · paste · gtfs → Timetable
  segment/    departures → how the day should be described
  layout/     font metrics, route blocks, bands, flow, auto-fit
  render/     svg.ts (preview) · pdf.ts (export)
  ui/         stop list · canvas · inspector
src-tauri/    the native shell: window, menu, file dialogs
```

Timetable and template are held apart. Re-importing a fresh season replaces the departures and leaves the
design — and every per-stop edit layered over it — untouched.

## Running it

```bash
npm install
npm run dev          # the app in a browser, for development
npm run tauri dev    # the real window, on a Mac
npm run tauri build  # a signed .app and .dmg
```

The layout engine, the importers and the PDF writer are platform-independent and run anywhere. Building
the `.app` itself needs macOS with Xcode command line tools and a Rust toolchain.

## Checking it

```bash
npm test             # engine, importers, segmentation, layout geometry
npm run proof        # render the demo network across a spread of panel sizes
npm run proof:png    # …and rasterise them to look at
npx tsx scripts/proof-pdf.ts && npx tsx scripts/check-pdf.ts
node scripts/check-app.mjs   # drives the running app, needs `npm run dev`
```

`check-pdf.ts` reads the PDF object graph rather than grepping the bytes — pdf-lib packs objects into
compressed streams, so a raw search finds nothing whether or not a font is really embedded. It confirms
fonts are embedded and subset, that outlined export leaves none behind, and that the trim and bleed boxes
say where to cut.

## Fonts

IBM Plex Sans and IBM Plex Sans Condensed ship with the app, under the SIL Open Font Licence (`fonts/OFL.txt`).
Both carry Latin and Cyrillic and have tabular figures, which is why columns of departure times align
without any per-glyph nudging. Brand faces can be added at runtime and are embedded into the PDF the same way.
