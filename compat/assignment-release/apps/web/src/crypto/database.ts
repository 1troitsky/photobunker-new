// Separate ciphertext queue. Never open the plaintext prototype database here.
export const ENCRYPTED_DATABASE = 'photobunker-encrypted-queue-v1'
async function open(): Promise<IDBDatabase> {
  // This database contains encrypted queues, wrapped account keys and
  // recovery state. It is the production-safe replacement for the separately
  // guarded plaintext local prototype database.
  if (!globalThis.indexedDB)
    return Promise.reject(new Error('crypto.storage_unavailable'))
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(ENCRYPTED_DATABASE, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('entries')
    r.onerror = () => reject(new Error('crypto.storage_failed'))
    r.onblocked = () => reject(new Error('crypto.storage_blocked'))
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close()
      resolve(r.result)
    }
  })
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction('entries', mode, { durability: 'strict' })
    } catch {
      db.close()
      reject(new Error('crypto.storage_failed'))
      return
    }
    let r: IDBRequest
    tx.oncomplete = () => {
      db.close()
      resolve(r.result as T)
    }
    tx.onabort = () => {
      db.close()
      reject(new Error('crypto.storage_failed'))
    }
    tx.onerror = () => {
      try {
        tx.abort()
      } catch {}
      db.close()
      reject(new Error('crypto.storage_failed'))
    }
    try {
      r = work(tx.objectStore('entries'))
    } catch {
      try {
        tx.abort()
      } catch {}
      db.close()
      reject(new Error('crypto.storage_failed'))
    }
  })
}
export const get = <T>(id: string) =>
  transaction<T | undefined>('readonly', (store) => store.get(id))
export const put = (id: string, value: unknown) =>
  transaction('readwrite', (store) => store.put(value, id))
export const remove = (id: string) =>
  transaction('readwrite', (store) => store.delete(id))
export async function list<T>(prefix: string): Promise<T[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries'),
      store = tx.objectStore('entries'),
      request = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'))
    const rows: T[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        rows.push(cursor.value)
        cursor.continue()
      }
    }
    tx.oncomplete = () => {
      db.close()
      resolve(rows)
    }
    tx.onabort = () => {
      db.close()
      reject(new Error('crypto.storage_failed'))
    }
  })
}
// Whole-job changes (ACK, GPS and delete intent) share one read/write transaction.
export async function update<T>(
  id: string,
  mutate: (value: T) => T,
): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite', { durability: 'strict' }),
      store = tx.objectStore('entries'),
      request = store.get(id)
    let result: T | undefined
    request.onsuccess = () => {
      if (request.result === undefined) return
      try {
        result = mutate(request.result as T)
        store.put(result, id)
      } catch {
        tx.abort()
      }
    }
    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onabort = () => {
      db.close()
      reject(new Error('crypto.storage_failed'))
    }
    tx.onerror = () => {
      try {
        tx.abort()
      } catch {}
      db.close()
      reject(new Error('crypto.storage_failed'))
    }
  })
}

export async function entries<T>(
  prefix: string,
): Promise<{ key: string; value: T }[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries'),
      request = tx
        .objectStore('entries')
        .openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff')),
      rows: { key: string; value: T }[] = []
    request.onsuccess = () => {
      const c = request.result
      if (c) {
        rows.push({ key: String(c.key), value: c.value })
        c.continue()
      }
    }
    tx.oncomplete = () => {
      db.close()
      resolve(rows)
    }
    tx.onabort = () => {
      db.close()
      reject(new Error('crypto.storage_failed'))
    }
  })
}
