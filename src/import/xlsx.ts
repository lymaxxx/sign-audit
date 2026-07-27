import ExcelJS from 'exceljs'
import { formatTime, parseExcelTime } from '../model/time'
import type { RawTable } from './types'

/**
 * Excel workbooks.
 *
 * The awkward part is that a time cell is a fraction of a day, not text, so
 * `06:11` arrives as 0.2576. Those are converted back to clock times here;
 * everything downstream then sees the same strings a CSV would have given.
 */

const cellToString = (cell: ExcelJS.Cell): string => {
  const value = cell.value

  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()

  if (typeof value === 'number') {
    // A number formatted as a time is a fraction of a day; anything else is
    // just a number, and route "8" must not become "08:00".
    const format = (cell.numFmt ?? '').toLowerCase()
    if (value > 0 && value < 1 && (format.includes('h') || format.includes('m'))) {
      const minutes = parseExcelTime(value)
      if (minutes !== null) return formatTime(minutes)
    }
    return String(value)
  }

  if (value instanceof Date) {
    return formatTime(value.getUTCHours() * 60 + value.getUTCMinutes())
  }

  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return String((value as { result: unknown }).result ?? '').trim()
    if ('richText' in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('').trim()
    }
  }

  return String(value).trim()
}

/** Every worksheet in a workbook, as tables. */
export const parseWorkbook = async (data: ArrayBuffer | Uint8Array): Promise<RawTable[]> => {
  const workbook = new ExcelJS.Workbook()
  const buffer = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data
  await workbook.xlsx.load(buffer as ArrayBuffer)

  const tables: RawTable[] = []

  workbook.eachSheet((sheet) => {
    const rows: string[][] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = cellToString(cell)
      })
      for (let i = 0; i < values.length; i++) values[i] ??= ''
      rows.push(values)
    })

    if (rows.length === 0) return
    const header = rows.shift() ?? []
    tables.push({ name: sheet.name, header, rows })
  })

  return tables
}
