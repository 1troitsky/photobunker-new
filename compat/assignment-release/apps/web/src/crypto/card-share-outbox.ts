import { account, deviceId, hasConfirmedIdentity, sessionState } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { photoReadAllowed } from './store'
import { request } from './api'
import { IdentityError } from '../identity/api'
import { canonical, b64, unb64 } from './protocol'
import { encryptCardBundle, type CardManifest, type CardScopes } from './card-shares'
import type { PrivatePhotoCard } from '../studio/private-photo-card'

type Item = {
  id: string
  photoId: string
  manifest: CardManifest
  secret: string
  bytes: string // Legacy v2 single-card encrypted record
  objects?: { card:string; photo?:string; original?:string }
  state: 'queued' | 'sending' | 'sent' | 'revoking' | 'revoked'
  everStarted: boolean
  lastError?: 'denied' | 'expired'
}
type Stored = { scope: string; key: CryptoKey; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }
export type ShareRow = { id: string; photoId: string; manifest: CardManifest; url: string;
  state: Item['state']; expiresAt: number; lastError?: Item['lastError'] }
const DB_NAME = 'photobunker-card-share-intents-v1'
const enc = new TextEncoder(), dec = new TextDecoder()
const busy = new Map<string, Promise<void>>()
function ownerScope(): string {
  if (!account.value?.id || !deviceId.value || !appLockReady.value || appLocked.value ||
      !photoReadAllowed() || ['signed-out', 'revoked'].includes(sessionState.value))
    throw new Error('card_share.locked')
  return account.value.id + ':' + deviceId.value
}
function current(scope: string) {
  if (scope !== ownerScope()) throw new Error('card_share.account_changed')
}
async function db(): Promise<IDBDatabase> {
  if (!indexedDB || !crypto.subtle) throw new Error('card_share.no_storage')
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('records')
    r.onerror = () => reject(new Error('card_share.no_storage'))
    r.onblocked = () => reject(new Error('card_share.blocked'))
    r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); resolve(r.result) }
  })
}
async function transact<T>(mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction('records', mode, { durability: 'strict' })
    const req = action(tx.objectStore('records'))
    tx.oncomplete = () => { database.close(); resolve(req.result) }
    tx.onabort = () => { database.close(); reject(new Error('card_share.no_storage')) }
  })
}
const get = (key: string) => transact<Stored | undefined>('readonly', store => store.get(key))
const put = (key: string, item: Stored) => transact<IDBValidKey>('readwrite', store => store.put(item, key))
async function all(scope: string): Promise<string[]> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction('records', 'readonly')
    const req = tx.objectStore('records').openKeyCursor(IDBKeyRange.bound(scope + ':', scope + ':\uffff'))
    const keys: string[] = []
    req.onsuccess = () => { if (req.result) { keys.push(String(req.result.key)); req.result.continue() } }
    tx.oncomplete = () => { database.close(); resolve(keys) }
    tx.onabort = () => { database.close(); reject(new Error('card_share.no_storage')) }
  })
}
async function decrypt(scope: string, id: string): Promise<Item | undefined> {
  const stored = await get(scope + ':' + id)
  current(scope)
  if (!stored) return undefined
  if (stored.scope !== scope || stored.key.extractable || stored.iv.length !== 12)
    throw new Error('card_share.bad_storage')
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv as Uint8Array<ArrayBuffer>,
    additionalData: enc.encode(scope + ':' + id) }, stored.key, stored.data)
  current(scope)
  const item = JSON.parse(dec.decode(clear)) as Item
  if (item.id !== id || item.manifest.id !== id) throw new Error('card_share.bad_storage')
  return item
}
async function save(scope: string, item: Item): Promise<void> {
  current(scope)
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const clear = enc.encode(JSON.stringify(item))
  try {
    const data = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: enc.encode(scope + ':' + item.id),
    }, key, clear)
    current(scope)
    await put(scope + ':' + item.id, { scope, key, iv, data })
    current(scope)
    window.dispatchEvent(new Event('photobunker-card-shares'))
  } finally { clear.fill(0) }
}
/**
 * Cross-tab lock controls updates and network operations for an immutable ID.
 * No unsafe in-memory-only fallback: a failed local commit never yields a URL.
 */
function exclusive<T>(scope: string, id: string, action: () => Promise<T>) {
  if (!navigator.locks?.request) throw new Error('card_share.lock_unavailable')
  return navigator.locks.request('card-share:' + scope + ':' + id, action)
}
function row(item: Item): ShareRow {
  return { id: item.id, photoId: item.photoId, manifest: item.manifest,
    url: location.origin + '/c/' + encodeURIComponent(item.id) + '#' + item.secret,
    state: item.state, expiresAt: item.manifest.expiresAt, lastError: item.lastError }
}
export async function assertCardShareQueueEmptyForDelete(owner: string, device: string): Promise<void> {
  const scope = ownerScope()
  if (scope !== owner + ':' + device) throw new Error('localDelete.scope')
  const ids = await all(scope)
  for (const key of ids) {
    const item = await decrypt(scope, key.slice(scope.length + 1))
    if (!item || !['sent','revoked'].includes(item.state))
      throw new Error('localDelete.unsynced')
  }
  current(scope)
}
export async function listCardShareIntents(photoId: string): Promise<ShareRow[]> {
  const scope = ownerScope(), ids = await all(scope), values: ShareRow[] = []
  for (const key of ids) {
    const item = await decrypt(scope, key.slice(scope.length + 1))
    if (item?.photoId === photoId) {
      const projected = row(item)
      if (projected.expiresAt <= Date.now() && !['revoked','revoking'].includes(item.state))
        projected.lastError = 'expired'
      values.push(projected)
    }
  }
  current(scope)
  return values
}
export async function commitCardShare(photoId: string, card: PrivatePhotoCard,
  scopes: CardScopes, expiresAt: number,
  durationSeconds: 3600 | 86400 | 604800,
  files: {photo?:{blob:Blob;versionId:string};original?:Blob} = {}): Promise<ShareRow> {
  const scope = ownerScope()
  if (!photoId || photoId !== card.id) throw new Error('card_share.invalid_photo')
  const encrypted = await encryptCardBundle(card, scopes, expiresAt, durationSeconds, files)
  current(scope)
  const item: Item = {
    id: encrypted.manifest.id, photoId, manifest: encrypted.manifest,
    secret: encrypted.secret, bytes: b64(new Uint8Array(await encrypted.ciphertext.arrayBuffer())),
    objects: {
      card:b64(new Uint8Array(await encrypted.objects.card!.arrayBuffer())),
      ...(encrypted.objects.photo ? {photo:b64(new Uint8Array(await encrypted.objects.photo.arrayBuffer()))} : {}),
      ...(encrypted.objects.original ? {original:b64(new Uint8Array(await encrypted.objects.original.arrayBuffer()))} : {}),
    },
    state: 'queued', everStarted: false,
  }
  await exclusive(scope, item.id, () => save(scope, item))
  current(scope)
  // Storage acknowledgement precedes displaying a copyable link.
  void flushCardShares().catch(() => {})
  return row(item)
}
export async function revokeCardShare(id: string): Promise<void> {
  const scope = ownerScope()
  await exclusive(scope, id, async () => {
    const item = await decrypt(scope, id)
    if (!item || item.state === 'revoked') return
    item.state = item.everStarted ? 'revoking' : 'revoked'
    await save(scope, item)
  })
  current(scope)
  void flushCardShares().catch(() => {})
}
async function submit(item: Item) {
  const form = new FormData()
  form.set('manifest', canonical(item.manifest))
  const decoded = unb64(item.bytes)
  const bytes = decoded.buffer.slice(
    decoded.byteOffset,
    decoded.byteOffset + decoded.byteLength,
  ) as ArrayBuffer
  form.set('file', new Blob([bytes], { type: 'application/octet-stream' }), 'ciphertext')
  // Replays transmit exact same bytes and manifest. Legacy v2 records had
  // just bytes and are always interpreted as card-only.
  const objectBlob = (encoded: string) => {
    const decoded = unb64(encoded)
    const value = decoded.buffer.slice(
      decoded.byteOffset,
      decoded.byteOffset + decoded.byteLength,
    ) as ArrayBuffer
    return new Blob([value], { type: 'application/octet-stream' })
  }
  if (item.objects?.photo)
    form.set('photo', objectBlob(item.objects.photo), 'photo-ciphertext')
  if (item.objects?.original)
    form.set('original', objectBlob(item.objects.original), 'original-ciphertext')
  await request('/photos/' + item.photoId + '/cards', 'POST', form)
}
async function flushScope(scope: string) {
  for (const key of await all(scope)) {
    current(scope)
    if (!hasConfirmedIdentity() || !navigator.onLine) return
    const id = key.slice(scope.length + 1)
    await exclusive(scope, id, async () => {
      let item = await decrypt(scope, id)
      if (!item || item.state === 'sent' || item.state === 'revoked') return
      if (item.manifest.expiresAt <= Date.now()) return
      if (item.state === 'queued' || item.state === 'sending') {
        item.state = 'sending'
        item.everStarted = true
        item.lastError = undefined
        await save(scope, item)
        try {
          await submit(item)
          current(scope)
          // A concurrent local revoke has priority over an upload ACK.
          item = await decrypt(scope, id)
          if (!item) return
          if (item.state === 'sending') {
            item.state = 'sent'
            await save(scope, item)
          }
        } catch (error) {
          // Preserve the intent and exact ciphertext. Surface ACL/TTL failures
          // without claiming the link is live or allocating another share ID.
          if (error instanceof IdentityError && [403, 410].includes(error.status)) {
            current(scope)
            item = await decrypt(scope, id)
            if (item && item.state === 'sending') {
              item.lastError = error.status === 403 ? 'denied' : 'expired'
              item.state = 'queued'
              await save(scope, item)
            }
          }
          return
        }
      }
      item = await decrypt(scope, id)
      if (!item || item.state !== 'revoking') return
      try {
        const response = await request<{ revoked: boolean }>(
          '/photos/' + item.photoId + '/cards/' + item.id, 'DELETE')
        current(scope)
        if (!response.revoked) return
        item.state = 'revoked'
        await save(scope, item)
      } catch {
        // Never treat 404 after lost create ACK as a completed revoke.
      }
    })
  }
}
export function flushCardShares(): Promise<void> {
  const scope = ownerScope()
  const previous = busy.get(scope)
  if (previous) return previous
  const job = flushScope(scope)
  const tracked = job.finally(() => { busy.delete(scope) })
  busy.set(scope, tracked)
  return tracked
}
export async function purgeCardShareIntents(owner: string, device?: string): Promise<void> {
  const database = await db()
  const prefix = owner + ':' + (device || '')
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite')
    const req = tx.objectStore('records').openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const id = String(cursor.key)
      if (id.startsWith(prefix + (device ? ':' : ''))) cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => { database.close(); resolve() }
    tx.onabort = () => { database.close(); reject(new Error('card_share.no_storage')) }
  })
}
