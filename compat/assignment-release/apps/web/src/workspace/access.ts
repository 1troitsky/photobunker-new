import { shallowRef } from 'vue'
import { account } from '../identity/store'
import type { Task } from '../studio/model'
import type { Photo } from '../local/photos'
export const taskGrants = shallowRef<Task[]>([])
export function pendingAccess(
  photo: Pick<Photo, 'accountId' | 'workspaceAssignmentId' | 'uploadOnly'>,
) {
  if (
    !account.value ||
    photo.accountId !== account.value.id ||
    photo.uploadOnly
  )
    return false
  if (!photo.workspaceAssignmentId) return true
  const task = taskGrants.value.find(
    (task) => task.id === photo.workspaceAssignmentId,
  )
  if (!task) return false
  if (task.canManage) return true
  const member = task.participants.find(
    (person) => person.id === account.value?.publicId,
  )
  if (task.role === 'curator' || task.role === 'viewer') return member?.photoScope !== 'none'
  return member?.photoScope === 'none'
    ? false
    : member?.photoScope === 'thumbnails' ||
        member?.photoScope === 'all' ||
        task.rules.galleryAllowed
}
export function pendingGrant(
  photo: Pick<Photo, 'accountId' | 'workspaceAssignmentId' | 'uploadOnly'>,
) {
  const task = taskGrants.value.find(
    (task) => task.id === photo.workspaceAssignmentId,
  )
  const role = task?.role ?? 'owner'
  const member = task?.participants.find(
    (person) => person.id === account.value?.publicId,
  )
  const scope = member?.photoScope ?? 'default'
  const thumbnail = pendingAccess(photo)
  const limited =
    scope === 'thumbnails' ||
    (scope === 'default' &&
      role === 'contributor' &&
      !!task?.rules.thumbnailsOnly)
  return {
    role,
    read: thumbnail && !limited,
    thumbnail,
    edit:
      thumbnail &&
      !limited &&
      (role === 'owner' ||
        role === 'curator' ||
        (role === 'contributor' && !!task?.rules.changesAllowed)),
    delete:
      role === 'owner' ||
      role === 'curator' ||
      (role === 'contributor' && !!task?.rules.deletionAllowed),
    shareExternal:
      thumbnail &&
      !limited &&
      (role === 'owner' || role === 'curator' || (!!task?.rules.sharingAllowed && !task.rules.participantsOnly)),
    share:
      thumbnail &&
      !limited &&
      (role === 'owner' || role === 'curator' || !!task?.rules.sharingAllowed),
  }
}
