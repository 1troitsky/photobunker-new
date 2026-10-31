import type { Photo } from '../local/photos'
import { isExpired } from '../delivery/clock'

/**
 * Internal-only presentation DTO. Never serialize Photo directly into a
 * share, route query, analytics or a public endpoint.
 * A Workspace/E2EE read grant is necessary for sensitive metadata. The
 * server/crypto layer is the authority; this projection only narrows it.
 */
export type PrivatePhotoCard = {
  id: string
  title: string
  nameId?: string
  namePending: boolean
  description?: string
  expiresAt?: number
  capturedAt?: number
  metadata?: {
    date?: string
    time?: string
    camera?: string
    width: number
    height: number
    bytes: number
    mime: string
    method: Photo['method']
    accuracy?: number
    locationSource?: 'gps' | 'manual'
  }
  location?: { latitude: number; longitude: number }
  author?: { publicId: string }
}

export function photoCardPath(id: string): string {
  return '/gallery/' + encodeURIComponent(id) + '/card'
}
function locationValid(value: unknown): value is { latitude: number; longitude: number; accuracy?: number; source?: 'gps' | 'manual' } {
  if (!value || typeof value !== 'object') return false
  const x = value as { latitude?: unknown; longitude?: unknown }
  return typeof x.latitude === 'number' && Number.isFinite(x.latitude) &&
    Math.abs(x.latitude) <= 90 && typeof x.longitude === 'number' &&
    Number.isFinite(x.longitude) && Math.abs(x.longitude) <= 180
}
function safeAuthor(photo: Photo): string | undefined {
  const fromCapture = photo.captureContext?.author
  if (fromCapture?.kind === 'account' && /^[a-zA-Z0-9_-]{2,128}$/.test(fromCapture.publicId))
    return fromCapture.publicId
  // Server creatorId is authenticated by Workspace/secure readback, but a
  // legacy locally inferred creatorId is not an author identity.
  if (photo.remoteRevision !== undefined && photo.accountId &&
      typeof photo.creatorId === 'string' && /^[a-zA-Z0-9_-]{2,128}$/.test(photo.creatorId))
    return photo.creatorId
  return undefined
}

export function privatePhotoCard(photo: Photo): PrivatePhotoCard {
  if (photo.deleteRequested || isExpired(photo) || photo.deliveryOnly)
    throw new Error('photo_card.unavailable')
  if (photo.workspaceAccess && !photo.workspaceAccess.thumbnail)
    throw new Error('photo_card.denied')
  if (!photo.accountId && photo.uploadOnly)
    throw new Error('photo_card.denied')

  // Never infer permission from knowing the UUID, the Team, or a share link.
  const full = photo.workspaceAccess ? photo.workspaceAccess.read === true
    : !photo.thumbnailOnly && photo.access?.role !== 'viewer'
  const meta = full ? photo.metadata : undefined
  const coordinates = meta && locationValid(meta.location) ? meta.location : undefined
  const creator = full ? safeAuthor(photo) : undefined
  const capturedAt = full
    ? (meta?.capturedAt && Number.isFinite(meta.capturedAt) && meta.capturedAt > 0
      ? meta.capturedAt : photo.createdAt)
    : undefined

  return {
    id: photo.id,
    title: photo.title || photo.shortId || '',
    nameId: photo.shortId || undefined,
    namePending: !!photo.needsName && !photo.shortId,
    // This is the existing editable description field from PhotoDetailsFields.
    // Never copy separate private Notes or any unlisted Photo keys into a card.
    ...(full && photo.note ? { description: photo.note } : {}),
    expiresAt: photo.expiresAt,
    ...(full && capturedAt ? { capturedAt } : {}),
    ...(full ? { metadata: {
      date: meta?.date,
      time: meta?.time,
      camera: meta?.camera,
      width: photo.width,
      height: photo.height,
      bytes: photo.bytes,
      mime: photo.mime,
      method: photo.method,
      ...(coordinates?.accuracy !== undefined && Number.isFinite(coordinates.accuracy)
        ? { accuracy: coordinates.accuracy } : {}),
      ...(coordinates?.source ? { locationSource: coordinates.source } : {}),
    } } : {}),
    ...(coordinates ? { location: { latitude: coordinates.latitude, longitude: coordinates.longitude } } : {}),
    ...(creator ? { author: { publicId: creator } } : {}),
  }
}
