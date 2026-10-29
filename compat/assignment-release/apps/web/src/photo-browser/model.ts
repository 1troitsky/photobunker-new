import type { Photo } from '../local/photos'

export type BrowserAssignment = { id: string; name: string }
export type BrowserCollection = {
  id: string
  assignments: BrowserAssignment[]
  expiresAt: number
  canRevoke: boolean
}
export type BrowserPhoto = {
  id: string
  assignmentId: string
  label: string
  createdAt: number
  expiresAt: number
}
export type BrowserSnapshot = {
  collection: BrowserCollection
  photos: BrowserPhoto[]
  pending?: { assignmentIds: string[] }
}

export function visibleBrowserPhotos(
  collection: BrowserCollection,
  items: Photo[],
  owner: string,
  now = Date.now(),
): BrowserPhoto[] {
  const allowed = new Set(collection.assignments.map(item => item.id))
  if (collection.expiresAt <= now) return []
  return items.filter(photo =>
    photo.accountId === owner &&
    !!photo.workspaceAssignmentId && allowed.has(photo.workspaceAssignmentId) &&
    photo.workspaceAccess?.thumbnail === true &&
    photo.remoteRevision !== undefined &&
    !photo.uiVersionOf && !photo.deleteRequested &&
    !photo.deliveryOnly && !photo.uploadOnly &&
    (photo.expiresAt === undefined || photo.expiresAt > now),
  ).map(photo => ({
    id: photo.id,
    assignmentId: photo.workspaceAssignmentId!,
    // Thumbnail-only grants do not reveal private title/description, tags or GPS.
    label: photo.workspaceAccess?.read === true
      ? (photo.title || photo.shortId || '')
      : (photo.shortId || ''),
    createdAt: photo.workspaceAccess?.read === true && Number.isFinite(photo.createdAt) ? photo.createdAt : 0,
    expiresAt: Math.min(collection.expiresAt, photo.expiresAt ?? collection.expiresAt),
  })).filter(photo => photo.expiresAt > now)
}
