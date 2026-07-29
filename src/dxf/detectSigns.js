/**
 * Works out which block references on the plan are signs, and where their
 * names come from.
 *
 * There is no universal CAD convention for this, so rather than guessing once
 * and hiding it, the app scores the options, preselects the most likely one,
 * and shows the user a live preview of the resulting names in the import
 * wizard. Everything here is pure so the wizard can re-run it on each change.
 */

/** Sign type is the prefix before the first underscore, e.g. "WF_01" -> "WF". */
export function signType(name) {
  const trimmed = (name ?? '').trim()
  const idx = trimmed.indexOf('_')
  if (idx > 0) return trimmed.slice(0, idx).toUpperCase()
  return 'Other'
}

/** Per-block summary of what a naming strategy would have to work with. */
export function analyseInserts(inserts) {
  const blocks = new Map()

  for (const insert of inserts) {
    const name = insert.blockName || '(unnamed)'
    let block = blocks.get(name)
    if (!block) {
      block = { name, count: 0, tags: new Map(), innerTextCount: 0, samples: [] }
      blocks.set(name, block)
    }
    block.count++
    for (const [tag, value] of Object.entries(insert.attribs ?? {})) {
      let stat = block.tags.get(tag)
      if (!stat) {
        stat = { tag, filled: 0, values: new Set() }
        block.tags.set(tag, stat)
      }
      if (value) {
        stat.filled++
        stat.values.add(value)
      }
    }
    if (insert.innerText?.length) block.innerTextCount++
    if (block.samples.length < 3) block.samples.push(insert)
  }

  return [...blocks.values()]
    .map((b) => ({
      name: b.name,
      count: b.count,
      innerTextCount: b.innerTextCount,
      samples: b.samples,
      tags: [...b.tags.values()].map((t) => ({
        tag: t.tag,
        filled: t.filled,
        distinct: t.values.size,
      })),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * The block references a selection actually turns into signs.
 *
 * A sign symbol nested inside a selected assembly block is the same physical
 * sign as the assembly, not a second one, so it is dropped.
 */
export function selectedInserts(inserts, selectedBlocks) {
  const selected = new Set(selectedBlocks)
  return inserts.filter(
    (insert) =>
      selected.has(insert.blockName || '(unnamed)') &&
      !insert.parents?.some((parent) => selected.has(parent)),
  )
}

/** The name a given strategy would produce for one block reference. */
export function nameFor(insert, strategy) {
  switch (strategy?.kind) {
    case 'attrib':
      return insert.attribs?.[strategy.tag] ?? ''
    case 'innerText':
      return insert.innerText?.[0] ?? ''
    case 'blockName':
      return insert.blockName ?? ''
    default:
      return ''
  }
}

/** Every naming strategy that could apply to the given block references. */
export function candidateStrategies(inserts) {
  const tags = new Set()
  let hasInnerText = false
  for (const insert of inserts) {
    for (const tag of Object.keys(insert.attribs ?? {})) tags.add(tag)
    if (insert.innerText?.length) hasInnerText = true
  }
  const options = [...tags].sort().map((tag) => ({ kind: 'attrib', tag }))
  if (hasInnerText) options.push({ kind: 'innerText' })
  options.push({ kind: 'blockName' })
  return options
}

export function strategyLabel(strategy) {
  switch (strategy?.kind) {
    case 'attrib':
      return `Attribute "${strategy.tag}"`
    case 'innerText':
      return 'Text inside the block'
    case 'blockName':
      return 'Block name'
    default:
      return 'Unknown'
  }
}

export function strategyKey(strategy) {
  return strategy?.kind === 'attrib' ? `attrib:${strategy.tag}` : (strategy?.kind ?? '')
}

/**
 * Rank a strategy for a set of block references. A good name source is filled
 * in on most of them, is mostly distinct, and follows the TYPE_NUMBER
 * convention the type filter relies on.
 */
function scoreStrategy(inserts, strategy) {
  if (!inserts.length) return 0
  const names = inserts.map((i) => nameFor(i, strategy).trim())
  const filled = names.filter(Boolean)
  if (!filled.length) return 0

  const coverage = filled.length / names.length
  const distinct = new Set(filled).size / filled.length
  const typed = filled.filter((v) => v.includes('_')).length / filled.length

  // The block name is the same for every instance by definition, so its
  // uniqueness score is meaningless; weight it down rather than to zero so it
  // still wins when nothing else is available.
  const uniqueness = strategy.kind === 'blockName' ? 0.1 : distinct
  return coverage * 2 + uniqueness * 2 + typed
}

export function bestStrategy(inserts) {
  const options = candidateStrategies(inserts)
  let best = null
  let bestScore = -1
  for (const option of options) {
    const score = scoreStrategy(inserts, option)
    if (score > bestScore) {
      bestScore = score
      best = option
    }
  }
  return best ?? { kind: 'blockName' }
}

/**
 * Preselect the blocks most likely to be signs. Explicitly named ones win;
 * otherwise blocks carrying attributes that look like TYPE_NUMBER codes.
 */
export function suggestSelection(analysis) {
  const scored = analysis.map((block) => {
    let score = 0
    if (/sign|signage|sgn|plaque/i.test(block.name)) score += 4
    if (block.tags.length) score += 1
    const named = block.tags.some((t) => t.distinct > 1 && t.filled >= block.count * 0.6)
    if (named) score += 2
    return { name: block.name, score }
  })

  const strong = scored.filter((b) => b.score >= 3).map((b) => b.name)
  if (strong.length) return strong

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0])
  return best && best.score > 0 ? [best.name] : []
}

/**
 * Turn the chosen block references into sign records.
 * Ids are derived from the DXF entity handle where possible, so re-importing
 * the same drawing keeps the same ids.
 */
export function makeSigns(inserts, selectedBlocks, strategy) {
  const signs = []
  const seen = new Set()

  selectedInserts(inserts, selectedBlocks).forEach((insert, index) => {
    let id = `cad_${insert.handle ?? index}`
    while (seen.has(id)) id = `${id}_${index}`
    seen.add(id)

    const name = nameFor(insert, strategy).trim() || `${insert.blockName || 'SIGN'}_${index + 1}`
    signs.push({
      id,
      name,
      type: signType(name),
      x: insert.x,
      y: insert.y,
      rotation: insert.rotation ?? 0,
      blockName: insert.blockName,
      layer: insert.layer,
      source: 'cad',
      status: 'unchecked',
      notes: '',
      photos: { A: [], B: [] },
      updatedAt: null,
    })
  })

  return signs
}
