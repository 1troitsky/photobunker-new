import { protectionEnabled } from '../crypto/store'
import { discardDraft } from '../crypto/photos'
import { account, identityReady, loadIdentity } from '../identity/store'
import * as workspace from '../workspace/photos'
import { photo as workspacePhoto } from '../workspace/api'
import { localVisible } from '../collaboration/access'
import { removePhotoVersions } from '../studio/versions'
import { isExpired } from '../delivery/clock'
import * as local from '../local/photos'
import type { Photo, PhotoChanges } from '../local/photos'
import {
  accessCode,
  accessLibraryId,
  belongsToServer,
  deleteServerPhoto,
  ensureAccess,
  ServerError,
  serverContent,
  serverPhoto,
  updateServerPhoto,
  uploadPhoto,
} from './api'

export async function readPhoto(
  id: string,
): Promise<{ photo: Photo; blob: Blob }> {
  const metadata = await local.readMetadata(id).catch(() => undefined)
  if (metadata?.accountId || (!metadata && !identityReady.value))
    await loadIdentity()
  if (metadata?.accountId || account.value) return workspace.read(id)
  if (metadata?.uiOnly) {
    if (
      metadata.remoteLibraryId &&
      metadata.remoteLibraryId !== accessLibraryId.value
    )
      throw new ServerError(403)
    return local.readPhoto(id)
  }
  if (
    metadata &&
    (!metadata.remoteLibraryId || belongsToServer(metadata)) &&
    (metadata.deleteRequested || !localVisible(metadata) || isExpired(metadata))
  )
    throw new ServerError(410)
  let result: { photo: Photo; blob: Blob } | undefined
  try {
    result = await local.readPhoto(id)
  } catch {
    /* Try the server if no local replica is readable. */
  }
  if (
    result?.photo.remoteLibraryId &&
    accessCode.value &&
    !belongsToServer(result.photo)
  )
    result = undefined
  if (result) {
    if (belongsToServer(result.photo)) {
      try {
        const remote = await serverPhoto(id)
        if (!result.photo.metadataDirty && !result.photo.uploadRequested) {
          await local.acceptServerMetadata(remote)
          result.photo = remote
        }
        if (remote.expiresAt !== undefined)
          result.photo.expiresAt = Math.min(
            result.photo.expiresAt ?? Infinity,
            remote.expiresAt,
          )
      } catch (error) {
        if (
          error instanceof ServerError &&
          error.status < 500 &&
          !(error.status === 404 && result.photo.remoteRevision === undefined)
        )
          throw error
      }
    }
    if (isExpired(result.photo) || result.photo.deleteRequested)
      throw new ServerError(410)
    return result
  }
  const photo = await serverPhoto(id)
  return {
    photo,
    blob: await serverContent(id, 'original', photo.mime, photo.bytes),
  }
}
export async function readThumbnail(id: string): Promise<Blob> {
  const metadata = await local.readMetadata(id).catch(() => undefined)
  if (metadata?.accountId || (!metadata && !identityReady.value))
    await loadIdentity()
  if (metadata?.accountId || account.value) return workspace.thumbnail(id)
  if (metadata?.uiOnly) {
    if (
      metadata.remoteLibraryId &&
      metadata.remoteLibraryId !== accessLibraryId.value
    )
      throw new ServerError(403)
    return local.readThumbnail(id)
  }
  if (
    metadata &&
    (!metadata.remoteLibraryId || belongsToServer(metadata)) &&
    (metadata.deleteRequested || !localVisible(metadata) || isExpired(metadata))
  )
    throw new ServerError(410)
  if (accessCode.value) {
    const meta = await local.readMetadata(id).catch(() => undefined)
    if (meta?.remoteLibraryId && !belongsToServer(meta))
      return serverContent(id, 'thumbnail', 'image/jpeg')
  }
  try {
    return await local.readThumbnail(id)
  } catch (error) {
    if (!accessCode.value) throw error
    return serverContent(id, 'thumbnail', 'image/jpeg')
  }
}
const uploads = new Map<string, Promise<Photo>>()
export function saveOnServer(id: string): Promise<Photo> {
  const running = uploads.get(id)
  if (running) return running
  const task = upload(id).finally(() => uploads.delete(id))
  uploads.set(id, task)
  return task
}
async function upload(id: string): Promise<Photo> {
  if (account.value || (await local.readMetadata(id))?.accountId)
    return workspace.upload(id)
  const { photo, blob } = await local.readPhoto(id, true)
  if (photo.uiOnly) throw new ServerError(409)
  if (photo.remoteLibraryId && !belongsToServer(photo))
    throw new ServerError(403)
  await ensureAccess()
  await local.patchPhoto(id, {
    uploadRequested: true,
    remoteLibraryId: accessLibraryId.value,
  })
  const result = await uploadPhoto(
    photo,
    blob,
    await local.readThumbnail(id, true),
  )
  // A deletion/expiry racing the request must never resurrect the local replica.
  const current = await local.readMetadata(id)
  if (!current || current.deleteRequested || isExpired(current)) {
    await deleteServerPhoto(id, photo.spaceId)
    throw new ServerError(410)
  }
  const sent = editable(current)
  // An earlier attempt may have committed before its response was lost.
  // Reconcile against the server's returned metadata, not just this attempt.
  const changed = !sameEditable(current, result)
  await local.patchPhoto(id, {
    access: result.access,
    uploadOnly: result.uploadOnly ?? current.uploadOnly,
    remoteRevision: result.remoteRevision,
    remoteLibraryId: result.remoteLibraryId,
    uploadRequested: false,
    metadataDirty: true,
    expiresAt:
      result.expiresAt === undefined
        ? current.expiresAt
        : Math.min(current.expiresAt ?? Infinity, result.expiresAt),
  })
  if (result.uploadOnly) await local.removeDeliveredFiles(id)
  if (changed && (result.remoteRevision ?? 1) > (photo.remoteRevision ?? 1))
    throw new ServerError(409)
  if (!changed) await local.patchPhoto(id, { metadataDirty: false }, sent)
  return changed ? syncMetadata(id) : (await local.readMetadata(id))!
}
function editable(photo: Photo) {
  return {
    title: photo.title,
    note: photo.note,
    favorite: photo.favorite,
    category: photo.category,
    tags: photo.tags,
    metadata: photo.metadata,
    expiresAt: photo.expiresAt,
  }
}
function sameEditable(requested: Photo, actual: Photo): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value
  const fields = (photo: Photo) => ({
    title: photo.title,
    note: photo.note,
    favorite: photo.favorite,
    category: photo.category ?? '',
    tags: photo.tags ?? [],
    metadata: photo.metadata ?? {},
  })
  return (
    JSON.stringify(canonical(fields(requested))) ===
      JSON.stringify(canonical(fields(actual))) &&
    (requested.expiresAt === undefined ||
      (actual.expiresAt !== undefined &&
        actual.expiresAt <= requested.expiresAt))
  )
}
export async function syncMetadata(id: string): Promise<Photo> {
  const photo = await local.readMetadata(id)
  if (!photo || photo.deleteRequested || isExpired(photo))
    throw new ServerError(410)
  if (photo.uiOnly) throw new ServerError(409)
  const sent = editable(photo)
  let result: Photo
  try {
    result = await updateServerPhoto(photo, sent)
  } catch (error) {
    if (!(error instanceof ServerError && error.status === 409)) throw error
    const remote = await serverPhoto(id)
    // A committed metadata response can be lost during navigation as well.
    // Recognize the exact saved state; different remote edits remain conflicts.
    if (!sameEditable(photo, remote)) throw error
    result = remote
  }
  const current = await local.readMetadata(id)
  if (!current || current.deleteRequested || isExpired(current))
    throw new ServerError(410)
  await local.patchPhoto(id, {
    remoteRevision: result.remoteRevision,
    expiresAt:
      result.expiresAt === undefined
        ? photo.expiresAt
        : Math.min(photo.expiresAt ?? Infinity, result.expiresAt),
  })
  await local.patchPhoto(id, { metadataDirty: false }, sent)
  return (await local.readMetadata(id))!
}
export async function updatePhoto(
  id: string,
  changes: PhotoChanges,
  expectedRevision?: number,
  expected?: Photo,
): Promise<Photo> {
  const metadata = await local.readMetadata(id).catch(() => undefined)
  if (metadata?.accountId || (!metadata && !identityReady.value))
    await loadIdentity()
  if(account.value&&protectionEnabled.value&&((expected&&!expected.encrypted)||(metadata?.accountId&&!metadata.encrypted)))throw new Error('crypto.migrate_first')
  if (metadata?.accountId || account.value)
    return workspace.update(id, changes, expectedRevision)
  if (metadata?.uiOnly) {
    if (
      metadata.remoteLibraryId &&
      metadata.remoteLibraryId !== accessLibraryId.value
    )
      throw new ServerError(403)
    return local.updatePhoto(id, { ...changes, metadataDirty: false })
  }
  if (
    metadata &&
    (!metadata.remoteLibraryId || belongsToServer(metadata)) &&
    (metadata.deleteRequested || isExpired(metadata))
  )
    throw new ServerError(410)
  let current: Photo | undefined
  try {
    current = await local.readMetadata(id)
  } catch {
    /* Server-only photos need no local replica. */
  }
  if (current?.remoteLibraryId && accessCode.value && !belongsToServer(current))
    current = undefined
  if (!current)
    return updateServerPhoto(
      {
        ...(await serverPhoto(id)),
        ...(expectedRevision ? { remoteRevision: expectedRevision } : {}),
      },
      changes,
    )
  if (isExpired(current) || current.deleteRequested) throw new ServerError(410)
  if (
    expectedRevision !== undefined &&
    current.remoteRevision !== expectedRevision &&
    (!expected || !sameEditable(expected, current))
  )
    throw new ServerError(409)
  const saved = await local.updatePhoto(id, { ...changes, metadataDirty: true })
  window.dispatchEvent(new Event('photobunker-outbox'))
  return saved
}
export async function deletePhoto(id: string): Promise<void> {
  if (account.value || (await local.readMetadata(id))?.accountId) {
    const source = await local.readMetadata(id).catch(() => undefined) ?? await workspacePhoto(id).catch(() => undefined)
    await workspace.remove(id)
    if (source) await removePhotoVersions(source)
    return
  }
  const current = await local.readMetadata(id).catch(() => undefined)
  if (current?.uiOnly) {
    if (
      current.remoteLibraryId &&
      current.remoteLibraryId !== accessLibraryId.value
    )
      throw new ServerError(403)
    await removePhotoVersions(current)
    await local.deletePhoto(id)
    await removePhotoVersions(current)
    return
  }
  if (!current || (current.remoteLibraryId && !belongsToServer(current))) {
    // Persist a server-only deletion intent without downloading the original.
    const photo = await serverPhoto(id)
    await local.recordDeletion(photo)
  } else await local.revokePhoto(id)
  if (current) await removePhotoVersions(current).catch(() => {})
  window.dispatchEvent(new Event('photobunker-outbox'))
}

export async function reloadFromServer(id: string) {
  if (account.value) { if(protectionEnabled.value)await discardDraft(id);return workspacePhoto(id) }
  const photo = await serverPhoto(id)
  await local.acceptServerMetadata(photo, true)
  window.dispatchEvent(new Event('photobunker-outbox'))
  return photo
}
