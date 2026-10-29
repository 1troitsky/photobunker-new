import * as cloud from './version-cloud'
import { lockGeneration } from './state'
import { IdentityError } from '../identity/api'
import { account } from '../identity/store'
import type { Photo } from '../local/photos'
import type { EditDocument, PhotoVersion } from '../studio/versions'
import { cachedContext, prepareContext, photoReadAllowed } from './store'
import * as db from './database'
import { encryptLocal, decryptLocal } from './photos'
import type { EncryptedObject, Packet } from './protocol'
type Object = {
  packet: Packet
  bytes: ArrayBuffer
  pending?: EncryptedObject['pending']
}
type StoredVersion = {
  id: string
  parentId: string
  expiresAt: number
  upload?: cloud.Upload
  synced?: boolean
  conflict?: boolean
  image: Object
  metadata: Object
}
const prefix = (id = '') => `version:${account.value?.id}:${id}`
export async function list(photo: Photo): Promise<PhotoVersion[]> {
  if (!photoReadAllowed() || photo.accountId !== account.value?.id)
    throw new Error('crypto.locked')
  const owner = account.value!.id,
    generation = lockGeneration.value,
    localPrefix = prefix(photo.id) + ':'
  const rows = await db.list<StoredVersion>(localPrefix),
    result: PhotoVersion[] = []
  for (const row of rows) {
    const expiresAt = Math.min(row.expiresAt, photo.expiresAt ?? Infinity)
    if (expiresAt < row.expiresAt) {
      row.expiresAt = expiresAt
      if (account.value?.id !== owner || lockGeneration.value !== generation)
        throw new Error('crypto.locked')
      await db.put(localPrefix + row.id, row)
    }
    if (expiresAt <= Date.now()) continue
    const meta = JSON.parse(
      await (
        await decryptLocal(row.metadata, {
          asset_id: photo.id,
          kind: 'metadata',
        })
      ).text(),
    ) as Omit<PhotoVersion, 'blob'> & { mime: string }
    if (
      meta.parentId !== photo.id ||
      meta.id !== row.id ||
      row.expiresAt > (meta.expiresAt ?? Number.MAX_SAFE_INTEGER)
    )
      throw new Error('crypto.invalid_version')
    const blob = await decryptLocal(row.image, {
      asset_id: photo.id,
      kind: 'local-version',
    })
    const value: PhotoVersion = {
      ...meta,
      sync: row.synced ? 'synced' : 'pending',
      conflict: row.conflict,
      expiresAt,
      blob: new Blob([blob], { type: meta.mime }),
    }
    if (!row.synced && photo.remoteRevision !== undefined && navigator.onLine) {
      try {
        await sync(photo, row, value)
        value.sync = 'synced'
        value.conflict = row.conflict
      } catch (error) {
        if (!transient(error)) throw error
      }
    }
    result.push(value)
  }
  if (photo.remoteRevision !== undefined && navigator.onLine) {
    try {
      const remote = await cloud.fetchVersions(photo)
      for (const value of remote) {
        const index = result.findIndex((v) => v.id === value.id)
        if (index >= 0) result[index] = value
        else result.push(value)
      }
    } catch (error) {
      if (!result.length || !transient(error)) throw error
    }
  }
  if (
    account.value?.id !== owner ||
    lockGeneration.value !== generation ||
    !photoReadAllowed()
  )
    throw new Error('crypto.locked')
  return result.sort((a, b) => b.createdAt - a.createdAt)
}
export async function save(
  photo: Photo,
  blob: Blob,
  width: number,
  height: number,
  edits: EditDocument,
  versionId?: string,
  originalCreatedAt?: number,
  baseId: string | null = null,
): Promise<PhotoVersion> {
  if (!photoReadAllowed() || photo.accountId !== account.value?.id)
    throw new Error('crypto.locked')
  const owner = account.value!.id,
    generation = lockGeneration.value
  const prepared = await cachedContext(photo.workspaceAssignmentId).catch(
      (error) =>
        navigator.onLine
          ? prepareContext(photo.workspaceAssignmentId)
          : Promise.reject(error),
    ),
    id = versionId ?? crypto.randomUUID(),
    createdAt = originalCreatedAt ?? Date.now(),
    expiresAt = photo.expiresAt ?? Number.MAX_SAFE_INTEGER
  const value = {
    id,
    revision: 1,
    baseId,
    parentId: photo.id,
    localParent: photo.remoteRevision === undefined,
    createdAt,
    expiresAt,
    width,
    height,
    edits: JSON.parse(JSON.stringify(edits)),
    mime: blob.type,
  }
  const image = await encryptLocal(
      blob,
      photo.id,
      'local-version',
      prepared.plan,
    ),
    metadata = await encryptLocal(
      new Blob([JSON.stringify(value)]),
      photo.id,
      'metadata',
      prepared.plan,
    )
  if (
    !photoReadAllowed() ||
    account.value?.id !== owner ||
    lockGeneration.value !== generation
  )
    throw new Error('crypto.locked')
  const row: StoredVersion = {
    id,
    parentId: photo.id,
    expiresAt,
    image,
    metadata,
  }
  await db.put(prefix(photo.id) + ':' + id, row)
  const result: PhotoVersion = { ...value, blob, sync: 'pending' }
  if (photo.remoteRevision !== undefined && navigator.onLine) {
    try {
      await sync(photo, row, result)
      result.sync = 'synced'
      result.conflict = row.conflict
    } catch {
      /* Encrypted draft stays available for explicit retry. */
    }
  }
  if (
    account.value?.id !== owner ||
    lockGeneration.value !== generation ||
    !photoReadAllowed()
  )
    throw new Error('crypto.locked')
  return result
}
export async function removeFor(photo: Photo) {
  for (const row of await db.list<StoredVersion>(prefix(photo.id) + ':'))
    await db.remove(prefix(photo.id) + ':' + row.id)
}
export async function cleanup() {
  for (const row of await db.list<StoredVersion>(prefix()))
    if (row.expiresAt <= Date.now())
      await db.remove(prefix(row.parentId) + ':' + row.id)
}

const syncing = new Map<string, Promise<void>>()
async function sync(photo: Photo, row: StoredVersion, value: PhotoVersion) {
  const owner = account.value!.id,
    generation = lockGeneration.value,
    key = prefix(photo.id) + ':' + row.id
  const run = async () => {
    const latest = await db.get<StoredVersion>(key)
    if (!latest) throw new Error('crypto.invalid_version')
    if (latest.synced) {
      row.synced = true
      row.conflict = latest.conflict
      return
    }
    row.upload = latest.upload ?? (await cloud.prepare(photo, value))
    const valid = () => {
      if (
        account.value?.id !== owner ||
        lockGeneration.value !== generation ||
        !photoReadAllowed()
      )
        throw new Error('crypto.locked')
    }
    valid()
    await db.put(key, row)
    const result = await cloud.publish(photo, row.upload)
    valid()
    row.synced = true
    row.conflict = result.conflict
    delete row.upload
    await db.put(key, row)
  }
  let pending = syncing.get(key)
  if (!pending) {
    const task: Promise<void> = (
      navigator.locks
        ? navigator.locks.request('photobunker:' + key, run)
        : run()
    ).then(() => {})
    syncing.set(key, task)
    try {
      await task
    } finally {
      if (syncing.get(key) === task) syncing.delete(key)
    }
  } else {
    await pending
    const latest = await db.get<StoredVersion>(key)
    row.synced = latest?.synced
    row.conflict = latest?.conflict
  }
}

function transient(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof IdentityError &&
      (error.status >= 500 || error.status === 429))
  )
}
