/**
 * Photo intake: decode, downscale, re-encode as JPEG.
 *
 * This is not an optimisation, it is a requirement. A raw iPhone photo is
 * 3-5 MB; a 200-sign audit with two photos a side would be gigabytes and would
 * blow the origin's storage quota long before it finished. Re-encoding also
 * converts HEIC from the photo library into something every browser can show,
 * and bakes in the EXIF orientation so portrait shots are not sideways.
 */

const MAX_EDGE = 1600
const THUMB_EDGE = 320
const QUALITY = 0.82

/** Decode a file to something drawable, preferring the path that honours EXIF. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Safari has historically rejected the options bag; fall through.
    }
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('This file could not be read as an image.'))
      img.src = url
    })
  } finally {
    // Safari needs the URL to outlive the load event handler by a tick.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function sizeOf(source) {
  return {
    width: source.width ?? source.naturalWidth ?? 0,
    height: source.height ?? source.naturalHeight ?? 0,
  }
}

function render(source, maxEdge) {
  const { width, height } = sizeOf(source)
  const scale = Math.min(1, maxEdge / Math.max(width, height || 1))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas, width: w, height: h }
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      'image/jpeg',
      QUALITY,
    )
  })
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{blob: Blob, thumb: Blob, width: number, height: number}>}
 */
export async function preparePhoto(file) {
  const source = await decode(file)
  try {
    const full = render(source, MAX_EDGE)
    const thumb = render(source, THUMB_EDGE)
    const [blob, thumbBlob] = await Promise.all([toBlob(full.canvas), toBlob(thumb.canvas)])
    return { blob, thumb: thumbBlob, width: full.width, height: full.height }
  } finally {
    source.close?.()
  }
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
