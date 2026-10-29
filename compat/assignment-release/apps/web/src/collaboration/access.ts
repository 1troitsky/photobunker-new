import { pendingAccess } from '../workspace/access'
import { ref } from 'vue'
import type { Space, Access } from './model'
import type { Profile } from '../profiles/model'
export const spaceAccess = ref<Space[]>()
export function localVisible(photo: {
  accountId?: string
  workspaceAssignmentId?: string
  spaceId?: string
  uploadOnly?: boolean
  deliveryOnly?: boolean
  creatorId?: string
}) {
  if (photo.accountId) return pendingAccess(photo)
  if (photo.uploadOnly || photo.deliveryOnly) return false
  if (
    photo.spaceId &&
    spaceAccess.value &&
    !spaceAccess.value.some(
      (space) =>
        space.id === photo.spaceId &&
        (space.role !== 'contributor' || space.readOwnPhotos),
    )
  )
    return false
  return true
}
export function metadataEditable(photo: {
  accountId?: string
  workspaceAssignmentId?: string
  spaceId?: string
  access?: Access
  profile?: Profile
}) {
  if (photo.access?.role === 'viewer') return false
  if (photo.spaceId && ['owner', 'curator'].includes(photo.access?.role ?? ''))
    return photo.profile?.rules.curatorDescriptionEditable ?? true
  return photo.profile?.rules.descriptionEditable ?? true
}
export function canCapture(profile: Profile) {
  return profile.access?.role !== 'viewer'
}
