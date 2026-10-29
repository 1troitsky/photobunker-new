import { protectionEnabled, photoReadAllowed } from '../crypto/store'
import * as secure from '../crypto/photos'
import { restrictedThumbnail } from './thumbnail'
import { account } from '../identity/store'
import { IdentityError } from '../identity/api'
import {
  captureRetention,
  clockTime,
  isExpired,
  rememberAnchor,
} from '../delivery/clock'
import * as local from '../local/photos'
import type { Photo, PhotoChanges } from '../local/photos'
import * as api from './api'
import { ensureName } from '../local/photo-names'
import { pendingAccess, pendingGrant } from './access'
import { pendingCount, queueBusy, queueError } from './state'

export async function read(id: string) {
  if (protectionEnabled.value) { if (!photoReadAllowed()) throw new Error('crypto.locked'); try { return await secure.read(id) } catch (error) { if (!(error instanceof IdentityError && error.status === 404)) throw error } }
  const owner = account.value?.id
  if (!owner) throw new Error('workspace.no_account')
  const saved = await local.readMetadata(id).catch(() => undefined)
  if (saved?.accountId && saved.accountId !== owner)
    throw new Error('workspace.denied')
  if (saved?.uiVersionOf) {
    const parent = await api.photo(saved.uiVersionOf)
    if (!parent.workspaceAccess?.read) throw new Error('workspace.denied')
    return local.readPhoto(id)
  }
  if (
    saved?.accountId === owner &&
    saved.uploadRequested &&
    saved.remoteRevision === undefined
  ) {
    if (!pendingAccess(saved)) throw new Error('workspace.denied')
    const grant = pendingGrant(saved)
    const result = await local.readPhoto(id)
    return {
      photo: {
        ...result.photo,
        workspaceAccess: grant,
        thumbnailOnly: !grant.read,
      },
      blob: grant.read
        ? result.blob
        : await restrictedThumbnail(await local.readThumbnail(id)),
    }
  }
  const photo = await api.photo(id)
  const blob = await api.content(
    id,
    photo.thumbnailOnly ? 'thumbnail' : 'original',
    owner,
  )
  if (owner !== account.value?.id) throw new Error('workspace.cancelled')
  return { photo, blob }
}
export async function thumbnail(id: string) {
  if (protectionEnabled.value) { if (!photoReadAllowed()) throw new Error('crypto.locked'); try { return await secure.thumbnail(id) } catch (error) { if (!(error instanceof IdentityError && error.status === 404)) throw error } }
  const saved = await local.readMetadata(id).catch(() => undefined)
  if (saved?.accountId !== account.value?.id && saved?.accountId)
    throw new Error('workspace.denied')
  if (
    saved?.uploadRequested &&
    saved.remoteRevision === undefined &&
    pendingAccess(saved)
  ) {
    const blob = await local.readThumbnail(id)
    return pendingGrant(saved).read ? blob : restrictedThumbnail(blob)
  }
  if (saved?.uiVersionOf) {
    await api.photo(saved.uiVersionOf)
    return local.readThumbnail(id)
  }
  return api.content(id, 'thumbnail')
}
const uploads = new Map<string, Promise<Photo>>()
export function upload(id: string) {
  if (protectionEnabled.value) return secure.upload(id).then(async()=> (await secure.read(id)).photo)
  const existing = uploads.get(id)
  if (existing) return existing
  const result = send(id).finally(() => uploads.delete(id))
  uploads.set(id, result)
  return result
}
async function send(id: string) {
  const saved = await local.readMetadata(id),
    owner = account.value?.id
  if (
    !saved ||
    !owner ||
    saved.accountId !== owner ||
    isExpired(saved) ||
    saved.deleteRequested
  )
    throw new Error('workspace.denied')
  if (!saved.retentionSeconds || saved.retentionSeconds > 1209600)
    throw new Error('workspace.retention')
  if (!saved.retentionAnchor || !clockTime(`account:${owner}`).certain) {
    const anchor = await api.request<{ id: string; issuedAt: number }>(
      '/clock',
      'POST',
      undefined,
      owner,
    )
    rememberAnchor(`account:${owner}`, anchor)
    const retention = captureRetention(
      `account:${owner}`,
      saved.captureContext?.author.kind === 'account' ? saved.createdAt : Date.now(),
      saved.retentionSeconds,
    )
    await local.patchPhoto(id, {
      retentionAnchor: retention.retentionAnchor,
      expiresAt: Math.min(saved.expiresAt ?? Infinity, retention.expiresAt!),
    })
    Object.assign(saved, retention, {
      expiresAt: Math.min(saved.expiresAt ?? Infinity, retention.expiresAt!),
    })
  }
  const original = (await local.readPhoto(id, true)).blob,
    preview = await local.readThumbnail(id, true),
    thumb = await restrictedThumbnail(preview)
  const hash = async (blob: Blob) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  const [originalChecksum, thumbnailChecksum, previewChecksum] =
    await Promise.all([hash(original), hash(thumb), hash(preview)])
  if (owner !== account.value?.id) throw new Error('workspace.cancelled')
  if (saved.needsName) {
    const code = await ensureName(id, saved.nameAssignmentId ?? null, saved.shortId)
    if (owner !== account.value?.id) throw new Error('workspace.cancelled')
    await local.patchPhoto(id, {
      shortId: code, title: saved.title || code,
    })
    saved.shortId = code
    if (!saved.title) saved.title = code
  }
  const form = new FormData()
  const manifest = {
    ...saved,
    assignmentId: saved.workspaceAssignmentId,
    taskRevision: saved.uiTaskRevision,
    legacyImport: saved.captureContext?.author.kind !== 'account',
    originalChecksum,
    thumbnailChecksum,
    previewChecksum,
  }
  form.set('manifest', JSON.stringify(manifest))
  form.set('original', original, 'original')
  form.set('thumbnail', thumb, 'thumbnail')
  form.set('preview', preview, 'preview')
  const result = await api.request<{ photo: Photo }>(
    '/photos',
    'POST',
    form,
    owner,
  )
  if (owner !== account.value?.id) throw new Error('workspace.cancelled')
  const current = await local.readMetadata(id)
  if (!current || current.deleteRequested || isExpired(current)) {
    await api.request(`/photos/${id}`, 'DELETE', undefined, owner)
    throw new Error('workspace.expired')
  }
  const changed =
    JSON.stringify(editable(current)) !== JSON.stringify(editable(saved))
  const acknowledged = {
    remoteRevision: result.photo.remoteRevision,
    workspaceAccess: result.photo.workspaceAccess,
    workspaceVaultId: result.photo.workspaceVaultId,
    uploadOnly: result.photo.uploadOnly,
    thumbnailOnly: result.photo.thumbnailOnly,
    uploadRequested: false,
    shortId: result.photo.shortId ?? saved.shortId,
    expiresAt: Math.min(
      current.expiresAt ?? Infinity,
      result.photo.expiresAt ?? Infinity,
    ),
    ...(result.photo.captureContext
      ? { captureContext: result.photo.captureContext }
      : {}),
  }
  await local.patchPhoto(id, acknowledged)
  if (changed) await update(id, editable(current), result.photo.remoteRevision)
  else await local.patchPhoto(id, { metadataDirty: false }, editable(current))
  if (result.photo.uploadOnly || result.photo.thumbnailOnly)
    await local.removeDeliveredFiles(id)
  return result.photo
}
export async function update(
  id: string,
  changes: PhotoChanges,
  revision?: number,
) {
  if (protectionEnabled.value) return secure.update(id, changes, revision)
  const saved = await local.readMetadata(id).catch(() => undefined)
  if (
    saved &&
    account.value &&
    saved.accountId === account.value.id &&
    saved.uploadRequested &&
    saved.remoteRevision === undefined
  )
    return local.updatePhoto(id, { ...changes, metadataDirty: true })
  if (
    saved &&
    saved.accountId === account.value?.id &&
    saved.uploadOnly &&
    changes.metadata
  ) {
    if (
      changes.title !== saved.title ||
      changes.note !== saved.note ||
      changes.favorite !== saved.favorite
    )
      throw new Error('workspace.denied')
    const owner = saved.accountId
    const result = await api.request<{ remoteRevision: number }>(
      `/photos/${id}/capture-metadata`,
      'POST',
      {
        revision: revision ?? saved.remoteRevision,
        metadata: changes.metadata,
      },
      owner,
    )
    if (owner !== account.value?.id) throw new Error('workspace.cancelled')
    await local.patchPhoto(id, { remoteRevision: result.remoteRevision })
    return local.patchPhoto(id, { ...changes, metadataDirty: false })
  }
  const photo = await api.photo(id)
  if (!photo.workspaceAccess?.edit) throw new Error('workspace.denied')
  const result = await api.update(
    { ...photo, remoteRevision: revision ?? photo.remoteRevision },
    changes,
  )
  if (saved && account.value && saved.accountId === account.value.id)
    await local.patchPhoto(id, { ...result, metadataDirty: false })
  return result
}
export async function remove(id: string) {
  if (protectionEnabled.value) return secure.remove(id)
  const saved = await local.readMetadata(id).catch(() => undefined)
  if (saved?.accountId && saved.accountId !== account.value?.id)
    throw new Error('workspace.denied')
  if (saved?.uploadRequested && saved.remoteRevision === undefined) {
    if (!pendingGrant(saved).delete) throw new Error('workspace.denied')
    await local.deletePhoto(id)
    return
  }
  await api.request(`/photos/${id}`, 'DELETE')
  await local.deletePhoto(id)
}
export async function deliver() {
  if (protectionEnabled.value) return secure.deliver()
  if (queueBusy.value || !account.value || !navigator.onLine) return
  const owner = account.value.id
  queueBusy.value = true
  try {
    const rows = (await local.listPhotos()).filter(
      (photo) =>
        photo.accountId === owner &&
        (photo.uploadRequested || photo.metadataDirty) &&
        !photo.uiVersionOf &&
        !photo.deleteRequested &&
        !isExpired(photo),
    )
    pendingCount.value = rows.length
    queueError.value = ''
    for (const photo of rows) {
      if (account.value?.id !== owner) break
      try {
        if (photo.uploadRequested) await upload(photo.id)
        else await update(photo.id, editable(photo), photo.remoteRevision)
        pendingCount.value = Math.max(0, pendingCount.value - 1)
      } catch (error) {
        if (account.value?.id !== owner) break
        queueError.value =
          error instanceof Error && error.message === 'workspace.retention'
            ? 'retention'
            : error instanceof IdentityError &&
                [401, 403, 404, 409, 410, 422].includes(error.status)
              ? 'permission'
              : 'network'
        break
      }
    }
  } finally {
    queueBusy.value = false
  }
}

function editable(photo: Photo): PhotoChanges {
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
