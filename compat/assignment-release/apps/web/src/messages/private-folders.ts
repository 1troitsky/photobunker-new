import { ref } from 'vue'
import { account, deviceId } from '../identity/store'
import { appLocked } from '../app/lock'

/**
 * Per-device private chat folders. Names/room IDs are AES-GCM encrypted in
 * IndexedDB. No Matrix account_data, analytics, service-worker cache,
 * localStorage or server API writes. This is intentionally NOT cross-device.
 *
 * Note: a non-extractable same-origin IndexedDB key protects data at rest, not
 * against an active same-origin XSS. Respect the app's existing CSP/lock flow.
 */
export type PrivateFolder = { id: string; name: string; roomIds: string[] }
export const privateFolders = ref<PrivateFolder[]>([])
const DB_NAME = 'photobunker-private-messenger-folders-v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
type Sealed = { iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer; version: 1 }
type Row = CryptoKey | Sealed
function scope() {
  if (!account.value?.id || !deviceId.value || appLocked.value) throw new Error('folders.locked')
  return account.value.id + ':' + deviceId.value
}
function open(): Promise<IDBDatabase> {
  if (!indexedDB || !crypto.subtle) return Promise.reject(new Error('folders.unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('private')
    request.onerror = () => reject(new Error('folders.unavailable'))
    request.onblocked = () => reject(new Error('folders.unavailable'))
    request.onsuccess = () => resolve(request.result)
  })
}
async function get<T extends Row>(id: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('private', 'readonly')
    const req = tx.objectStore('private').get(id)
    tx.oncomplete = () => { db.close(); resolve(req.result as T | undefined) }
    tx.onerror = () => { db.close(); reject(new Error('folders.unavailable')) }
  })
}
async function put(id: string, value: Row): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('private', 'readwrite')
    tx.objectStore('private').put(value, id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(new Error('folders.unavailable')) }
  })
}
// Initial key creation must be serialized by IndexedDB's write transaction:
// two tabs must never replace each other's nonextractable encryption key.
async function createKeyIfAbsent(id: string, key: CryptoKey): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('private', 'readwrite')
    const store = tx.objectStore('private')
    const request = store.get(id)
    request.onsuccess = () => { if (!request.result) store.add(key, id) }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(new Error('folders.unavailable')) }
    tx.onerror = () => { db.close(); reject(new Error('folders.unavailable')) }
  })
}
async function keyFor(owner: string) {
  const id = 'key:' + owner
  let key = await get<CryptoKey>(id)
  if (key) return key
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  if (owner !== scope()) throw new Error('folders.cancelled')
  // UI serializes mutations; two fresh tabs could still generate different
  // keys. A read-after-write ensures the matching key is loaded.
  await createKeyIfAbsent(id, key)
  if (owner !== scope()) throw new Error('folders.cancelled')
  const stored = await get<CryptoKey>(id)
  if (!stored) throw new Error('folders.unavailable')
  return stored
}
export function validateFolderName(name: string) {
  const result = name.trim().replace(/\s+/g, ' ')
  if (!result || result.length > 40 || /[\u0000-\u001f\u007f]/.test(result)) throw new Error('folders.name')
  return result
}
export function cleanFolders(value: unknown): PrivateFolder[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('folders.corrupt')
  return value.map(item => {
    if (!item || typeof item !== 'object' || !('id' in item) || !('name' in item) ||
        typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(item.id) ||
        typeof item.name !== 'string' || !Array.isArray(item.roomIds)) throw new Error('folders.corrupt')
    const name = validateFolderName(item.name)
    const roomIds: string[] = (item.roomIds as unknown[]).filter((id): id is string =>
      typeof id === 'string' && id.startsWith('!') && id.length <= 255)
    if (roomIds.length > 200) throw new Error('folders.corrupt')
    return { id: item.id as string, name, roomIds: [...new Set<string>(roomIds)] }
  })
}
export function clearPrivateFolders() { privateFolders.value = [] }
/** R1-07 explicit account/device cleanup, never clears another user's folders. */
export async function eraseLocalDeleteFolders(owner: string, device: string) {
  const db = await open()
  await new Promise<void>((resolve,reject) => {
    const tx = db.transaction('private', 'readwrite', {durability:'strict'})
    tx.objectStore('private').delete('key:' + owner + ':' + device)
    tx.objectStore('private').delete('data:' + owner + ':' + device)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(new Error('localDelete.storage')) }
  })
  if (account.value?.id === owner && deviceId.value === device) clearPrivateFolders()
}
export async function loadPrivateFolders() {
  const owner = scope()
  const row = await get<Sealed>('data:' + owner)
  if (!row) { if (owner === scope()) privateFolders.value = []; return }
  if (row.version !== 1 || !(row.iv instanceof Uint8Array)) throw new Error('folders.corrupt')
  const key = await keyFor(owner)
  const bytes = new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: row.iv, additionalData: encoder.encode(owner),
  }, key, row.ciphertext))
  try {
    const folders = cleanFolders(JSON.parse(decoder.decode(bytes)))
    if (owner === scope()) privateFolders.value = folders
  } finally { bytes.fill(0) }
}
async function save(next: PrivateFolder[]) {
  const owner = scope()
  const valid = cleanFolders(next)
  const key = await keyFor(owner), iv = crypto.getRandomValues(new Uint8Array(12))
  const bytes = encoder.encode(JSON.stringify(valid))
  try {
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: encoder.encode(owner),
    }, key, bytes)
    if (owner !== scope()) throw new Error('folders.cancelled')
    await put('data:' + owner, { iv, ciphertext, version: 1 } satisfies Sealed)
    if (owner !== scope()) throw new Error('folders.cancelled')
    privateFolders.value = valid
  } finally { bytes.fill(0) }
}
export async function createPrivateFolder(name: string) {
  const clean = validateFolderName(name)
  if (privateFolders.value.length >= 30 ||
      privateFolders.value.some(x => x.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error('folders.name')
  await save([...privateFolders.value, { id: crypto.randomUUID(), name: clean, roomIds: [] }])
}
export async function renamePrivateFolder(id: string, name: string) {
  const clean = validateFolderName(name)
  if (!privateFolders.value.some(x => x.id === id) ||
      privateFolders.value.some(x => x.id !== id && x.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error('folders.name')
  await save(privateFolders.value.map(x => x.id === id ? { ...x, name: clean } : x))
}
export async function deletePrivateFolder(id: string) {
  await save(privateFolders.value.filter(x => x.id !== id))
}
export async function toggleRoomFolder(folderId: string, roomId: string) {
  if (!roomId.startsWith('!') || roomId.length > 255 ||
      !privateFolders.value.some(x => x.id === folderId)) throw new Error('folders.invalid')
  await save(privateFolders.value.map(x => x.id !== folderId ? x : ({
    ...x, roomIds: x.roomIds.includes(roomId) ?
      x.roomIds.filter(id => id !== roomId) : [...x.roomIds, roomId],
  })))
}
