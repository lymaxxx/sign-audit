/**
 * IndexedDB wrapper. Hand-rolled rather than pulled in as a dependency —
 * the app needs four object stores and a dozen operations.
 *
 * The split across stores is deliberate. Autosave fires on every keystroke in
 * a notes field, and structured-cloning a few megabytes of baked SVG path data
 * each time would stall the UI. So the mutable audit data (`projects`) is kept
 * apart from the immutable rendered drawing (`plans`), the original file
 * (`planFiles`) and the photo blobs (`photos`).
 */

const DB_NAME = 'signage-audit'
// v2 added `underlays`: a reference image or drawing placed behind the plan,
// stored separately from `plans` for the same reason plan and photos are
// split apart — its payload (a raster image or a second drawing's geometry)
// is heavy and irrelevant to every read that does not need it.
const DB_VERSION = 2

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('plans')) {
        db.createObjectStore('plans', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('planFiles')) {
        db.createObjectStore('planFiles', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('photos')) {
        const store = db.createObjectStore('photos', { keyPath: 'id' })
        store.createIndex('projectId', 'projectId')
      }
      if (!db.objectStoreNames.contains('underlays')) {
        db.createObjectStore('underlays', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function run(storeNames, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode)
        let result
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
        Promise.resolve(fn(tx)).then(
          (value) => {
            result = value
          },
          (error) => {
            try {
              tx.abort()
            } catch {
              // The transaction may already have finished; the reject below stands.
            }
            reject(error)
          },
        )
      }),
  )
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/* ---------------------------------------------------------------- projects */

export function listProjects() {
  return run('projects', 'readonly', (tx) =>
    request(tx.objectStore('projects').getAll()).then((all) =>
      all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    ),
  )
}

export function getProject(id) {
  return run('projects', 'readonly', (tx) => request(tx.objectStore('projects').get(id)))
}

export function putProject(project) {
  return run('projects', 'readwrite', (tx) => request(tx.objectStore('projects').put(project)))
}

/* ---------------------------------------------------------------- recovery */

/**
 * A crash-recovery journal for work that has not reached IndexedDB yet.
 *
 * Autosave is debounced, so the newest few hundred milliseconds of typing live
 * only in memory. On a phone that is exactly when work is most at risk — an
 * app switch, a screen lock or the share sheet can let iOS discard the page
 * with no warning.
 *
 * IndexedDB cannot close that gap. Writes to it are asynchronous, and a
 * transaction opened from `pagehide` is *discarded* rather than committed —
 * verified in Chromium, where the transaction opens without error and the
 * record is simply absent afterwards. localStorage is the one store that is
 * synchronous, so it is the only one that can still be written at that point.
 *
 * So the journal holds the last project state as JSON, and `StoreProvider`
 * prefers it on start-up when it is newer than what IndexedDB has. It is
 * cleared as soon as a normal autosave lands, so it never resurrects state
 * that has already been superseded.
 */
const RECOVERY_KEY = 'signage-audit:recovery'

export function saveRecovery(project) {
  if (!project) return false
  try {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(project))
    return true
  } catch {
    // Out of quota, or storage blocked (Safari private browsing). The
    // debounced autosave remains the primary path; this is only a safety net.
    return false
  }
}

export function readRecovery() {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearRecovery() {
  try {
    localStorage.removeItem(RECOVERY_KEY)
  } catch {
    // Nothing to do — a stale journal is superseded by updatedAt anyway.
  }
}

export function deleteProject(id) {
  return run(['projects', 'plans', 'planFiles', 'photos', 'underlays'], 'readwrite', async (tx) => {
    tx.objectStore('projects').delete(id)
    tx.objectStore('plans').delete(id)
    tx.objectStore('planFiles').delete(id)
    tx.objectStore('underlays').delete(id)
    const photos = tx.objectStore('photos')
    const keys = await request(photos.index('projectId').getAllKeys(id))
    for (const key of keys) photos.delete(key)
  })
}

/* ------------------------------------------------------------------- plans */

export function getPlan(id) {
  return run('plans', 'readonly', (tx) => request(tx.objectStore('plans').get(id)))
}

export function putPlan(plan) {
  return run('plans', 'readwrite', (tx) => request(tx.objectStore('plans').put(plan)))
}

export function getPlanFile(id) {
  return run('planFiles', 'readonly', (tx) => request(tx.objectStore('planFiles').get(id)))
}

export function putPlanFile(id, blob) {
  return run('planFiles', 'readwrite', (tx) => request(tx.objectStore('planFiles').put({ id, blob })))
}

/* ---------------------------------------------------------------- underlay */

export function getUnderlay(id) {
  return run('underlays', 'readonly', (tx) => request(tx.objectStore('underlays').get(id)))
}

export function putUnderlay(record) {
  return run('underlays', 'readwrite', (tx) => request(tx.objectStore('underlays').put(record)))
}

export function deleteUnderlay(id) {
  return run('underlays', 'readwrite', (tx) => request(tx.objectStore('underlays').delete(id)))
}

/* ------------------------------------------------------------------ photos */

export function getPhoto(id) {
  return run('photos', 'readonly', (tx) => request(tx.objectStore('photos').get(id)))
}

export function putPhoto(photo) {
  return run('photos', 'readwrite', (tx) => request(tx.objectStore('photos').put(photo)))
}

export function deletePhoto(id) {
  return run('photos', 'readwrite', (tx) => request(tx.objectStore('photos').delete(id)))
}

export function getPhotosForProject(projectId) {
  return run('photos', 'readonly', (tx) =>
    request(tx.objectStore('photos').index('projectId').getAll(projectId)),
  )
}

/** Rough storage usage, for the "how much room is left" warning. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage, quota } = await navigator.storage.estimate()
    return { usage: usage ?? 0, quota: quota ?? 0 }
  } catch {
    return null
  }
}

/**
 * Ask the browser to exempt this origin from eviction. On iOS Safari this only
 * succeeds for a home-screen-installed app, which is exactly the case we want
 * to protect; elsewhere it is a no-op that returns false.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
