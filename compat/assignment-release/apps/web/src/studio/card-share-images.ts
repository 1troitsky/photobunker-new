import type { Photo } from '../local/photos'
import { readPrivateCardPhoto } from './photo-card-reader'
import { listPhotoVersions } from './versions'
import { externalPhotoFile } from './export'
import { readPhoto } from '../server/photos'
import { account } from '../identity/store'
import { photoReadAllowed } from '../crypto/store'
import { isExpired } from '../delivery/clock'

/**
 * A safe photo is *only* the flattened JPEG committed by PhotoEditView via
 * renderEdits -> toBlob -> stripEncodedMetadata -> savePhotoVersion.
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
