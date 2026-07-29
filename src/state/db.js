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
const DB_VERSION = 1

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

export function deleteProject(id) {
  return run(['projects', 'plans', 'planFiles', 'photos'], 'readwrite', async (tx) => {
    tx.objectStore('projects').delete(id)
    tx.objectStore('plans').delete(id)
    tx.objectStore('planFiles').delete(id)
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
