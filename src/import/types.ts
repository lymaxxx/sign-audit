import type { Timetable } from '../model/types'

/**
 * What every importer returns.
 *
 * Problems are reported rather than thrown. A single unparseable cell in a
 * thousand-row spreadsheet should cost that departure and name the row, not
 * the whole import.
 */
export interface ImportIssue {
  severity: 'warning' | 'error'
  message: string
  /** Where it came from — sheet, row, file, whatever the source can say. */
  where?: string
}

export interface ImportResult {
  timetable: Timetable
  issues: ImportIssue[]
}

/** A table as read off a sheet or a CSV, before any meaning is assigned. */
export interface RawTable {
  name: string
  header: string[]
  rows: string[][]
}

/**
 * Which column means what.
 *
 * Guessed from the header, then shown to the user to correct, because no two
 * agencies name these the same way.
 */
export interface ColumnMapping {
  route?: number
  stop?: number
  stopCode?: number
  /** Splits one shelter into its two sides, each with its own sheet. */
  direction?: number
  dayType?: number
  /** Column holding one departure, or a whole list of them. */
  times?: number
  terminal?: number
  via?: number
  mode?: number
  color?: number
  /** Columns from here on are each a departure time, for wide-format sheets. */
  timeColumnsFrom?: number
}

export const emptyMapping = (): ColumnMapping => ({})
