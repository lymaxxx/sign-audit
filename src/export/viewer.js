/**
 * A finished audit as one self-contained HTML file.
 *
 * The deliverable at the end of a survey usually has to go to someone who will
 * never install this app — a client, a fabricator, a project manager on a
 * locked-down laptop. A CSV loses the drawing and the photos; the project file
 * needs this app to open it. So the viewer is a single .html with the plan,
 * every sign and every photo inlined: it opens by double-clicking, works with
 * no network, and can be emailed as one attachment.
 *
 * Everything is embedded as data URIs and inline script. There are no external
 * requests at all, deliberately — a viewer that silently needs a CDN is a
 * viewer that breaks exactly when it is opened somewhere restricted.
 */

import { STATUS, STATUS_ORDER } from '../util/status.js'

/**
 * `JSON.stringify` output is inlined into a <script> block, where the parser
 * ends the script at the first `</script`, whatever the JSON quoting says.
 * Escaping `<` sidesteps that, and `\u2028`/`\u2029` are valid in JSON strings
 * but not in JavaScript ones.
 */
function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const VIEWER_CSS = `
*{box-sizing:border-box}
:root{--bg:#12151c;--surface:#1b1f2a;--surface2:#232838;--line:#333a4d;--ink:#e7ebf3;--dim:#8b93a7;--accent:#4c8dff}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}
header{display:flex;align-items:center;gap:.75rem;padding:.7rem 1rem;border-bottom:1px solid var(--line);flex:none}
header h1{font-size:1rem;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .sub{color:var(--dim);font-size:.8rem;white-space:nowrap}
main{flex:1;display:flex;min-height:0}
#plan{flex:1;position:relative;touch-action:none;overflow:hidden;min-width:0}
#plan svg{width:100%;height:100%;display:block}
aside{width:min(24rem,42%);border-left:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;min-height:0}
#filter{margin:.6rem;padding:.5rem .7rem;background:var(--surface2);border:1px solid var(--line);border-radius:8px;color:var(--ink);font:inherit}
#list{overflow-y:auto;flex:1;padding:0 .6rem .6rem}
.row{display:flex;align-items:center;gap:.6rem;width:100%;text-align:left;padding:.55rem .6rem;background:none;border:0;border-radius:8px;color:var(--ink);font:inherit;cursor:pointer}
.row:hover,.row.on{background:var(--surface2)}
.dot{width:.6rem;height:.6rem;border-radius:50%;flex:none}
.row .nm{font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .ty{color:var(--dim);font-size:.72rem;white-space:nowrap}
#detail{border-top:1px solid var(--line);padding:.8rem;overflow-y:auto;max-height:58%;display:none}
#detail h2{margin:.1rem 0 .2rem;font-size:1.05rem}
#detail .badge{display:inline-block;padding:.15em .6em;border-radius:999px;font-size:.72rem;font-weight:600}
#detail .notes{white-space:pre-wrap;background:var(--surface2);padding:.5rem .6rem;border-radius:8px;margin:.5rem 0}
#detail dl{display:grid;grid-template-columns:auto 1fr;gap:.2rem .8rem;margin:.5rem 0;font-size:.85rem}
#detail dt{color:var(--dim)}
#detail dd{margin:0}
.side{margin-top:.7rem}
.side h3{margin:0 0 .35rem;font-size:.8rem;color:var(--dim);font-weight:600;letter-spacing:.03em}
.shots{display:flex;flex-wrap:wrap;gap:.4rem}
.shots img{width:5rem;height:5rem;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:zoom-in}
#tools{position:absolute;right:.75rem;top:.75rem;display:flex;flex-direction:column;gap:.4rem}
#tools button{width:2.6rem;height:2.6rem;border-radius:10px;border:1px solid var(--line);background:rgba(27,31,42,.92);color:var(--ink);font-size:1.1rem;cursor:pointer}
#lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:50;touch-action:none}
#lightbox.on{display:flex}
#lightbox img{max-width:100%;max-height:100%;transform-origin:0 0;cursor:grab}
#lightbox .close{position:absolute;top:1rem;right:1rem;width:2.6rem;height:2.6rem;border-radius:10px;border:1px solid var(--line);background:rgba(27,31,42,.92);color:var(--ink);font-size:1.1rem;cursor:pointer}
#lightbox .hint{position:absolute;bottom:1rem;left:0;right:0;text-align:center;color:var(--dim);font-size:.8rem;pointer-events:none}
@media (max-width:820px){main{flex-direction:column}aside{width:auto;border-left:0;border-top:1px solid var(--line);max-height:52%}#detail{max-height:70%}}
`

const VIEWER_JS = String.raw`
(function () {
  var D = window.__AUDIT__
  var STATUS = D.status
  var planEl = document.getElementById('plan')
  var svg = document.getElementById('svg')
  var root = document.getElementById('root')
  var listEl = document.getElementById('list')
  var detailEl = document.getElementById('detail')
  var view = { scale: 1, tx: 0, ty: 0 }
  var selected = null

  function applyView() {
    root.setAttribute('transform', 'translate(' + view.tx + ' ' + view.ty + ') scale(' + view.scale + ' ' + -view.scale + ')')
    // Markers are drawn in world units, so counter-scale them to keep a
    // constant on-screen size at any zoom.
    var inv = 1 / view.scale
    var marks = document.getElementById('marks').children
    for (var i = 0; i < marks.length; i++) {
      var g = marks[i]
      g.setAttribute('transform', 'translate(' + g.dataset.x + ' ' + g.dataset.y + ') scale(' + inv + ' ' + -inv + ')')
    }
  }

  function fit(box) {
    var r = planEl.getBoundingClientRect()
    if (!r.width || !r.height) return
    var w = Math.max(box.maxX - box.minX, 1e-9), h = Math.max(box.maxY - box.minY, 1e-9)
    view.scale = Math.min(r.width / w, r.height / h) * 0.88
    view.tx = r.width / 2 - view.scale * (box.minX + box.maxX) / 2
    view.ty = r.height / 2 + view.scale * (box.minY + box.maxY) / 2
    applyView()
  }

  function zoomAt(f, px, py) {
    var s = Math.max(1e-7, Math.min(1e8, view.scale * f)), k = s / view.scale
    view.scale = s
    view.tx = px - (px - view.tx) * k
    view.ty = py - (py - view.ty) * k
    applyView()
  }

  // --- pan / zoom ---------------------------------------------------------
  var pts = {}, last = null, pinch = null, moved = false
  function local(e) { var r = planEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  planEl.addEventListener('pointerdown', function (e) {
    pts[e.pointerId] = local(e); moved = false
    var ids = Object.keys(pts)
    if (ids.length === 1) last = pts[ids[0]]
    else if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } } }
  })
  planEl.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return
    var p = local(e); pts[e.pointerId] = p
    var ids = Object.keys(pts)
    if (ids.length === 1 && last) {
      var dx = p.x - last.x, dy = p.y - last.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
      view.tx += dx; view.ty += dy; last = p; applyView()
    } else if (ids.length >= 2 && pinch) {
      var a = pts[ids[0]], b = pts[ids[1]]
      var d = Math.hypot(a.x - b.x, a.y - b.y) || 1, c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      var k = d / pinch.d, prev = pinch.c
      pinch.d = d; pinch.c = c; moved = true
      var s = Math.max(1e-7, Math.min(1e8, view.scale * k)), ap = s / view.scale
      view.scale = s; view.tx = c.x - (prev.x - view.tx) * ap; view.ty = c.y - (prev.y - view.ty) * ap
      applyView()
    }
  })
  function release(e) { delete pts[e.pointerId]; var ids = Object.keys(pts); last = ids.length === 1 ? pts[ids[0]] : null; if (ids.length < 2) pinch = null }
  planEl.addEventListener('pointerup', release)
  planEl.addEventListener('pointercancel', release)
  window.addEventListener('blur', function () { pts = {}; last = null; pinch = null })
  planEl.addEventListener('wheel', function (e) {
    e.preventDefault(); var p = local(e)
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.02 : 0.0015)), p.x, p.y)
  }, { passive: false })

  document.getElementById('fit').onclick = function () { fit(D.bounds) }
  document.getElementById('zin').onclick = function () { var r = planEl.getBoundingClientRect(); zoomAt(1.6, r.width / 2, r.height / 2) }
  document.getElementById('zout').onclick = function () { var r = planEl.getBoundingClientRect(); zoomAt(1 / 1.6, r.width / 2, r.height / 2) }

  // --- detail panel -------------------------------------------------------
  function show(sign) {
    selected = sign
    var st = STATUS[sign.status] || STATUS.unchecked
    var h = '<h2>' + esc(sign.name) + '</h2>'
    h += '<span class="badge" style="background:' + st.color + '22;color:' + st.color + '">' + esc(st.label) + '</span>'
    h += ' <span style="color:var(--dim);font-size:.78rem">' + esc(sign.type) + '</span>'
    if (sign.notes) h += '<div class="notes">' + esc(sign.notes) + '</div>'
    var keys = Object.keys(sign.data || {}).filter(function (k) { return sign.data[k] })
    if (keys.length) {
      h += '<dl>'
      keys.forEach(function (k) { h += '<dt>' + esc(k) + '</dt><dd>' + esc(sign.data[k]) + '</dd>' })
      h += '</dl>'
    }
    ;(sign.sides || []).forEach(function (side) {
      var shots = (sign.photos && sign.photos[side.id]) || []
      h += '<div class="side"><h3>SIDE ' + esc(side.id) + ' · ' + Math.round(side.bearing || 0) + '°</h3>'
      h += shots.length ? '<div class="shots">' + shots.map(function (id) {
        return '<img loading="lazy" src="' + (D.thumbs[id] || D.photos[id]) + '" data-full="' + id + '">'
      }).join('') + '</div>' : '<div style="color:var(--dim);font-size:.82rem">No photo</div>'
      h += '</div>'
    })
    detailEl.innerHTML = h
    detailEl.style.display = 'block'
    detailEl.scrollTop = 0
    Array.prototype.forEach.call(detailEl.querySelectorAll('.shots img'), function (img) {
      img.onclick = function () { openLightbox(D.photos[img.dataset.full] || img.src) }
    })
    Array.prototype.forEach.call(listEl.children, function (b) { b.classList.toggle('on', b.dataset.id === sign.id) })
    var mark = document.querySelector('#marks [data-id="' + cssEsc(sign.id) + '"] circle')
    if (mark) { mark.setAttribute('stroke-width', '4') ; setTimeout(function () { mark.setAttribute('stroke-width', '2') }, 900) }
  }

  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML }
  function cssEsc(t) { return String(t).replace(/["\\]/g, '\\$&') }

  // --- sign list ----------------------------------------------------------
  function renderList(q) {
    q = (q || '').trim().toLowerCase()
    listEl.innerHTML = ''
    D.signs.filter(function (s) {
      return !q || (s.name + ' ' + s.type + ' ' + (s.notes || '')).toLowerCase().indexOf(q) >= 0
    }).forEach(function (s) {
      var st = STATUS[s.status] || STATUS.unchecked
      var b = document.createElement('button')
      b.className = 'row'; b.dataset.id = s.id
      b.innerHTML = '<span class="dot" style="background:' + st.color + '"></span><span class="nm">' + esc(s.name) + '</span><span class="ty">' + esc(st.short) + '</span>'
      b.onclick = function () { show(s); centre(s) }
      listEl.appendChild(b)
    })
  }
  function centre(s) {
    var r = planEl.getBoundingClientRect()
    view.scale = Math.max(view.scale, D.locateScale)
    view.tx = r.width / 2 - view.scale * s.x
    view.ty = r.height / 2 + view.scale * s.y
    applyView()
  }
  document.getElementById('filter').addEventListener('input', function (e) { renderList(e.target.value) })

  // --- markers ------------------------------------------------------------
  var marks = document.getElementById('marks')
  D.signs.forEach(function (s) {
    var st = STATUS[s.status] || STATUS.unchecked
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.dataset.x = s.x; g.dataset.y = s.y; g.dataset.id = s.id
    g.style.cursor = 'pointer'
    g.innerHTML = '<circle r="9" fill="' + st.color + '33" stroke="' + st.color + '" stroke-width="2"></circle>' +
      '<text y="-14" text-anchor="middle" font-size="11" fill="#e7ebf3" style="paint-order:stroke;stroke:#12151c;stroke-width:3px">' + esc(s.name) + '</text>'
    g.addEventListener('click', function () { if (!moved) show(s) })
    marks.appendChild(g)
  })

  // --- lightbox -----------------------------------------------------------
  var lb = document.getElementById('lightbox'), lbImg = document.getElementById('lbimg')
  var lv = { s: 1, x: 0, y: 0 }
  function lbApply() { lbImg.style.transform = 'translate(' + lv.x + 'px,' + lv.y + 'px) scale(' + lv.s + ')' }
  function openLightbox(src) { lbImg.src = src; lv = { s: 1, x: 0, y: 0 }; lbApply(); lb.classList.add('on') }
  function closeLightbox() { lb.classList.remove('on'); lbImg.src = '' }
  document.getElementById('lbclose').onclick = closeLightbox
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox() })
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox() })
  lb.addEventListener('wheel', function (e) {
    e.preventDefault(); lv.s = Math.max(1, Math.min(8, lv.s * Math.exp(-e.deltaY * 0.002))); if (lv.s === 1) { lv.x = 0; lv.y = 0 } lbApply()
  }, { passive: false })
  lbImg.addEventListener('dblclick', function () { lv = lv.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }; lbApply() })
  var lbPts = {}, lbLast = null, lbPinch = null
  lbImg.addEventListener('pointerdown', function (e) {
    e.preventDefault(); lbPts[e.pointerId] = { x: e.clientX, y: e.clientY }
    var ids = Object.keys(lbPts)
    if (ids.length === 1) lbLast = lbPts[ids[0]]
    else if (ids.length === 2) { var a = lbPts[ids[0]], b = lbPts[ids[1]]; lbPinch = Math.hypot(a.x - b.x, a.y - b.y) || 1 }
  })
  lbImg.addEventListener('pointermove', function (e) {
    if (!lbPts[e.pointerId]) return
    lbPts[e.pointerId] = { x: e.clientX, y: e.clientY }
    var ids = Object.keys(lbPts)
    if (ids.length === 1 && lbLast && lv.s > 1) {
      lv.x += e.clientX - lbLast.x; lv.y += e.clientY - lbLast.y; lbLast = lbPts[ids[0]]; lbApply()
    } else if (ids.length >= 2 && lbPinch) {
      var a = lbPts[ids[0]], b = lbPts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      lv.s = Math.max(1, Math.min(8, lv.s * (d / lbPinch))); lbPinch = d
      if (lv.s === 1) { lv.x = 0; lv.y = 0 }
      lbApply()
    }
  })
  function lbRelease(e) { delete lbPts[e.pointerId]; var ids = Object.keys(lbPts); lbLast = ids.length === 1 ? lbPts[ids[0]] : null; if (ids.length < 2) lbPinch = null }
  lbImg.addEventListener('pointerup', lbRelease)
  lbImg.addEventListener('pointercancel', lbRelease)

  renderList('')
  fit(D.bounds)
  window.addEventListener('resize', function () { applyView() })
})()
`

/**
 * Build the viewer.
 *
 * @param {object} project the audit
 * @param {object} plan baked drawing geometry
 * @param {Array} photos photo records straight out of IndexedDB
 * @returns {{blob: Blob, fileName: string}}
 */
export async function exportViewerHtml(project, plan, photos) {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const used = new Set()
  for (const sign of project.signs ?? []) {
    for (const ids of Object.values(sign.photos ?? {})) {
      for (const id of ids ?? []) if (byId.has(id)) used.add(id)
    }
  }

  // Thumbnails carry the list view, full images the lightbox — inlining only
  // what a sign actually references keeps a deleted photo's bytes out of the
  // deliverable.
  const fullUris = {}
  const thumbUris = {}
  for (const id of used) {
    const photo = byId.get(id)
    if (photo.blob) fullUris[id] = await blobToDataUri(photo.blob)
    if (photo.thumb) thumbUris[id] = await blobToDataUri(photo.thumb)
  }

  const hidden = new Set(project.hiddenBlocks ?? [])
  const backdrop = new Set(project.backdropLayers ?? [])
  const hiddenLayers = new Set((project.layers ?? []).filter((l) => !l.visible).map((l) => l.name))

  const visiblePaths = (plan?.paths ?? []).filter(
    (p) => !hiddenLayers.has(p.layer) && !(p.sourceBlock && hidden.has(p.sourceBlock)),
  )
  // Backdrop last in the source order but painted first, matching the app.
  const ordered = [...visiblePaths].sort(
    (a, b) => Number(backdrop.has(a.layer)) - Number(backdrop.has(b.layer)),
  )

  const geometry = ordered
    .map((p) => {
      const muted = backdrop.has(p.layer)
      return p.filled
        ? `<path d="${escapeHtml(p.d)}" fill="${escapeHtml(p.color)}" fill-rule="evenodd" fill-opacity="${muted ? 0.2 : 0.55}"/>`
        : `<path d="${escapeHtml(p.d)}" fill="none" stroke="${muted ? '#8b93a7' : escapeHtml(p.color)}"${muted ? ' stroke-opacity="0.5"' : ''} vector-effect="non-scaling-stroke"/>`
    })
    .join('')

  const labels = project.showLabels
    ? (plan?.labels ?? [])
        .filter(
          (l) =>
            !hiddenLayers.has(l.layer) &&
            !backdrop.has(l.layer) &&
            !(l.sourceBlock && hidden.has(l.sourceBlock)),
        )
        .map(
          (l) =>
            `<text transform="translate(${l.x} ${l.y}) scale(1 -1) rotate(${-l.angle})" font-size="${l.size}" fill="${escapeHtml(l.color)}" opacity="0.85">${escapeHtml(l.text)}</text>`,
        )
        .join('')
    : ''

  const counts = {}
  for (const sign of project.signs ?? []) counts[sign.status] = (counts[sign.status] ?? 0) + 1
  const checked = counts.checked ?? 0
  const total = (project.signs ?? []).length

  const bounds = project.crop ?? project.bounds ?? plan?.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  // Same reasoning as the app's LOCATE_ZOOM_FACTOR: a fixed pixels-per-unit
  // number means nothing across drawings with different native units.
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-9)
  const locateScale = (900 / span) * 15

  // Same order the app's sign list uses, so the deliverable reads the way the
  // person who made it remembers it.
  const sorted = [...(project.signs ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  )

  const payload = {
    signs: sorted.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      notes: s.notes ?? '',
      x: s.x,
      y: s.y,
      sides: s.sides ?? [],
      data: s.data ?? {},
      photos: s.photos ?? {},
    })),
    bounds,
    photos: fullUris,
    thumbs: thumbUris,
    status: STATUS,
    statusOrder: STATUS_ORDER,
    locateScale,
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(project.name)} — signage audit</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(project.name)}</h1>
  <span class="sub">${checked}/${total} checked · ${total} sign${total === 1 ? '' : 's'} · read-only</span>
</header>
<main>
  <div id="plan">
    <svg id="svg" role="presentation"><g id="root"><g stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${geometry}</g><g style="pointer-events:none">${labels}</g><g id="marks"></g></g></svg>
    <div id="tools">
      <button id="fit" title="Fit plan">⤢</button>
      <button id="zin" title="Zoom in">+</button>
      <button id="zout" title="Zoom out">−</button>
    </div>
  </div>
  <aside>
    <input id="filter" type="search" placeholder="Search signs…" autocomplete="off">
    <div id="list"></div>
    <div id="detail"></div>
  </aside>
</main>
<div id="lightbox">
  <img id="lbimg" alt="">
  <button class="close" id="lbclose">✕</button>
  <div class="hint">Scroll or pinch to zoom · double-tap to reset · Esc to close</div>
</div>
<script>window.__AUDIT__=${embedJson(payload)}</script>
<script>${VIEWER_JS}</script>
</body>
</html>
`

  const safe = (project.name || 'audit').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'audit'
  return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), fileName: `${safe}-viewer.html` }
}
