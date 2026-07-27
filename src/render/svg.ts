import type { Page, Primitive } from '../layout/primitives'

/**
 * The preview renderer.
 *
 * A plain string so it runs headless as well as in the app — the proof script
 * renders sheets to files with it, which is how the layout gets looked at
 * rather than merely tested.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const n = (v: number): string => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

/** Font family name the browser will match against the injected @font-face. */
export const cssFamily = (family: string): string => `algach-${family}`

const drawPrimitive = (p: Primitive): string => {
  switch (p.type) {
    case 'text': {
      const style = p.italic ? ' font-style="italic"' : ''
      return (
        `<text x="${n(p.x)}" y="${n(p.y)}" fill="${p.color}" ` +
        `font-family="${cssFamily(p.family)}" font-weight="${p.weight}"${style} ` +
        `font-size="${n(p.sizeMm)}" xml:space="preserve">${esc(p.text)}</text>`
      )
    }
    case 'rect': {
      const fill = p.fill ? `fill="${p.fill}"` : 'fill="none"'
      const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.strokeWidth ?? 0.2)}"` : ''
      const radius = p.radius && p.radius > 0 ? ` rx="${n(p.radius)}"` : ''
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" ${fill}${stroke}${radius}/>`
    }
    case 'line':
      return (
        `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" ` +
        `stroke="${p.color}" stroke-width="${n(p.width)}"/>`
      )
    case 'path': {
      const fill = p.fill ? `fill="${p.fill}"` : 'fill="none"'
      const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.strokeWidth ?? 0.2)}"` : ''
      return `<path d="${p.d}" ${fill}${stroke}/>`
    }
    case 'image': {
      if (p.format === 'svg') {
        // Nest the artwork in its own viewport so it scales into the box.
        return (
          `<svg x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" ` +
          `preserveAspectRatio="xMidYMid meet" overflow="visible">${p.source}</svg>`
        )
      }
      return `<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" href="${esc(p.source)}" preserveAspectRatio="xMidYMid meet"/>`
    }
  }
}

export interface SvgOptions {
  /** Include the bleed area in the viewBox. */
  includeBleed?: boolean
  /** `@font-face` rules so a browser matches the metrics the engine measured. */
  fontFaceCss?: string
  /** Extra markup appended inside the root, for guides and selection. */
  overlay?: string
}

export const renderSvg = (page: Page, opts: SvgOptions = {}): string => {
  const { includeBleed = false, fontFaceCss, overlay } = opts
  const bleed = includeBleed ? page.bleed : 0
  const vbX = -bleed
  const vbY = -bleed
  const vbW = page.width + bleed * 2
  const vbH = page.height + bleed * 2

  const body = page.primitives.map(drawPrimitive).join('')
  const style = fontFaceCss ? `<style>${fontFaceCss}</style>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(vbW)}mm" height="${n(vbH)}mm" ` +
    `viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}" ` +
    `text-rendering="geometricPrecision" shape-rendering="crispEdges">` +
    `${style}${body}${overlay ?? ''}</svg>`
  )
}

/** Guides for the editor: trim, margins, the two bands, and the content area. */
export const renderGuides = (
  page: Page,
  margins: { top: number; right: number; bottom: number; left: number },
  headerHeight: number,
  footerHeight: number,
): string => {
  const guide = (x: number, y: number, w: number, h: number, color: string, dash: string) =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" ` +
    `stroke="${color}" stroke-width="0.2" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"/>`

  const innerW = page.width - margins.left - margins.right
  const innerH = page.height - margins.top - margins.bottom
  const contentY = margins.top + headerHeight
  const contentH = innerH - headerHeight - footerHeight

  return (
    `<g pointer-events="none">` +
    guide(0, 0, page.width, page.height, '#c026d3', '0') +
    guide(margins.left, margins.top, innerW, innerH, '#38bdf8', '1.5 1') +
    (headerHeight > 0 ? guide(margins.left, margins.top, innerW, headerHeight, '#22c55e', '1 1') : '') +
    (footerHeight > 0
      ? guide(margins.left, page.height - margins.bottom - footerHeight, innerW, footerHeight, '#22c55e', '1 1')
      : '') +
    guide(margins.left, contentY, innerW, Math.max(0, contentH), '#f59e0b', '0.8 0.8') +
    `</g>`
  )
}
