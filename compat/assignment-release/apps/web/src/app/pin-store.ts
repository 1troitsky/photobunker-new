/**
 * App PIN v2 storage. Separate from the prototype-only encrypted queue, so
 * production PWA and offline sessions use the same durable IndexedDB record.
 * This is a UI-lock verifier, NOT encrypted-at-rest protection against someone
 * who can copy or edit the entire browser profile.
 */
export type LegacyPin = { salt: string; digest: string; failures: number; until: number; lastWall?: number }
export type PinV2 = {
  version: 2
  salt: string
  verifier: string
  iterations: number
  length: 4 | 6 | 8
  failures: number
  until: number
  lastWall: number
}
export type PinRecord = PinV2 | LegacyPin | { version: 0 }

const DATABASE = 'photobunker-app-pin-v2'
const STORE = 'records'

async function open(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('pin.storage_failed')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(new Error('pin.storage_failed'))
    request.onblocked = () => reject(new Error('pin.storage_failed'))
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

/** Mutation occurs in one strict-durability transaction, across tabs. */
async function transaction<T>(
  scope: string,
  mode: IDBTransactionMode,
  change: (value: PinRecord | undefined) => PinRecord | undefined,
): Promise<T | undefined> {
  const database = await open()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode, { durability: 'strict' })
    const store = tx.objectStore(STORE)
    const request = store.get(scope)
    let output: PinRecord | undefined
    request.onsuccess = () => {
      try {
        output = change(request.result as PinRecord | undefined)
        if (mode === 'readwrite') {
          if (output === undefined) store.delete(scope)
          else store.put(output, scope)
        }
      } catch (error) {
        reject(error)
        tx.abort()
      }
    }
    request.onerror = () => { reject(new Error('pin.storage_failed')); tx.abort() }
    tx.oncomplete = () => { database.close(); resolve(output as T | undefined) }
    tx.onabort = () => { database.close(); reject(new Error('pin.storage_failed')) }
    tx.onerror = () => { database.close(); reject(new Error('pin.storage_failed')) }
  })
}
/** D4: exact device only, unlike account retirement's all-device purge. */
export async function eraseAppPinForLocalDelete(owner: string, device: string) {
  await writePin('app-pin:' + owner + ':' + device, () => undefined)
}
export const readPin = (scope: string) =>
  transaction<PinRecord>(scope, 'readonly', value => value)
export const writePin = (scope: string, update: (value: PinRecord | undefined) => PinRecord | undefined) =>
  transaction<PinRecord>(scope, 'readwrite', update)

/** The 2026 legacy verifier lived in encrypted-queue-v1.
 * Read it without importing the prototype-only queue gate in production.
 * Never migrate on load: migration requires successful PIN verification.
 */
async function legacyStore<T>(scope: string, mode: IDBTransactionMode,
  update?: (record: LegacyPin | undefined, store: IDBObjectStore) => void): Promise<T | undefined> {
  const dbName = 'photobunker-encrypted-queue-v1'
  if (!globalThis.indexedDB) throw new Error('pin.storage_failed')
  if (indexedDB.databases) {
    const existing = await indexedDB.databases()
    if (!existing.some(row => row.name === dbName)) return undefined
  }
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('entries') }
    req.onerror = () => reject(new Error('pin.storage_failed'))
    req.onblocked = () => reject(new Error('pin.storage_failed'))
    req.onsuccess = () => resolve(req.result)
  })
  if (!database.objectStoreNames.contains('entries')) {
    database.close()
    return undefined
  }
  return new Promise((resolve, reject) => {
    const tx = database.transaction('entries', mode, { durability: 'strict' })
    const store = tx.objectStore('entries')
    const req = store.get(scope)
    let result: LegacyPin | undefined
    req.onsuccess = () => {
      result = req.result as LegacyPin | undefined
      if (update) update(result, store)
    }
    tx.oncomplete = () => { database.close(); resolve(result as T | undefined) }
    tx.onabort = () => { database.close(); reject(new Error('pin.storage_failed')) }
  })
}
/** Account retirement only; never invoked on PIN entry or storage errors. */
export async function purgeAccountPins(owner: string) {
  const database = await open()
  const prefix = 'app-pin:' + owner + ':'
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite', { durability: 'strict' })
    const req = tx.objectStore(STORE).openCursor(IDBKeyRange.bound(prefix, prefix + String.fromCharCode(0xffff)))
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) { cursor.delete(); cursor.continue() }
    }
    tx.oncomplete = () => { database.close(); resolve() }
    tx.onabort = () => { database.close(); reject(new Error('pin.storage_failed')) }
  })
}
export const readLegacyPin = (scope: string) => legacyStore<LegacyPin>(scope, 'readonly')
export const clearLegacyPin = (scope: string) =>
  legacyStore<LegacyPin>(scope, 'readwrite', (_, store) => { store.delete(scope) })
