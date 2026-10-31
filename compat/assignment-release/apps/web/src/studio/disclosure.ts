import type { Photo } from '../local/photos'
import { s } from './text'

// A separate public projection; never spread an internal Photo into a share DTO.
export function externalPhotoData(photo: Photo) {
  return {
    title: photo.title,
    description: photo.note,
    category: photo.category ?? '',
    expiresAt: photo.expiresAt,
  }
}
export function capturePresetLabel(photo: Photo) {
  if (photo.captureContext?.standard) return s('standard')
  if (photo.captureContext)
    return `${photo.captureContext.presetName}${photo.captureContext.presetVersion ? ` · v${photo.captureContext.presetVersion}` : ''}`
  if (photo.profile) return `${photo.profile.name} · v${photo.profile.version}`
  return s('unknownPreset')
}
export function internalAuthor(photo: Photo): string | undefined {
  if (photo.captureContext?.author.kind === 'account')
    return photo.captureContext.author.publicId
  if (photo.uiOnly)
    return s(
      photo.captureContext?.author?.kind === 'device'
        ? 'youDevice'
        : 'unknownAuthor',
    )
  if (
    photo.spaceId &&
    photo.access &&
    ['owner', 'curator', 'contributor', 'viewer'].includes(photo.access.role)
  )
    return photo.creatorId || s('unknownAuthor')
  return undefined
}
