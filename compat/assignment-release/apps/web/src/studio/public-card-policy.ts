import type { Photo } from '../local/photos'
import { privatePhotoCard, type PrivatePhotoCard } from './private-photo-card'

export type PublicCardPolicy = {
  enabled: boolean
  contributor: boolean
  capturedAt: boolean
  editedAt: boolean
  location: boolean
  description: boolean
  tags: boolean
  metadata: boolean
}
export function publicCardPolicy(value?: Partial<PublicCardPolicy>): PublicCardPolicy {
  const defaults: PublicCardPolicy = { enabled: true, contributor: false, capturedAt: false,
    editedAt: false, location: true, description: true, tags: false, metadata: false }
  for (const key of Object.keys(defaults) as (keyof PublicCardPolicy)[])
    if (typeof value?.[key] === 'boolean') defaults[key] = value[key]!
  return defaults
}
export function effectivePublicCardPolicy(photo: Photo): PublicCardPolicy {
  const policy = publicCardPolicy(photo.metadata?.publicCard)
  const ceiling = photo.metadata?.publicCardAssignment
  if (ceiling) for (const key of Object.keys(policy) as (keyof PublicCardPolicy)[])
    policy[key] = policy[key] && ceiling[key] === true
  return policy
}
/** Narrows an authorized read; it never grants read/share/image permissions. */
export function publicPhotoCard(photo: Photo): PrivatePhotoCard {
  const policy = effectivePublicCardPolicy(photo)
  if (!policy.enabled) throw new Error('public_card.disabled')
  const card = privatePhotoCard(photo)
  if (!policy.description) delete card.description
  if (!policy.tags) delete card.tags
  if (!policy.capturedAt) delete card.capturedAt
  if (!policy.location) delete card.location
  if (!policy.metadata) delete card.metadata
  else if (card.metadata) {
    // Date/GPS switches remain authoritative even with technical metadata on.
    if (!policy.capturedAt) { delete card.metadata.date; delete card.metadata.time }
    if (!policy.location) { delete card.metadata.accuracy; delete card.metadata.locationSource }
  }
  if (!policy.contributor) delete card.author
  if (policy.contributor && card.author && photo.captureContext?.teamName)
    card.teamName = photo.captureContext.teamName
  // Never substitute a capture timestamp for a genuine edit timestamp.
  const full = photo.workspaceAccess ? photo.workspaceAccess.read : !photo.thumbnailOnly && photo.access?.role !== 'viewer'
  if (full && policy.editedAt && photo.metadata?.editedAt) card.editedAt = photo.metadata.editedAt
  return card
}
