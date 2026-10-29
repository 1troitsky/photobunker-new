import { account, deviceId } from '../identity/store'
import { appLocked } from '../app/lock'

/**
 * Device-only encrypted outgoing text. No clear message is written to
 * localStorage, CacheStorage, Matrix account_data or an HTTP endpoint.
 * Not a substitute for Matrix Megolm E2EE; server send still requires a
 * joined encrypted room and the Matrix crypto SDK. Device verification is
 * required for old-history recovery, not fresh-message encryption.
 *
 * Same-origin XSS can invoke the stored non-extractable AES key; CSP and
 * PhotoBunker's app lock remain mandatory defenses.
 */
type DurableTextBase = {
  id: string
  txnId: string
  body: string
  reply?: string
  photoId?: string
  time: number
}
export type DurableText = DurableTextBase & (
  | { roomId: string; peerId?: never }
  | { peerId: string; roomId?: never }
)
type Sealed = { version: 1; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }
const DB = 'photobunker-message-outbox-v1'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
export const MAX_DURABLE_TEXT = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function scope(): string {
  if (!account.value?.id || !deviceId.value || appLocked.value) throw new Error('outbox.locked')
  return account.value.id + ':' + deviceId.value
}
function validateScopePart(value: string) {
  if (!UUID.test(value)) throw new Error('outbox.invalid')
}
export function validateDurableText(value: unknown): DurableText {
  if (!value || typeof value !== 'object') throw new Error('outbox.invalid')
  const item = value as Record<string, unknown>
  const roomTarget = typeof item.roomId === 'string' && item.roomId.startsWith('!') && item.roomId.length <= 255
  const peerTarget = typeof item.peerId === 'string' && item.peerId.length <= 255 &&
    (/^pb_[a-z0-9]+$/i.test(item.peerId) || /^@[a-z0-9_.-]+(?::[a-z0-9.:-]+)?$/i.test(item.peerId))
  if (typeof item.txnId !== 'string' || !item.txnId.startsWith('pb-') ||
      !UUID.test(item.txnId.slice(3)) || item.id !== '~pb-ui:' + item.txnId ||
      roomTarget === peerTarget || typeof item.body !== 'string' ||
      !item.body.trim() || item.body.length > 10000 ||
      !Number.isSafeInteger(item.time) || (item.time as number) <= 0 ||
      (item.reply !== undefined && (typeof item.reply !== 'string' ||
        !item.reply.startsWith('$') || item.reply.length > 255)) ||
      (item.photoId !== undefined && (typeof item.photoId !== 'string' ||
        !UUID.test(item.photoId)))) throw new Error('outbox.invalid')
  const target = roomTarget
    ? { roomId: item.roomId as string }
    : { peerId: item.peerId as string }
  return { id: item.id as string, txnId: item.txnId, ...target,
    body: item.body, time: item.time as number,
    ...(item.reply ? { reply: item.reply as string } : {}),
    ...(item.photoId ? { photoId: item.photoId as string } : {}) }
}
function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || !crypto.subtle) return Promise.reject(new Error('outbox.unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onerror = () => reject(new Error('outbox.unavailable'))
    request.onblocked = () => reject(new Error('outbox.unavailable'))
    request.onsuccess = () => resolve(request.result)
  })
}
async function readOne<T>(id: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly')
    const request = tx.objectStore('records').get(id)
    tx.oncomplete = () => { db.close(); resolve(request.result as T | undefined) }
    tx.onerror = () => { db.close(); reject(new Error('outbox.unavailable')) }
  })
}
async function putIfMissing(id: string, key: CryptoKey) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    const store = tx.objectStore('records'), req = store.get(id)
    req.onsuccess = () => { if (!req.result) store.add(key, id) }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(new Error('outbox.unavailable')) }
    tx.onerror = () => { db.close(); reject(new Error('outbox.unavailable')) }
  })
}
async function put(id: string, value: Sealed) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(value, id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(new Error('outbox.unavailable')) }
  })
}
async function remove(id: string) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(new Error('outbox.unavailable')) }
  })
}
async function removePrefix(prefix: string) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    const request = tx.objectStore('records').openCursor(
      IDBKeyRange.bound(prefix, prefix + '\uffff'),
    )
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(new Error('outbox.unavailable')) }
    tx.onerror = () => { db.close(); reject(new Error('outbox.unavailable')) }
  })
}
async function rows(prefix: string): Promise<[string, Sealed][]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const result: [string, Sealed][] = []
    const tx = db.transaction('records', 'readonly')
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff')
    const request = tx.objectStore('records').openCursor(range)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      result.push([String(cursor.key), cursor.value as Sealed])
      if (result.length > MAX_DURABLE_TEXT) { tx.abort(); return }
      cursor.continue()
    }
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = () => { db.close(); reject(new Error('outbox.full')) }
    tx.onerror = () => { db.close(); reject(new Error('outbox.unavailable')) }
  })
}
async function keyFor(owner: string): Promise<CryptoKey> {
  const name = 'key:' + owner
  let key = await readOne<CryptoKey>(name)
  if (key) return key
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  if (owner !== scope()) throw new Error('outbox.cancelled')
  await putIfMissing(name, key)
  if (owner !== scope()) throw new Error('outbox.cancelled')
  const stored = await readOne<CryptoKey>(name)
  if (!stored) throw new Error('outbox.unavailable')
  return stored
}
function recordId(owner: string, txnId: string) { return 'msg:' + owner + ':' + txnId }

export async function saveDurableText(value: DurableText): Promise<void> {
  const item = validateDurableText(value), owner = scope()
  const id = recordId(owner, item.txnId)
  const data = await rows('msg:' + owner + ':')
  if (data.length >= MAX_DURABLE_TEXT && !data.some(([key]) => key === id))
    throw new Error('outbox.full')
  const key = await keyFor(owner)
  const bytes = textEncoder.encode(JSON.stringify(item))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: textEncoder.encode(id),
    }, key, bytes)
    if (owner !== scope()) throw new Error('outbox.cancelled')
    await put(id, { version: 1, iv, ciphertext })
    try {
      if (owner !== scope()) throw new Error('outbox.cancelled')
    } catch (error) {
      // The transaction may commit immediately before account switch or lock.
      // Remove that now-invisible operation so a reported failure cannot be
      // replayed later alongside the draft the user was told was preserved.
      await remove(id).catch(() => {})
      throw error
    }
  } finally { bytes.fill(0) }
}
export async function readDurableText(): Promise<DurableText[]> {
  const owner = scope(), entries = await rows('msg:' + owner + ':')
  if (!entries.length) return []
  const key = await keyFor(owner)
  const values: DurableText[] = []
  for (const [id, item] of entries) {
    if (item.version !== 1 || !(item.iv instanceof Uint8Array) || item.iv.length !== 12 ||
        !(item.ciphertext instanceof ArrayBuffer)) throw new Error('outbox.corrupt')
    const bytes = new Uint8Array(await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: item.iv, additionalData: textEncoder.encode(id),
    }, key, item.ciphertext))
    try {
      const parsed = validateDurableText(JSON.parse(textDecoder.decode(bytes)))
      if (id !== recordId(owner, parsed.txnId)) throw new Error('outbox.corrupt')
      values.push(parsed)
    } finally { bytes.fill(0) }
  }
  if (owner !== scope()) throw new Error('outbox.cancelled')
  return values.sort((a, b) => a.time - b.time || a.txnId.localeCompare(b.txnId))
}
export async function eraseDurableText(txnId: string): Promise<void> {
  if (!txnId.startsWith('pb-') || !UUID.test(txnId.slice(3))) throw new Error('outbox.invalid')
  const owner = scope()
  await remove(recordId(owner, txnId))
}

/** Remove encrypted text and its device key during logout/account deletion.
 * Explicit identifiers are required because the reactive identity is already
 * cleared by the time privacy cleanup finishes.
 */
export async function eraseDurableOutbox(accountId: string, scopedDeviceId?: string): Promise<void> {
  validateScopePart(accountId)
  if (scopedDeviceId) {
    validateScopePart(scopedDeviceId)
    const owner = accountId + ':' + scopedDeviceId
    await removePrefix('msg:' + owner + ':')
    await remove('key:' + owner)
    return
  }
  await removePrefix('msg:' + accountId + ':')
  await removePrefix('key:' + accountId + ':')
}
