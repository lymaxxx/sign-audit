/**
 * Project files: the thing you AirDrop to a colleague or drop in iCloud.
 *
 * A project file is an ordinary zip so that iOS Files, Mail and every desktop
 * OS handle it without a custom type association — hence the `.sgnaudit.zip`
 * double extension rather than a bare custom one, which iOS refuses to offer
 * in its file picker.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { newId } from '../util/id.js'

export const SCHEMA_VERSION = 1
export const FILE_SUFFIX = '.sgnaudit.zip'

async function blobToU8(blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

function safeFileName(name) {
  return (name || 'audit').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'audit'
}

/**
 * @param {object} project mutable audit data
 * @param {object} plan baked drawing geometry
 * @param {Blob|null} planFile the original DXF, so the file is self-contained
 * @param {Array} photos photo records straight out of IndexedDB
 * @returns {{blob: Blob, fileName: string}}
 */
export async function exportProject(project, plan, planFile, photos) {
  const files = {}

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    app: 'signage-audit',
    exportedAt: Date.now(),
    project: { ...project, id: project.id },
    photos: photos.map((p) => ({
      id: p.id,
      signId: p.signId,
      side: p.side,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt,
    })),
  }
  files['project.json'] = strToU8(JSON.stringify(manifest))
  files['plan.json'] = strToU8(JSON.stringify(plan ?? null))

  if (planFile) files['plan.dxf'] = await blobToU8(planFile)

  for (const photo of photos) {
    // JPEG data is already compressed; running deflate over it costs seconds
    // on a phone and saves nothing.
    if (photo.blob) files[`photos/${photo.id}.jpg`] = [await blobToU8(photo.blob), { level: 0 }]
    if (photo.thumb) files[`photos/${photo.id}.thumb.jpg`] = [await blobToU8(photo.thumb), { level: 0 }]
  }

  const zipped = zipSync(files, { level: 6 })
  return {
    blob: new Blob([zipped], { type: 'application/zip' }),
    fileName: `${safeFileName(project.name)}${FILE_SUFFIX}`,
  }
}

/**
 * Read a project file back. Ids are regenerated so importing a colleague's
 * copy alongside your own does not overwrite it.
 * @returns {{project: object, plan: object|null, planFile: Blob|null, photos: Array}}
 */
export async function importProjectFile(file) {
  const entries = unzipSync(await blobToU8(file))

  const manifestRaw = entries['project.json']
  if (!manifestRaw) {
    throw new Error('This zip is not a signage audit project (no project.json inside).')
  }
  const manifest = JSON.parse(strFromU8(manifestRaw))
  if (manifest.app !== 'signage-audit') {
    throw new Error('This zip was not produced by this app.')
  }
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This project was saved by a newer version of the app. Update and try again.')
  }

  const projectId = newId('prj')
  const project = {
    ...manifest.project,
    id: projectId,
    updatedAt: manifest.project?.updatedAt ?? Date.now(),
  }

  const plan = entries['plan.json'] ? JSON.parse(strFromU8(entries['plan.json'])) : null
  if (plan) plan.id = projectId

  const planFile = entries['plan.dxf']
    ? new Blob([entries['plan.dxf']], { type: 'application/dxf' })
    : null

  const photos = []
  for (const meta of manifest.photos ?? []) {
    const full = entries[`photos/${meta.id}.jpg`]
    if (!full) continue
    const thumb = entries[`photos/${meta.id}.thumb.jpg`]
    photos.push({
      ...meta,
      projectId,
      blob: new Blob([full], { type: 'image/jpeg' }),
      thumb: thumb ? new Blob([thumb], { type: 'image/jpeg' }) : null,
    })
  }

  return { project, plan, planFile, photos }
}

/** Sign table as CSV — the written deliverable most audits have to hand over. */
export function signsToCsv(signs) {
  const escape = (value) => {
    const text = value == null ? '' : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  // Sides vary per sign, and so do the attributes carried over from the
  // drawing, so both sets of columns are derived from the data rather than
  // fixed. Without this a three-sided sign would silently lose a column.
  const sideIds = [...new Set(signs.flatMap((s) => (s.sides ?? []).map((side) => side.id)))].sort()
  const dataKeys = [...new Set(signs.flatMap((s) => Object.keys(s.data ?? {})))].sort()

  const header = [
    'Name',
    'Type',
    'Status',
    'Notes',
    ...dataKeys,
    ...sideIds.flatMap((id) => [`Photos ${id}`, `Bearing ${id}`]),
    'X',
    'Y',
    'Source',
  ]
  const rows = signs.map((s) =>
    [
      s.name,
      s.type,
      s.status,
      s.notes,
      ...dataKeys.map((key) => s.data?.[key] ?? ''),
      ...sideIds.flatMap((id) => [
        s.photos?.[id]?.length ?? 0,
        s.sides?.find((side) => side.id === id)?.bearing ?? '',
      ]),
      Math.round(s.x * 1000) / 1000,
      Math.round(s.y * 1000) / 1000,
      s.source,
    ]
      .map(escape)
      .join(','),
  )
  // The BOM makes Excel open UTF-8 correctly on Windows.
  return `﻿${[header.join(','), ...rows].join('\r\n')}\r\n`
}

/** Hand a blob to the browser as a download; on iOS this opens the share sheet. */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
