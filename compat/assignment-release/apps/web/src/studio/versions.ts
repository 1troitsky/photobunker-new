import { protectionEnabled } from '../crypto/store'
import * as encryptedVersions from '../crypto/versions'
import { photo as workspacePhoto } from '../workspace/api'
import { account } from '../identity/store'
import type { Photo } from '../local/photos'
import { readMetadata } from '../local/photos'
import { isExpired } from '../delivery/clock'
import * as repository from './repository'

export type Point = { x: number; y: number }
export type Stroke = {
  id: string
  tool: 'brush' | 'pencil' | 'eraser'
  points: Point[]
  width: number
  color: string
  opacity: number
}
export type TextLayer = {
  rotation?: number
  mirror?: boolean
  id: string
  text: string
  x: number
  y: number
  size: number
  color: string
}
export type ShapeLayer = {
  id: string
  kind: 'rectangle' | 'ellipse' | 'redact'
  from: Point
  to: Point
  color: string
  width: number
  // Older stored shapes default to outline; redaction always remains solid.
  filled?: boolean
}
export type EditDocument = {
  shapes?: ShapeLayer[]
  watermark?: string
  rotation: number
  mirror: boolean
  crop: 'native' | '1:1' | '4:3' | '3:2' | '16:9'
  brightness: number
  contrast: number
  saturation: number
  text: string
  strokes: Stroke[]
  texts: TextLayer[]
}
export type PhotoVersion = {
  id: string
  revision: number
  baseId?: string | null
  sync?: 'pending' | 'synced'
  conflict?: boolean
  parentId: string
  localParent: boolean
  createdAt: number
  expiresAt?: number
  blob: Blob
  width: number
  height: number
  edits: EditDocument
}
export const emptyEdits = (): EditDocument => ({
  rotation: 0,
  mirror: false,
  crop: 'native',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  text: '',
  shapes: [],
  watermark: '',
  strokes: [],
  texts: [],
})
const scope = (photo: Photo) =>
  photo.accountId
    ? `account:${photo.accountId}`
    : photo.remoteLibraryId || 'device'
type StoredVersion = Omit<PhotoVersion, 'blob'> & {
  blob?: Blob
  bytes?: ArrayBuffer
  mime?: string
}
export async function listPhotoVersions(photo: Photo): Promise<PhotoVersion[]> {
  if (photo.encrypted) return encryptedVersions.list(photo)
  const versions = await repository.list<StoredVersion>(
    scope(photo),
    `versions:${photo.id}`,
  )
  return versions.map((version) => {
    if (!version.blob && !version.bytes) throw new Error('version.unavailable')
    return {
      ...version,
      blob:
        version.blob ??
        new Blob([version.bytes!], { type: version.mime ?? 'image/jpeg' }),
    }
  })
}
export async function savePhotoVersion(
  photo: Photo,
  blob: Blob,
  width: number,
  height: number,
  edits: EditDocument,
  baseId: string | null = null,
): Promise<PhotoVersion> {
  if (
    isExpired(photo) ||
    photo.deleteRequested ||
    photo.access?.role === 'viewer' ||
    (photo.workspaceAccess && !photo.workspaceAccess.edit) ||
    (photo.accountId && photo.accountId !== account.value?.id) ||
    !blob.size ||
    blob.size > 64 * 1024 * 1024
  )
    throw new DOMException('Photo unavailable', 'NotAllowedError')
  if (photo.accountId && protectionEnabled.value && !photo.encrypted)
    throw new Error('crypto.migrate_first')
  if (photo.encrypted)
    return encryptedVersions.save(
      photo,
      blob,
      width,
      height,
      edits,
      undefined,
      undefined,
      baseId,
    )
  const bytes = await blob.arrayBuffer()
  const version = await repository.save(
    scope(photo),
    `versions:${photo.id}`,
    {
      id: crypto.randomUUID(),
      revision: 0,
      parentId: photo.id,
      localParent:
        (!photo.accountId && !!photo.uiOnly) ||
        (!!photo.accountId && photo.remoteRevision === undefined),
      createdAt: Date.now(),
      expiresAt: photo.expiresAt,
      bytes,
      mime: blob.type,
      width,
      height,
      edits: JSON.parse(JSON.stringify(edits)),
    },
    0,
  )
  const current =
    photo.accountId && photo.remoteRevision
      ? await workspacePhoto(photo.id).catch(() => undefined)
      : photo.uiOnly
        ? await readMetadata(photo.id)
        : photo
  if (!current || current.deleteRequested || isExpired(current)) {
    await repository.remove(scope(photo), `versions:${photo.id}`, version)
    throw new DOMException('Photo unavailable', 'NotFoundError')
  }
  return { ...version, blob: new Blob([bytes], { type: blob.type }) }
}
export async function removePhotoVersions(photo: Photo) {
  if (photo.encrypted) return encryptedVersions.removeFor(photo)
  for (const version of await listPhotoVersions(photo))
    await repository.remove(scope(photo), `versions:${photo.id}`, version)
}
export async function cleanupVersions(owner: string) {
  if (owner.startsWith('account:')) await encryptedVersions.cleanup()
  for (const version of await repository.list<PhotoVersion>(
    owner,
    'versions:',
    true,
  )) {
    const parent = version.localParent
      ? await readMetadata(version.parentId)
      : undefined
    if (
      (version.expiresAt !== undefined && version.expiresAt <= Date.now()) ||
      (version.localParent &&
        (!parent || parent.deleteRequested || isExpired(parent)))
    )
      await repository.remove(owner, `versions:${version.parentId}`, version)
  }
}
