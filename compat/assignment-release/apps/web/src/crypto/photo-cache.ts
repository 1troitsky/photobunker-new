import { appLocked } from '../app/lock'
import { account, deviceId } from '../identity/store'
import type { Photo } from '../local/photos'
import * as db from './database'

type Wrapped = {
  iv: Uint8Array<ArrayBuffer>
  ciphertext: ArrayBuffer
  savedAt: number
  expiresAt?: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MAX_THUMBNAILS = 120
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024

function ownerScope() {
  const owner = account.value?.id
  const device = deviceId.value
  if (!owner || !device || appLocked.value) throw new Error('photo_cache.locked')
  return `${owner}:${device}`
}

function keyId(scope: string) { return `photo-cache-key:${scope}` }

async function cacheKey(scope: string): Promise<CryptoKey> {
  const existing = await db.get<CryptoKey>(keyId(scope))
  if (existing && !existing.extractable) return existing
  const create = async () => {
    const current = await db.get<CryptoKey>(keyId(scope))
    if (current && !current.extractable) return current
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    )
    if (scope !== ownerScope()) throw new Error('photo_cache.cancelled')
    await db.put(keyId(scope), key)
    return key
  }
  return navigator.locks
    ? navigator.locks.request(`photobunker-photo-cache:${scope}`, create)
    : create()
}

async function seal(scope: string, clear: Uint8Array, expiresAt?: number): Promise<Wrapped> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(scope) },
    await cacheKey(ownerScope()),
    clear as Uint8Array<ArrayBuffer>,
  )
  return { iv, ciphertext, savedAt: Date.now(), expiresAt }
}

async function open(scope: string, row: Wrapped): Promise<Uint8Array> {
  if (row.expiresAt !== undefined && row.expiresAt <= Date.now())
    throw new Error('photo_cache.expired')
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: row.iv, additionalData: encoder.encode(scope) },
    await cacheKey(ownerScope()),
    row.ciphertext,
  )
  return new Uint8Array(clear)
}

function indexId(scope: string) { return `photo-index:${scope}` }

export async function readCachedPhotoIndex(): Promise<Photo[]> {
  const owner = account.value?.id
  const scope = ownerScope()
  const id = indexId(scope)
  const row = await db.get<Wrapped>(id)
  if (!row) return []
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const value = JSON.parse(decoder.decode(await open(id, row))) as Photo[]
      if (!Array.isArray(value)) throw new Error('photo_cache.invalid')
      const visible = value.filter(photo =>
        photo.accountId === owner && !photo.deleteRequested &&
        (photo.expiresAt === undefined || photo.expiresAt > Date.now()),
      )
      if (visible.length !== value.length) void rememberPhotoIndex(visible)
      return visible
    } catch {
      // Account/app-lock transitions and an IndexedDB transaction overlap are
      // temporary. Never destroy a durable encrypted index merely because one
      // read failed; a later authoritative refresh may safely replace it.
      if (!attempt) await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  return []
}

export async function rememberPhotoIndex(photos: Photo[]): Promise<void> {
  const owner = account.value?.id
  const scope = ownerScope()
  const id = indexId(scope)
  const safe = photos.filter(photo =>
    photo.accountId === owner && !photo.deleteRequested &&
    (photo.expiresAt === undefined || photo.expiresAt > Date.now()),
  )
  const clear = encoder.encode(JSON.stringify(safe))
  try { await db.put(id, await seal(id, clear)) }
  finally { clear.fill(0) }
}

function thumbnailPrefix(scope: string) { return `photo-thumb:${scope}:` }
function thumbnailId(scope: string, photoId: string, version: string) {
  return `${thumbnailPrefix(scope)}${photoId}:${version}`
}

function pack(blob: Blob, bytes: Uint8Array): Uint8Array {
  const mime = encoder.encode(blob.type || 'image/webp')
  const packed = new Uint8Array(2 + mime.byteLength + bytes.byteLength)
  new DataView(packed.buffer).setUint16(0, mime.byteLength)
  packed.set(mime, 2)
  packed.set(bytes, 2 + mime.byteLength)
  return packed
}

function unpack(value: Uint8Array): Blob {
  if (value.byteLength < 3) throw new Error('photo_cache.invalid')
  const mimeBytes = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint16(0)
  if (!mimeBytes || mimeBytes > 128 || 2 + mimeBytes >= value.byteLength)
    throw new Error('photo_cache.invalid')
  const type = decoder.decode(value.slice(2, 2 + mimeBytes))
  return new Blob([value.slice(2 + mimeBytes)], { type })
}

export async function readCachedThumbnail(
  photoId: string,
  version = 'current',
): Promise<Blob | undefined> {
  const scope = ownerScope()
  const id = thumbnailId(scope, photoId, version)
  const row = await db.get<Wrapped>(id)
  if (!row) return
  try { return unpack(await open(id, row)) }
  catch {
    await db.remove(id).catch(() => {})
    return
  }
}

export async function rememberThumbnail(
  photoId: string,
  version: string,
  blob: Blob,
  expiresAt?: number,
): Promise<void> {
  if (!blob.size || blob.size > MAX_THUMBNAIL_BYTES ||
      (expiresAt !== undefined && expiresAt <= Date.now())) return
  const scope = ownerScope()
  const id = thumbnailId(scope, photoId, version)
  const packed = pack(blob, new Uint8Array(await blob.arrayBuffer()))
  try {
    await db.put(id, await seal(id, packed, expiresAt))
    const rows = await db.entries<Wrapped>(thumbnailPrefix(scope))
    for (const stale of rows.filter(item =>
      item.key !== id && item.key.startsWith(`${thumbnailPrefix(scope)}${photoId}:`)))
      await db.remove(stale.key)
    const live = rows.filter(item => item.value.expiresAt === undefined || item.value.expiresAt > Date.now())
      .sort((a, b) => b.value.savedAt - a.value.savedAt)
    for (const stale of rows.filter(item => item.value.expiresAt !== undefined && item.value.expiresAt <= Date.now()))
      await db.remove(stale.key)
    for (const stale of live.slice(MAX_THUMBNAILS)) await db.remove(stale.key)
  } finally { packed.fill(0) }
}

export async function purgeExpiredPhotoCache(): Promise<void> {
  const scope = ownerScope()
  const rows = await db.entries<Wrapped>(thumbnailPrefix(scope))
  for (const row of rows)
    if (row.value.expiresAt !== undefined && row.value.expiresAt <= Date.now())
      await db.remove(row.key)
}

export async function removeCachedPhoto(photoId: string): Promise<void> {
  const scope = ownerScope()
  const prefix = `${thumbnailPrefix(scope)}${photoId}:`
  for (const row of await db.entries<Wrapped>(prefix)) await db.remove(row.key)

  const id = indexId(scope)
  const row = await db.get<Wrapped>(id)
  if (!row) return
  try {
    const photos = JSON.parse(decoder.decode(await open(id, row))) as Photo[]
    if (!Array.isArray(photos)) throw new Error('photo_cache.invalid')
    const next = photos.filter(photo => photo.id !== photoId)
    if (next.length !== photos.length) await rememberPhotoIndex(next)
  } catch {
    await db.remove(id).catch(() => {})
  }
}
