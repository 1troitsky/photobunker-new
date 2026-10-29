import type { BrowserSnapshot } from './model'

const DATABASE = 'photobunker-photo-browser-cache-v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
type Cipher = { key: CryptoKey; iv: Uint8Array; data: ArrayBuffer }
const name = (owner: string, device: string, id: string) =>
  'browser:' + owner + ':' + device + ':' + id
const serial = new Map<string, Promise<unknown>>()
async function ownerLock<T>(owner: string, job: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (navigator.locks?.request)
      return await navigator.locks.request('photobunker-browser:' + owner, job)
    return await job()
  }
  const pending = serial.get(owner) ?? Promise.resolve()
  const current = pending.then(run, run)
  const tail = current.catch(() => {})
  serial.set(owner, tail)
  try { return await current }
  finally {
    if (serial.get(owner) === tail) serial.delete(owner)
  }
}

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || !crypto.subtle)
    throw new Error('browser.storage_unavailable')
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DATABASE, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('records')
    r.onerror = () => reject(new Error('browser.storage_failed'))
    r.onblocked = () => reject(new Error('browser.storage_blocked'))
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close()
      resolve(r.result)
    }
  })
}
async function transact<T>(mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', mode, { durability: 'strict' })
    const request = work(tx.objectStore('records'))
    tx.oncomplete = () => { db.close(); resolve(request.result as T) }
    tx.onabort = () => { db.close(); reject(new Error('browser.storage_failed')) }
  })
}

export async function readBrowser(owner: string, device: string, id: string, eraseExpired = true): Promise<BrowserSnapshot | undefined> {
  const scope = name(owner, device, id)
  const row = await transact<Cipher | undefined>('readonly', s => s.get(scope))
  if (!row) return undefined
  if (row.key.extractable || row.iv.length !== 12) throw new Error('browser.storage_invalid')
  const data = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: row.iv as Uint8Array<ArrayBuffer>,
    additionalData: encoder.encode(scope),
  }, row.key, row.data)
  const value = JSON.parse(decoder.decode(data)) as BrowserSnapshot
  if (value.collection.id !== id || !Array.isArray(value.collection.assignments) ||
      !Array.isArray(value.photos) || !Number.isSafeInteger(value.collection.expiresAt))
    throw new Error('browser.storage_invalid')
  if (value.collection.expiresAt <= Date.now()) {
    if (eraseExpired) await eraseBrowser(owner, device, id)
    return undefined
  }
  return value
}
export async function saveBrowser(owner: string, device: string, snapshot: BrowserSnapshot): Promise<void> {
  return ownerLock(owner, async () => {
  if (snapshot.collection.expiresAt <= Date.now()) throw new Error('browser.expired')
  const scope = name(owner, device, snapshot.collection.id)
  const old = await transact<Cipher | undefined>('readonly', s => s.get(scope))
  const key = old?.key ?? await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
  if (key.extractable) throw new Error('browser.storage_invalid')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const clear = encoder.encode(JSON.stringify(snapshot))
  try {
    const data = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: encoder.encode(scope),
    }, key, clear)
    await transact('readwrite', s => s.put({ key, iv, data } satisfies Cipher, scope))
  } finally {
    clear.fill(0)
  }
  })
}
export async function eraseBrowser(owner: string, device: string, id: string) {
  await ownerLock(owner, () => transact('readwrite', s => s.delete(name(owner, device, id))))
}
export async function eraseBrowsersForAccount(owner: string, device?: string) {
  await ownerLock(owner, async () => {
  const db = await database()
  const prefix = 'browser:' + owner + ':' + (device ? device + ':' : '')
  const keys = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction('records', 'readonly')
    const r = tx.objectStore('records').getAllKeys()
    tx.oncomplete = () => { db.close(); resolve(r.result.map(String).filter(key => key.startsWith(prefix))) }
    tx.onabort = () => { db.close(); reject(new Error('browser.storage_failed')) }
  })
  for (const key of keys) await transact('readwrite', s => s.delete(key))
  })
}
