import { describe, expect, it } from 'vitest'
import { balanceColumns, computeFlow } from './flow'
import { createDefaultTemplate } from '../model/defaults'

describe('computeFlow', () => {
  const at = (width: number, over: Partial<ReturnType<typeof createDefaultTemplate>['flow']> = {}) => {
    const tpl = createDefaultTemplate()
    Object.assign(tpl.flow, over)
    return computeFlow(tpl, width)
  }

  it('gives a narrow sheet a single column', () => {
    expect(at(176).columns).toBe(1)
  })

  it('gives a wide sheet several, with no special case for orientation', () => {
    expect(at(876).columns).toBe(9)
    expect(at(396).columns).toBe(4)
  })

  it('fits more columns as the nominal block narrows', () => {
    const wide = at(186, { blockWidth: 88 }).columns
    const narrow = at(186, { blockWidth: 45 }).columns
    expect(narrow).toBeGreaterThan(wide)
  })

  it('scales type with the block it is set in', () => {
    const big = at(186, { blockWidth: 88 })
    const small = at(186, { blockWidth: 45 })
    expect(small.blockScale).toBeLessThan(big.blockScale)
  })

  it('honours an explicit column count over the nominal width', () => {
    const g = at(400, { columns: 3, blockWidth: 88 })
    expect(g.columns).toBe(3)
    expect(g.blockWidth).toBeCloseTo((400 - 2 * 10) / 3, 5)
  })

  it('keeps blocks at their nominal width when stretching is off', () => {
    const g = at(400, { stretch: false, blockWidth: 60 })
    expect(g.blockWidth).toBe(60)
  })

  it('never returns fewer than one column, however cramped', () => {
    expect(at(10).columns).toBe(1)
    expect(at(0).columns).toBe(1)
  })
})

describe('balanceColumns', () => {
  it('keeps blocks in order', () => {
    const groups = balanceColumns([40, 40, 40, 40], 2, 5)
    expect(groups.flat()).toEqual([0, 1, 2, 3])
  })

  it('splits evenly when blocks are equal', () => {
    expect(balanceColumns([40, 40, 40, 40], 2, 5)).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it('puts one block per column when there is room for each', () => {
    const groups = balanceColumns([100, 100, 100], 3, 5)
    expect(groups).toEqual([[0], [1], [2]])
  })

  it('terminates when columns outnumber blocks', () => {
    // Regression: the midpoint of two adjacent doubles can round back to the
    // upper bound, which used to leave the search spinning with neither bound
    // moving. This is the exact shape that hung.
    const groups = balanceColumns([124.5, 195.6, 37.4, 42.5, 130], 9, 9)
    expect(groups.flat()).toEqual([0, 1, 2, 3, 4])
    expect(groups.length).toBeLessThanOrEqual(9)
  })

  it('terminates on identical heights, which converge fastest', () => {
    expect(balanceColumns([50, 50, 50, 50, 50], 5, 0).length).toBe(5)
  })

  it('handles a single block', () => {
    expect(balanceColumns([42], 4, 9)).toEqual([[0]])
  })

  it('handles no blocks', () => {
    expect(balanceColumns([], 3, 9)).toEqual([])
  })

  it('never drops a block, whatever the column count', () => {
    const heights = [12, 300, 7, 44, 91, 5, 260, 33]
    for (let cols = 1; cols <= 12; cols++) {
      const flat = balanceColumns(heights, cols, 6).flat()
      expect(flat).toEqual(heights.map((_, i) => i))
    }
  })
})
