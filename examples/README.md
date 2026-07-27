# Example timetables

Three CSVs the importer reads without any setting up. Open one with **Import…** and the whole demo
network appears in the stop list.

Regenerate and re-check them with `npx tsx scripts/make-examples.ts` — it writes the files and then reads
them back, because an example that does not import is worse than no example.

## A whole network, both ways

**`schedule-network-two-directions.csv`** is the shape a planning department actually hands over: every
route, every stop on it, and a `Direction` column. This is the one to copy.

```csv
Route,Mode,Direction,Terminal,Stop,Stop code,Day type,Times
1,bus,Southbound,Rosia Terminus,Market Place,101,Weekdays,07:00 07:30 08:00 …
1,bus,Northbound,Willis's Road Terminus,Market Place,101,Weekdays,07:20 07:50 …
```

Each side of a shelter becomes its own stop in the list, and its own sheet. That is not tidiness: a
vehicle reaches the two kerbs at different minutes, and someone waiting on one of them has no use for the
other's departures.

### Name the side of the road, not the route's terminal

This is the one thing worth getting right. `Direction` should say which way the traffic faces —
`Southbound`, `Towards the town centre`, `Platform B` — and every route calling at that kerb should use
the same wording.

Naming it after each route's own terminal looks natural and quietly goes wrong: routes 1 and 9 both stop
at Market Place, but if one says `Towards Rosia` and the other `Towards the Airport`, the shelter turns
into three sheets instead of two, and neither route appears beside the other.

A stop served one way only needs no `Direction` at all — leave the cell empty and it stays a single sheet.

GTFS needs nothing extra: `direction_id` and `trip_headsign` already carry this, and a stop is split only
where the feed really serves it both ways.

## The two shapes

**`schedule-minimal.csv`** — the smallest thing that works. Four columns, one row per route and kind of
day, every departure of that day in the last cell:

```csv
Route,Stop,Day type,Times
8,Aurora Cinema,Weekdays,06:11 06:23 06:35 06:47 07:00
27,Aurora Cinema,Daily,07:10 08:40 10:56 12:26
```

**`schedule-long-form.csv`** — the same shape with the optional columns filled in: mode, destination and
the streets a line runs along, which are printed on the sheet, plus a stop code used in export filenames.

**`schedule-trip-per-row.csv`** — one row per *trip*, with a column for every stop it calls at. This is
what a running board looks like, and it is the shape that makes the point of the whole tool visible: read
down any column and you have that shelter's own sheet, a minute or two off its neighbour's.

```csv
Route,Day type,Aurora Cinema,Estonia Street,Pervokonnaya Street
8,Weekdays,06:11,06:14,06:17
8,Weekdays,06:21,06:24,06:27
```

Nothing declares which shape a file is in. Headings settle the named columns; the shape is worked out from
the data, because in the trip-per-row form the headings are stop names — which no rule could recognise —
while the cells under them are unmistakably clock times.

## Columns

Only `Route` and `Times` are needed, plus `Stop` unless the file is trip-per-row. Headings are matched on
whole words, in English or Russian, and can be in any order.

| Column | Also matches | Notes |
|---|---|---|
| `Route` | line, маршрут, номер | Printed on the badge |
| `Stop` | station, остановка | |
| `Stop code` | code, код | Used in export filenames |
| `Direction` | towards, bound, направление | Splits a shelter into a sheet per side |
| `Day type` | service, calendar, тип дня | Becomes a column on the sheet; omitted means `Daily` |
| `Times` | departure, время, рейс | One departure or a whole run of them |
| `Terminal` | destination, headsign, конечная | The headsign |
| `Via` | streets, через, улицы | Comma-separated |
| `Mode` | type, вид | bus, tram, trolleybus — free text |
| `Color` | colour, цвет | `#7b2ff7`, for the route badge |

## Times

`07:10`, `7:10`, `7.10` and `0710` all read. Semicolons, commas and tabs all work as delimiters — the file
is sniffed, not assumed, so a paste straight out of a spreadsheet imports as-is.

Service after midnight can be written either way and comes in as the last trips of the evening, never the
first of the morning:

```csv
83,Aurora Cinema,Daily,22:40 23:20 00:05 00:50
83,Aurora Cinema,Weekends,22:44 23:26 24:11 24:58
```

`00:05` after `23:20` is read as a backwards jump and lifted onto the service day; `24:11` already says so.
Both print as `24:11` unless that is turned off in **Rules**.

A row that cannot be read is reported with its line number and skipped. The rest of the file still imports.

## What the sheet does with all this

Two things follow from the data rather than from any setting, and both are visible in these examples.

**Identical days collapse.** `schedule-identical-days.csv` states the same service under three headings.
The sheet prints it once, with no headings at all — three identical columns under `Weekdays`, `Saturday`
and `Sunday` tell a passenger nothing they can act on.

**A headway is always anchored.** Wherever a stretch of the day prints as *every 30 minutes*, the first
and last departures are printed with it. On its own a headway does not say when the service starts or
stops, and "every 30 minutes" from an unstated hour is not a timetable. Where the day already lists
departures either side of the headway those are used; where it does not, they are taken from the headway
itself.
