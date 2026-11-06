import { account, deviceId, sessionState, offlineCaptureIdentity, hasConfirmedIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionReady, protectionEnabled, photoReadAllowed } from '../crypto/store'
import { photos, libraryChanged } from '../local/library'
import { localTasks, cachedTeamTasks } from '../studio/store'
import { changeOrganizer } from './cache'
import { buildExplorer, changeExplorer, photoKey, type ExplorerLabels, type OrganizerAction } from './explorer'
import { updatePhoto, deletePhoto } from '../server/photos'
import { detailsFor, detailsChanges } from '../studio/details'
import { metadataEditable } from '../collaboration/access'
import { isExpired } from '../delivery/clock'

export function browserReadable(): boolean {
  const offline = (sessionState.value === 'offline' || sessionState.value === 'checking') && offlineCaptureIdentity.value
  return !!account.value && !!deviceId.value && appLockReady.value && !appLocked.value &&
    (hasConfirmedIdentity() || !!offline) && protectionReady.value &&
    (!protectionEnabled.value || photoReadAllowed())
}
export function browserTasks() {
  return [...new Map([...cachedTeamTasks.value, ...localTasks.value]
    .filter(task => !('accountId' in task) || !task.accountId || task.accountId === account.value?.id)
    .map(task => [task.id, task])).values()]
}
function scope() {
  if (!browserReadable()) throw new Error('browser.locked')
  return { owner: account.value!.id, device: deviceId.value }
}
function guard(value: ReturnType<typeof scope>) {
  if (!browserReadable() || account.value?.id !== value.owner || deviceId.value !== value.device)
    throw new Error('browser.account_changed')
}
export async function organize(action: OrganizerAction, labels: ExplorerLabels) {
  const current = scope()
  const next = await changeOrganizer(current.owner, current.device, value => {
    guard(current)
    const model = buildExplorer(current.owner, browserTasks(), value, photos.value, labels)
    return changeExplorer(value, model, action)
  })
  guard(current)
  return next
}
export async function editBrowserPhoto(id: string, changes: { title?: string; tags?: string }) {
  const current = scope()
  const photo = photos.value.find(item => item.id === id && item.accountId === current.owner)
  if (!photo || (photo.workspaceAccess ? !photo.workspaceAccess.edit : photo.access?.role === 'viewer') ||
      photo.thumbnailOnly || photo.workspaceAccess?.read === false || isExpired(photo) ||
      (changes.title !== undefined && photo.title && !metadataEditable(photo)))
    throw new Error('browser.denied')
  const draft = detailsFor(photo)
  if (changes.title !== undefined) {
    const title = changes.title.trim()
    if (!title || title.length > 120) throw new Error('browser.name')
    draft.title = title
  }
  if (changes.tags !== undefined) draft.tags = changes.tags
  const update = detailsChanges(photo, draft)
  const saved = await updatePhoto(id, update, photo.remoteRevision, photo)
  guard(current)
  if (saved.id !== id || (saved.accountId && saved.accountId !== current.owner))
    throw new Error('browser.account_changed')
  photos.value = photos.value.map(item => item.id === id ? saved : item)
  libraryChanged()
}
export async function deleteBrowserPhotos(ids: string[], labels: ExplorerLabels) {
  if (!ids.length) return
  const current = scope()
  // Validate the complete selection before the first destructive request.
  const value = await (await import('./cache')).readOrganizer(current.owner, current.device)
  guard(current)
  const model = buildExplorer(current.owner, browserTasks(), value, photos.value, labels)
  if (ids.some(id => !model.entries.get(photoKey(id))?.deletable)) throw new Error('browser.denied')
  try {
    for (const id of ids) {
      guard(current)
      await deletePhoto(id)
      guard(current)
      photos.value = photos.value.filter(item => item.id !== id)
      await changeOrganizer(current.owner, current.device, saved => ({ ...saved,
        folders: saved.folders.map(folder => ({ ...folder, photoIds: folder.photoIds.filter(photoId => photoId !== id) })),
        archivedPhotoIds: saved.archivedPhotoIds?.filter(photoId => photoId !== id) }))
    }
  } finally { libraryChanged() }
}
