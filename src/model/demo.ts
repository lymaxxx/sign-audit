import { departuresKey, type DayType, type Route, type Stop, type Timetable } from './types'
import type { Minutes } from './time'

/**
 * A demo corridor used by the proof renderer and by tests.
 *
 * Deliberately varied: one line runs a steady headway, one is hourly, two are
 * sparse, and one changes character over the day. Between them they exercise
 * every section kind the engine can produce. Names are Cyrillic to keep the
 * font path honest.
 */

const WEEKDAY: DayType = { id: 'weekday', label: 'Weekdays' }
const WEEKEND: DayType = { id: 'weekend', label: 'Weekends' }
const DAILY: DayType = { id: 'daily', label: 'Daily' }

const at = (h: number, m: number): Minutes => h * 60 + m

/** Departures every `step` minutes across a window. */
const steady = (from: Minutes, to: Minutes, step: number): Minutes[] => {
  const out: Minutes[] = []
  for (let t = from; t <= to; t += step) out.push(t)
  return out
}

/** Alternating headway, the way real service actually runs. */
const wobbling = (from: Minutes, to: Minutes, steps: number[]): Minutes[] => {
  const out: Minutes[] = [from]
  let i = 0
  while (true) {
    const next = out[out.length - 1]! + steps[i % steps.length]!
    if (next > to) break
    out.push(next)
    i++
  }
  return out
}

/** Roughly two an hour at unpredictable minutes — the hourly-grid case. */
const irregular = (fromHour: number, toHour: number, perHour: number): Minutes[] => {
  const out: Minutes[] = []
  for (let h = fromHour; h <= toHour; h++) {
    for (let k = 0; k < perHour; k++) {
      out.push(at(h, ((h * 17 + k * 29) % 55) + k))
    }
  }
  return out.sort((a, b) => a - b)
}

const routes: Route[] = [
  {
    id: 'r8',
    number: '8',
    mode: 'trolleybus',
    color: '#7b2ff7',
    terminal: 'Кузнечно-прессовый завод',
    via: ['Новороссийская', 'Машиностроителей', 'Копейское шоссе'],
    notes: [],
  },
  {
    id: 'r10',
    number: '10',
    mode: 'trolleybus',
    color: '#e8b400',
    terminal: 'Солнечный берег',
    via: ['Новороссийская'],
    notes: [],
  },
  {
    id: 'r27',
    number: '27',
    mode: 'bus',
    color: '#7ed321',
    terminal: 'Улица Барбюса',
    via: ['Новороссийская', 'Барбюса'],
    operator: 'Ракета',
    notes: ['Private operator: Raketa Ltd, tel. 235-55-55'],
  },
  {
    id: 'r83',
    number: '83',
    mode: 'bus',
    color: '#00b64f',
    terminal: 'Сухомесово',
    via: ['Новороссийская', 'Чистопольская', 'Кольцевая'],
    accessible: true,
    notes: [],
  },
  {
    id: 'rt7',
    number: 'Т7',
    mode: 'bus',
    color: '#00b08f',
    terminal: 'Алмаз',
    via: ['Братьев Кашириных', 'Северо-Крымская', 'Труда', 'Энгельса', 'Ленина'],
    notes: [],
  },
]

const stops: Stop[] = [
  { id: 's1', name: 'Кинотеатр «Аврора»', code: '1041', direction: 'Towards Smolina' },
  { id: 's2', name: 'Эстонская улица', code: '1042', direction: 'Towards Smolina' },
  { id: 's3', name: 'Первоконная улица', code: '1043', direction: 'Towards Smolina' },
  { id: 's4', name: 'Улица Лизы Чайкиной', code: '1044', direction: 'Towards Smolina' },
  { id: 's5', name: 'Завод «Электромашина»', code: '1045', direction: 'Towards Smolina' },
  { id: 's6', name: 'Первый плановый посёлок', code: '1046', direction: 'Towards Smolina' },
]

/** Minutes a vehicle takes to reach each stop from the first one. */
const RUNNING_TIME: Record<string, number> = { s1: 0, s2: 3, s3: 6, s4: 8, s5: 11, s6: 14 }

/** Base timetable at the first stop, per route and kind of day. */
const base: Array<{ routeId: string; dayTypeId: string; times: Minutes[] }> = [
  // Steady headway all day, with scattered first and last departures.
  { routeId: 'r8', dayTypeId: 'weekday', times: wobbling(at(6, 11), at(23, 8), [10, 12, 15, 11]) },
  { routeId: 'r8', dayTypeId: 'weekend', times: wobbling(at(6, 4), at(23, 16), [12, 16, 20, 14]) },

  // Busy but irregular: too many departures to list flat, so it goes hourly.
  { routeId: 'r10', dayTypeId: 'weekday', times: irregular(7, 23, 3) },
  { routeId: 'r10', dayTypeId: 'weekend', times: irregular(7, 23, 2) },

  // A handful of departures: a plain list, and only one kind of day.
  { routeId: 'r27', dayTypeId: 'daily', times: [at(7, 10), at(8, 40), at(10, 56), at(12, 26), at(14, 16), at(16, 4), at(17, 34), at(19, 50), at(21, 20)] },

  // Middling frequency, still a list.
  { routeId: 'r83', dayTypeId: 'daily', times: steady(at(6, 17), at(20, 59), 54) },

  // Changes character across the day: scattered, then a headway, then hourly.
  {
    routeId: 'rt7',
    dayTypeId: 'weekday',
    times: [
      at(5, 37),
      at(5, 54),
      ...wobbling(at(6, 20), at(19, 0), [8, 10, 9]),
      ...irregular(19, 23, 3),
      at(24, 18),
    ],
  },
  {
    routeId: 'rt7',
    dayTypeId: 'weekend',
    times: [at(6, 5), ...wobbling(at(6, 40), at(19, 0), [12, 15, 13]), ...irregular(19, 23, 2), at(24, 7)],
  },
]

/**
 * Build the demo network.
 *
 * Each stop gets the same trips offset by running time, which is exactly why
 * every shelter in a city needs its own sheet — and what makes the batch
 * export worth having.
 */
export const makeDemoTimetable = (): Timetable => {
  const departures = new Map<string, Minutes[]>()

  for (const stop of stops) {
    const offset = RUNNING_TIME[stop.id] ?? 0
    for (const entry of base) {
      departures.set(
        departuresKey(entry.routeId, stop.id, entry.dayTypeId),
        entry.times.map((t) => t + offset),
      )
    }
  }

  return {
    routes,
    stops,
    dayTypes: [WEEKDAY, WEEKEND, DAILY],
    departures,
  }
}
