/** R1-07 only. Independent from app-PIN and Matrix/photo stores.
 * No PIN, PB1, derived bytes, or private content is persisted in journal.
 */
export type LocalDeleteVerifier = {
  version: 1
  salt: string
  digest: string
  iterations: number
  failures: number
  cooldownUntil: number
  lastWall: number
  recoveryFingerprint: string
}
export type LocalDeleteJournal = {
  operationId: string
  accountId: string
  deviceId: string
  phase: 'committed' | 'signed-out' | 'local-purged' | 'server-logout'
  startedAt: number
}
const DB = 'photobunker-local-delete-v1'
const PIN_STORE = 'pins'
const JOURNAL_STORE = 'journal'
async function open() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw new Error('localDelete.storage')
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PIN_STORE)) req.result.createObjectStore(PIN_STORE)
      if (!req.result.objectStoreNames.contains(JOURNAL_STORE)) req.result.createObjectStore(JOURNAL_STORE)
    }
    req.onerror = () => reject(new Error('localDelete.storage'))
    req.onblocked = () => reject(new Error('localDelete.storage'))
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
  })
}
function transact<T>(
  storeName: typeof PIN_STORE | typeof JOURNAL_STORE,
  mode: IDBTransactionMode,
  key: string,
  mutate?: (current: T | undefined) => T | undefined,
): Promise<T | undefined> {
  return open().then(db => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, mode, { durability: 'strict' })
    const store = tx.objectStore(storeName), req = store.get(key)
    let value: T | undefined, failure: unknown
    req.onsuccess = () => {
      try {
        value = mutate ? mutate(req.result as T | undefined) : req.result as T | undefined
        if (mutate) {
          if (value === undefined) store.delete(key)
          else store.put(value, key)
        }
      } catch (error) { failure = error; tx.abort() }
    }
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = () => {
      db.close()
      reject(failure instanceof Error ? failure : new Error('localDelete.storage'))
    }
    tx.onerror = () => {
      if (!failure) failure = new Error('localDelete.storage')
    }
  }))
}
export const pinKey = (owner: string, device: string) => `local-delete:${owner}:${device}`
export const readVerifier = (owner: string, device: string) =>
  transact<LocalDeleteVerifier>(PIN_STORE, 'readonly', pinKey(owner, device))
export const updateVerifier = (
  owner: string, device: string,
  mutate: (current: LocalDeleteVerifier | undefined) => LocalDeleteVerifier | undefined,
) => transact<LocalDeleteVerifier>(PIN_STORE, 'readwrite', pinKey(owner, device), mutate)
export const readJournal = () =>
  transact<LocalDeleteJournal>(JOURNAL_STORE, 'readonly', 'active')
export const mutateJournal = (
  mutate: (current: LocalDeleteJournal | undefined) => LocalDeleteJournal | undefined,
) => transact<LocalDeleteJournal>(JOURNAL_STORE, 'readwrite', 'active', mutate)
export function validJournal(value: LocalDeleteJournal | undefined): value is LocalDeleteJournal {
  return !!value && /^[0-9a-f-]{36}$/i.test(value.operationId) &&
    /^[0-9a-f-]{36}$/i.test(value.accountId) && /^[0-9a-f-]{36}$/i.test(value.deviceId) &&
    ['committed','signed-out','local-purged','server-logout'].includes(value.phase) &&
    Number.isSafeInteger(value.startedAt) && value.startedAt > 0
}
