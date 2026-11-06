import type { Photo } from '../local/photos'
import { readPrivateCardPhoto } from './photo-card-reader'
import { listPhotoVersions, savePhotoVersion, emptyEdits } from './versions'
import { externalPhotoFile } from './export'
import { readPhoto } from '../server/photos'
import { account } from '../identity/store'
import { photoReadAllowed } from '../crypto/store'
import { isExpired } from '../delivery/clock'

/** Explicit Publish prepares a sanitized derivative; it never shares raw original bytes. */
export async function prepareCardPhotoVersion(photoId: string) {
  const owner = account.value?.id
  if (!owner || !photoReadAllowed()) throw new Error('card_share.locked')
  const current = await readPrivateCardPhoto(photoId)
  const versions = await listPhotoVersions(current)
  if (versions.length) {
    // A pending/redacted edit must never fall back to pixels of the original.
    const latest = versions.slice().sort((a,b) => b.createdAt-a.createdAt)[0]!
    if (latest.sync !== 'synced' || latest.conflict || (latest.expiresAt !== undefined && latest.expiresAt <= Date.now()))
      throw new Error('version.unavailable')
    return latest
  }
  const { photo, blob } = await readPhoto(photoId)
  if (photo.accountId !== owner || !photo.workspaceAccess?.read ||
      !photo.workspaceAccess.shareExternal || !photo.workspaceAccess.edit || !photo.encrypted)
    throw new Error('card_share.denied')
  const safe = await externalPhotoFile(photo, blob)
  if (account.value?.id !== owner || !photoReadAllowed()) throw new Error('card_share.account_changed')
  const version = await savePhotoVersion(photo, safe, photo.width, photo.height, emptyEdits())
  if (version.sync !== 'synced' || version.conflict) throw new Error('version.unavailable')
  return version
}

/**
 * A safe photo is a committed flattened JPEG version: either an explicit edit
 * or the sanitized derivative prepared on Publish for a never-edited capture.
 * Do not select original, thumbnail, or a draft edit as fallback.
 */
export async function shareCardImages(photoId:string, versionId:string|null,
  originalSelected:boolean):Promise<{
  photo?:{blob:Blob;versionId:string}; original?:Blob
}> {
  const owner=account.value?.id
  if (!owner || !photoReadAllowed()) throw new Error('card_share.locked')
  const photo:Photo=await readPrivateCardPhoto(photoId)
  if (photo.accountId!==owner || !photo.workspaceAccess?.shareExternal ||
      !photo.workspaceAccess.read || photo.deleteRequested || isExpired(photo))
    throw new Error('card_share.denied')
  const result:{photo?:{blob:Blob;versionId:string};original?:Blob}={}
  if (versionId) {
    const versions=await listPhotoVersions(photo)
    const version=versions.find(v=>v.id===versionId)
    if (!version || version.parentId!==photoId || version.conflict ||
        (version.expiresAt!==undefined && version.expiresAt<=Date.now()))
      throw new Error('version.unavailable')
    if (version.blob.type!=='image/jpeg' || !version.blob.size)
      throw new Error('card_share.invalid_version')
    // Re-encode flattened pixels; no EXIF/XMP/IPTC/comments or layer JSON.
    result.photo={blob:await externalPhotoFile(photo,version.blob),versionId}
  }
  if (originalSelected) {
    const source=await readPhoto(photoId)
    if (!source.photo.workspaceAccess?.shareExternal || source.photo.id!==photoId)
      throw new Error('card_share.denied')
    // The immutable original is intentionally NOT flattened or redacted.
    result.original=source.blob
  }
  if (account.value?.id!==owner || !photoReadAllowed())
    throw new Error('card_share.account_changed')
  return result
}
