// Folding a route's two directions into one corridor.
//
// Lives here rather than in the schematic layer because the project reducer
// needs it too, to spot stops that are really one stop with a different name
// on each kerb (findOppositeKerbs).

// Longest common subsequence, returned as aligned index pairs.
function lcsPairs(a, b) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

// Folds a route's two directions into a single corridor wherever they run the
// same way, so the diagram shows one bidirectional line rather than two.
//
// The two sequences are aligned (after reversing the return one, so both read
// along the corridor). Between each pair of aligned stops there are two runs:
//
//   - one of them empty — the other direction simply doesn't stop there. Those
//     stops stay on the shared corridor and are marked as served one way only;
//     the vehicle still drives past in both directions, so no shortcut edge is
//     created and the line never splits. This is the common case: a stop
//     served outbound only, or a pair of one-way kerbs.
//   - both non-empty — a genuine divergence (a one-way loop through different
//     stops). Only these become separate one-way branches with arrows.
//
// Returns `corridor` as a list of runs (it breaks wherever a divergence takes
// over, so the two anchors of a divergence never get a phantom direct edge
// that nothing actually travels), `branches`, and a per-stop service map. All
// runs are in travel order.
export function mergeRouteDirections(fwdIds, bwdIds) {
  const F = (fwdIds || []).filter((id, i, a) => i === 0 || id !== a[i - 1])
  const rawB = (bwdIds || []).filter((id, i, a) => i === 0 || id !== a[i - 1])
  const serves = new Map()
  const setServes = (id, value) => {
    // "both" always wins: a stop that any run serves in both directions
    // shouldn't be flagged one-way because some other run only touches it once.
    if (value === 'both' || !serves.has(id)) serves.set(id, value)
  }

  if (F.length < 2 || rawB.length < 2) {
    const only = F.length >= 2 ? F : rawB
    for (const id of only) setServes(id, 'both')
    return { corridor: only.length ? [only.slice()] : [], branches: [], serves }
  }

  const B = rawB.slice().reverse()
  const pairs = lcsPairs(F, B)
  if (!pairs.length) {
    // The two directions share no stops at all — nothing to merge.
    for (const id of F) setServes(id, 'fwd')
    for (const id of rawB) setServes(id, 'bwd')
    return {
      corridor: [],
      branches: [
        { dirKey: 'fwd', stopIds: F },
        { dirKey: 'bwd', stopIds: rawB },
      ],
      serves,
    }
  }

  const corridor = []
  const branches = []
  let run = []
  const pushCorridor = (id, value) => {
    setServes(id, value)
    if (run[run.length - 1] === id) return
    run.push(id)
  }
  // A divergence carries the line between its anchors, so the corridor stops
  // at the anchor before it and resumes at the anchor after it.
  const breakCorridor = () => {
    if (run.length) corridor.push(run)
    run = []
  }

  let fi = 0
  let bi = 0
  for (let k = 0; k <= pairs.length; k++) {
    const last = k === pairs.length
    const fEnd = last ? F.length : pairs[k][0]
    const bEnd = last ? B.length : pairs[k][1]
    const gapF = F.slice(fi, fEnd)
    const gapB = B.slice(bi, bEnd)

    if (gapF.length && gapB.length) {
      const before = k === 0 ? null : F[pairs[k - 1][0]]
      const after = last ? null : F[fEnd]
      const wrap = (r) => [...(before ? [before] : []), ...r, ...(after ? [after] : [])]
      for (const id of gapF) setServes(id, 'fwd')
      for (const id of gapB) setServes(id, 'bwd')
      branches.push({ dirKey: 'fwd', stopIds: wrap(gapF) })
      // Branch runs are stored in travel order so arrows point the right way;
      // the return branch was reversed for alignment, so undo that here.
      branches.push({ dirKey: 'bwd', stopIds: wrap(gapB).reverse() })
      breakCorridor()
    } else {
      for (const id of gapF) pushCorridor(id, 'fwd')
      for (const id of gapB) pushCorridor(id, 'bwd')
    }

    if (!last) {
      pushCorridor(F[fEnd], 'both')
      fi = fEnd + 1
      bi = bEnd + 1
    }
  }
  breakCorridor()

  return { corridor: corridor.filter((r) => r.length > 1), branches, serves }
}
