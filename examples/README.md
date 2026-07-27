# Example timetables

Three CSVs the importer reads without any setting up. Open one with **Import…** and the whole demo
network appears in the stop list.

Regenerate and re-check them with `npx tsx scripts/make-examples.ts` — it writes the files and then reads
them back, because an example that does not import is worse than no example.

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
