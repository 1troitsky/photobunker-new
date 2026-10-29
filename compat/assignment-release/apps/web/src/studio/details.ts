import type { Photo, PhotoChanges } from '../local/photos'
import { s } from './text'

export class PhotoDetailsError extends Error {}
export type PhotoDetailsDraft = { title: string; note: string; category: string; tags: string; latitude: string; longitude: string }
export function detailsFor(photo?: Photo): PhotoDetailsDraft {
  return { title: photo?.title ?? '', note: photo?.note ?? '', category: photo?.category ?? '', tags: (photo?.tags ?? []).join(', '), latitude: String(photo?.metadata?.location?.latitude ?? ''), longitude: String(photo?.metadata?.location?.longitude ?? '') }
}
export function detailsDirty(photo: Photo | undefined, draft: PhotoDetailsDraft) { return !!photo && JSON.stringify(detailsFor(photo)) !== JSON.stringify(draft) }
export function categoryLimited(photo: Photo) { return photo.uiRules?.particularCategory ?? (!photo.uiOnly && !!photo.profile?.rules.categories.length) }
export function detailsChanges(photo: Photo, draft: PhotoDetailsDraft): PhotoChanges {
  const tags = [...new Set(draft.tags.split(',').map(item => item.trim()).filter(Boolean))]
  if (tags.length > 20 || tags.some(item => item.length > 40)) throw new PhotoDetailsError(s('required'))
  const category = draft.category.trim()
  if (categoryLimited(photo) && category && !photo.profile?.rules.categories.includes(category)) throw new PhotoDetailsError(s('invalidCategory'))
  const changes: PhotoChanges = { title: draft.title, note: draft.note, category, tags, favorite: photo.favorite }
  const original = detailsFor(photo)
  if (original.latitude !== draft.latitude || original.longitude !== draft.longitude) {
    const latitude = Number(draft.latitude.trim().replace(',', '.')), longitude = Number(draft.longitude.trim().replace(',', '.'))
    const empty = !draft.latitude.trim() && !draft.longitude.trim()
    if (!empty && (!draft.latitude.trim() || !draft.longitude.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)) throw new PhotoDetailsError(s('invalidCoordinates'))
    changes.metadata = { ...photo.metadata, location: empty ? undefined : { latitude, longitude, source: 'manual' }, locationStatus: undefined, locationEditedAt: Date.now() }
  }
  return changes
}
