import Papa from 'papaparse'
import type { RawTable } from './types'

/**
 * CSV and pasted text.
 *
 * The delimiter is sniffed rather than assumed — agencies export semicolons as
 * often as commas, and a paste out of a spreadsheet arrives tab-separated.
 */
export const parseDelimited = (text: string, name = 'CSV'): RawTable => {
  const parsed = Papa.parse<string[]>(text.trim(), {
    skipEmptyLines: 'greedy',
    delimiter: '',
  })

  const rows = (parsed.data ?? []).map((row) => row.map((c) => (c ?? '').toString()))
  const header = rows.shift() ?? []
  return { name, header, rows }
}

/**
 * A pasted list, with no header at all.
 *
 * The quickest way in: a stop name, then its departures, one route per line —
 * `8  Weekdays  06:11 06:23 06:35`. Anything the header-driven path would need
 * is inferred from position.
 */
export const parsePastedList = (text: string, name = 'Pasted'): RawTable => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const rows = lines.map((line) => {
    // Everything from the first clock time onward is the run of departures;
    // whatever precedes it is the route and, optionally, the kind of day.
    // Splitting on whitespace throughout would cut between the times too.
    const firstTime = /\d{1,2}[:.]\d{2}/.exec(line)
    const head = (firstTime ? line.slice(0, firstTime.index) : line).trim()
    const times = firstTime ? line.slice(firstTime.index).trim() : ''

    const fields = head.split(/\t|\s{2,}|\s+/).filter(Boolean)
    const route = fields[0] ?? ''
    const dayType = fields.length > 1 ? fields.slice(1).join(' ') : 'Daily'
    return [route, dayType, times]
  })

  return { name, header: ['Route', 'Day type', 'Times'], rows }
}
