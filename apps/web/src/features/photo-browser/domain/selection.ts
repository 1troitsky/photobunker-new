import type {BrowserPhoto} from './model'

export const MAX_ZIP_SELECTION = 10

/** Selection is strictly a UI intent; never a grant or proof of availability. */
export function selectedVisiblePhotos(
  photos: readonly BrowserPhoto[], selected: ReadonlySet<string>,
): BrowserPhoto[] {
  return photos.filter(photo => selected.has(photo.id))
}

/** The UI never allows selecting more items than the owner export contract. */
export function togglePhotoSelection(
  selected: ReadonlySet<string>, id: string, visible: readonly BrowserPhoto[],
): Set<string> {
  const next = new Set(selected)
  if (!visible.some(photo => photo.id === id)) return next
  if (next.has(id)) next.delete(id)
  else if (next.size < MAX_ZIP_SELECTION) next.add(id)
  return next
}
