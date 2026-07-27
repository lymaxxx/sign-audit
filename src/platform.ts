/**
 * Everything that differs between the packaged app and a browser tab.
 *
 * Inside Tauri these go to native dialogs and the filesystem. Outside it — the
 * dev server — they fall back to a file input and a download, which keeps the
 * whole app runnable and testable without a Mac to build it on.
 */

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface PickedFile {
  name: string
  bytes: Uint8Array
}

export interface FileFilter {
  name: string
  extensions: string[]
}

const pickViaInput = (filters: FileFilter[], multiple = false): Promise<PickedFile[]> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    const accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',')
    if (accept) input.accept = accept

    let settled = false
    const done = (files: PickedFile[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.onchange = async () => {
      const files = [...(input.files ?? [])]
      done(
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
        ),
      )
    }

    // Dismissing the picker fires nothing in older browsers, which would leave
    // the promise hanging. Modern ones have a `cancel` event; where there is
    // none, focus returning to the window stands in for it.
    input.oncancel = () => done([])

    window.addEventListener(
      'focus',
      () => {
        // Only ever settles as a dismissal. A real choice is settled by
        // `change`, and `input.files` is populated before that fires — so
        // checking it here cannot race with reading the file, which is async
        // and would otherwise lose every import to this fallback.
        setTimeout(() => {
          if (!input.files?.length) done([])
        }, 500)
      },
      { once: true },
    )

    input.style.display = 'none'
    document.body.appendChild(input)
    input.click()
  })

export const openFiles = async (
  filters: FileFilter[],
  multiple = false,
): Promise<PickedFile[]> => {
  if (!isTauri()) return pickViaInput(filters, multiple)

  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readFile } = await import('@tauri-apps/plugin-fs')

  const selected = await open({ multiple, filters })
  if (!selected) return []
  const paths = Array.isArray(selected) ? selected : [selected]

  return Promise.all(
    paths.map(async (path) => ({
      name: path.split(/[/\\]/).pop() ?? path,
      bytes: await readFile(path),
    })),
  )
}

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/**
 * An ASCII rendering of a filename, for the browser fallback only.
 *
 * Chromium ignores a download attribute that is not ASCII and calls the file
 * "download" instead — which, over a whole network, means every sheet arrives
 * under the same name. The packaged app writes to a path and keeps the real
 * name, so this never applies there.
 */
export const asciiFallbackName = (name: string, index: number): string => {
  if (/^[\x20-\x7e]+$/.test(name)) return name

  const stem = name.replace(/\.pdf$/i, '')
  const ascii = [...stem.toLowerCase()]
    .map((ch) => CYRILLIC[ch] ?? (/[a-z0-9]/.test(ch) ? ch : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return `${ascii || `sheet-${index}`}.pdf`
}

let downloadCount = 0

const download = (name: string, bytes: Uint8Array, mime: string) => {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = asciiFallbackName(name, ++downloadCount)
  // The download attribute is only honoured for an anchor that is in the
  // document; detached, every file arrives named "download".
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const saveFile = async (
  suggestedName: string,
  bytes: Uint8Array,
  filters: FileFilter[],
  mime = 'application/octet-stream',
): Promise<string | null> => {
  if (!isTauri()) {
    download(suggestedName, bytes, mime)
    return suggestedName
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')

  const path = await save({ defaultPath: suggestedName, filters })
  if (!path) return null
  await writeFile(path, bytes)
  return path
}

/** Where a batch export should put its files. */
export const chooseDirectory = async (): Promise<string | null> => {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

export const writeInto = async (directory: string, name: string, bytes: Uint8Array): Promise<void> => {
  if (!isTauri()) {
    download(name, bytes, 'application/pdf')
    return
  }
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(`${directory}/${name}`, bytes)
}

/** Native menu clicks arrive as events; in a browser there is no menu. */
export const onMenu = async (handler: (action: string) => void): Promise<() => void> => {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<string>('menu', (event) => handler(event.payload))
  return unlisten
}
