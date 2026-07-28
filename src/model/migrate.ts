import { createDefaultTemplate } from './defaults'
import type { MasterTemplate } from './template'

/**
 * Bringing a saved file up to the template the app now expects.
 *
 * A `.algachtpl` written last month knows nothing about fields added since,
 * and a shallow merge with the defaults does not help: it replaces whole
 * branches wholesale, so a saved `zones` block silently drops every setting
 * added under it. The layout then reads through an undefined object and the
 * window goes blank — which is exactly what a design file should never be able
 * to do to the application that opens it.
 *
 * So: anything the file says wins, anything it does not mention is filled from
 * the defaults, all the way down.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const deepMerge = <T>(base: T, over: unknown): T => {
  if (!isPlainObject(base) || !isPlainObject(over)) {
    // Arrays and primitives are taken as the file states them. A saved list of
    // band items is the whole list, not additions to the default one.
    return (over === undefined ? base : (over as T))
  }

  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) {
    out[key] = key in base ? deepMerge((base as Record<string, unknown>)[key], value) : value
  }
  return out as T
}

/** A template that is complete, whatever the file left out. */
export const migrateTemplate = (loaded: unknown): MasterTemplate =>
  deepMerge(createDefaultTemplate(), loaded)

export { deepMerge }
