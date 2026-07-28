// Stop-name handling for platform grouping.
//
// OSM tends to name the two sides of the same stop things like
// "Market Square (east)", "Market Square Eastbound", "Market Square / Stand C"
// or "Рынок (север)". For a schematic these are one stop with several
// platforms, so names are reduced to a common grouping key.

const DIRECTION_WORDS = [
  // english
  'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw',
  'nb', 'sb', 'eb', 'wb',
  'north', 'south', 'east', 'west',
  'northbound', 'southbound', 'eastbound', 'westbound',
  'northeast', 'northwest', 'southeast', 'southwest',
  'inbound', 'outbound', 'towards city', 'city bound', 'citybound',
  'up', 'down', 'arrivals', 'departures',
  // german
  'nord', 'sued', 'süd', 'ost', 'west', 'stadteinwaerts', 'stadteinwärts',
  'stadtauswaerts', 'stadtauswärts', 'richtung stadt', 'gegenrichtung',
  // french / spanish / italian / portuguese
  'nord', 'sud', 'est', 'ouest', 'norte', 'sur', 'este', 'oeste',
  'ida', 'vuelta', 'aller', 'retour', 'andata', 'ritorno',
  // dutch / nordic / polish / czech
  'noord', 'zuid', 'oost', 'norr', 'söder', 'öster', 'väster',
  'polnoc', 'północ', 'poludnie', 'południe', 'wschod', 'wschód', 'zachod', 'zachód',
  // russian / ukrainian
  'север', 'юг', 'восток', 'запад', 'северный', 'южный', 'восточный', 'западный',
  'северная', 'южная', 'восточная', 'западная', 'туда', 'обратно',
  'в центр', 'из центра', 'прямое', 'обратное',
]

// Words that introduce a platform designator: everything after them is a
// platform number/letter, not part of the stop's name.
const PLATFORM_WORDS = [
  'platform', 'plat', 'stand', 'bay', 'stop', 'pier', 'quay', 'gate', 'track',
  'steig', 'bussteig', 'gleis', 'bahnsteig', 'haltestelle', 'position', 'pos',
  'quai', 'voie', 'andén', 'anden', 'via', 'binario', 'perron', 'peron',
  'платформа', 'путь', 'посадочная площадка', 'остановка',
]

const DIRECTION_SET = new Set(DIRECTION_WORDS)

function tidy(text) {
  return (text || '')
    .replace(/[‘’“”]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function isDirectionish(text) {
  const t = tidy(text).toLowerCase().replace(/[.]/g, '')
  if (!t) return false
  if (DIRECTION_SET.has(t)) return true
  // "platform 2", "stand C", "gleis 1a"
  for (const word of PLATFORM_WORDS) {
    if (t === word) return true
    if (t.startsWith(`${word} `) && /^[\p{L}]?\d{0,3}[\p{L}]?$/u.test(t.slice(word.length + 1))) {
      return true
    }
  }
  // a bare designator: "2", "C", "A1"
  if (/^[\p{L}]?\d{0,3}[\p{L}]?$/u.test(t) && t.length <= 3) return true
  // "towards Springfield" style qualifiers
  if (/^(towards|to|richtung|direction|направление|в сторону)\b/u.test(t)) return true
  // compounds such as "nord-est" or "north / east"
  const parts = t.split(/[-\s/]+/).filter(Boolean)
  if (parts.length > 1 && parts.every((p) => DIRECTION_SET.has(p))) return true
  return false
}

// Strips bracketed and trailing platform/direction qualifiers.
// Returns { base, qualifier } — qualifier is what was removed, for display.
export function splitStopName(rawName) {
  let name = tidy(rawName)
  const qualifiers = []

  // bracketed qualifiers, anywhere: "Foo (east) bus station"
  name = name.replace(/[([{]([^)\]}]*)[)\]}]/g, (match, inner) => {
    if (isDirectionish(inner)) {
      qualifiers.push(tidy(inner))
      return ' '
    }
    return match
  })
  name = tidy(name)

  // trailing qualifiers after a separator: "Foo - eastbound", "Foo, Ost", "Foo / stand C"
  let changed = true
  while (changed) {
    changed = false
    const m = name.match(/^(.*?)[\s]*[-–—,/|:][\s]*([^-–—,/|:]+)$/)
    if (m && isDirectionish(m[2])) {
      qualifiers.unshift(tidy(m[2]))
      name = tidy(m[1])
      changed = true
    }
  }

  // trailing platform designator without a separator: "Foo platform 2"
  for (const word of PLATFORM_WORDS) {
    const re = new RegExp(`^(.*?)\\s+${word}\\s*([\\p{L}]?\\d{0,3}[\\p{L}]?)$`, 'iu')
    const m = name.match(re)
    if (m && m[1].trim()) {
      qualifiers.unshift(tidy(`${word} ${m[2]}`.trim()))
      name = tidy(m[1])
      break
    }
  }

  return { base: name || tidy(rawName), qualifier: qualifiers.join(' ') }
}

// Same, but also willing to drop a bare trailing direction word ("Foo
// Eastbound", "Hauptbahnhof Nord"). Only used for grouping and for platform
// labels — never for the displayed stop name, because plenty of real places
// simply end in a compass word ("Flughafen Süd", "Kensington South").
function splitAggressively(rawName) {
  const { base, qualifier } = splitStopName(rawName)
  const words = base.split(' ')
  if (words.length > 1 && isDirectionish(words[words.length - 1])) {
    const dropped = words.pop()
    return { base: words.join(' '), qualifier: [qualifier, dropped].filter(Boolean).join(' ') }
  }
  return { base, qualifier }
}

export function baseStopName(name) {
  return splitStopName(name).base
}

export function platformQualifier(name) {
  return splitAggressively(name).qualifier
}

// Key used to decide whether two stop records describe the same place.
export function stopGroupKey(name) {
  return splitAggressively(name)
    .base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bstr\b|\bstrasse\b|\bstraße\b/g, 'str')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Short label for a platform inside a stop, e.g. "east" or "2".
export function platformLabel(platform, index) {
  const q = platformQualifier(platform.name || '')
  return q || `${index + 1}`
}
