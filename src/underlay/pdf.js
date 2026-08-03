/**
 * Rendering one page of a PDF to a raster image.
 *
 * A CAD parser can only draw what it understands, and this app's understands
 * a deliberately common subset of DXF — real drawings routinely carry entity
 * types (civil/GIS area fills, proprietary object types) that fall outside
 * that subset, on layers that then draw nothing at all. A PDF plot of the same
 * sheet sidesteps the problem entirely: whatever produced it already rasterised
 * every mark on the page, so there is nothing left to parse or fail to support.
 * It becomes a background image, not a source of signs — placed by hand
 * against the geometry this app *can* draw and detect.
 *
 * pdf.js is loaded lazily (`import()`), so a project that never uses this
 * feature never pays for it — the library and its worker are a meaningful
 * chunk of code that most audits will not need.
 *
 * Pinned to the 5.x line deliberately: 6.2.108 calls
 * `Map.prototype.getOrInsertComputed` while rendering a page — a JS built-in
 * far too new to be in any shipping browser yet — and throws instead of
 * drawing anything. Confirmed against Chromium; re-verify a real page still
 * renders before ever moving past 5.x.
 */

let pdfjsPromise = null

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return pdfjsPromise
}

// A plot sheet's mark-up (line weights, small text) needs real resolution to
// stay legible once placed alongside vector CAD geometry and zoomed into, but
// an unbounded render size on a multi-hundred-DPI scan would produce a multi-
// hundred-megabyte canvas. This caps the longer side generously above typical
// screen resolutions while keeping memory use predictable.
const MAX_DIMENSION = 2600

/**
 * @param {File|Blob} file
 * @returns {Promise<number>} page count, for offering a page picker when a PDF
 *   carries more than a plan sheet (a title page, several floors).
 */
export async function pdfPageCount(file) {
  const pdfjs = await loadPdfjs()
  const data = await file.arrayBuffer()
  // `destroy()` lives on the loading task, not the document proxy `.promise`
  // resolves to — the two are easy to conflate since most calls only ever
  // touch the resolved document.
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise
  const count = doc.numPages
  await loadingTask.destroy()
  return count
}

/**
 * @param {File|Blob} file
 * @param {number} pageNumber 1-based
 * @returns {Promise<{blob: Blob, width: number, height: number}>} a PNG of the
 *   page at its own natural aspect ratio, capped to MAX_DIMENSION on its
 *   longer side.
 */
export async function renderPdfPage(file, pageNumber = 1) {
  const pdfjs = await loadPdfjs()
  const data = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise
  try {
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = MAX_DIMENSION / Math.max(base.width, base.height)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const context = canvas.getContext('2d')
    // PDF pages are transparent where nothing is drawn; the app's canvas is
    // dark, so a plot's white background would otherwise blank out
    // everything behind and in front of it.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: context, viewport }).promise

    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the page as an image.'))), 'image/png'),
    )
    return { blob, width: canvas.width, height: canvas.height }
  } finally {
    await loadingTask.destroy()
  }
}
