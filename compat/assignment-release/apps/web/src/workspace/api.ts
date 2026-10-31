import { protectionEnabled, photoReadAllowed } from '../crypto/store'
import * as encryptedPhotos from '../crypto/photos'
import { IdentityError, identityRequest } from '../identity/api'
import { account } from '../identity/store'
import type { Task, Team, Preset } from '../studio/model'
import type { Photo, PhotoChanges } from '../local/photos'
export type Invitation = {
  id: string
  recordId: string
  kind: 'team' | 'task'
  name: string
  ownerPublicId: string
  role: string
  photoScope: string
  expiresAt: number
}
export type WorkspaceData = {
  teams: Team[]
  tasks: Task[]
  presets: Preset[]
  categories: { names: string[]; revision: number }
  invitations: Invitation[]
}
export function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  owner = account.value?.id,
) {
  if (!owner) return Promise.reject(new Error('workspace.no_account'))
  return identityRequest<T>(`/workspace${path}`, method, body, owner)
}
export const index = () => request<WorkspaceData>('')
export const save = <T extends Task | Team | Preset>(kind: string, value: T) =>
  request<T>(`/${kind}/${value.id}`, 'PUT', value)
export const remove = (kind: string, value: { id: string; revision: number }) =>
  request(`/${kind}/${value.id}`, 'DELETE', { revision: value.revision })
export const respond = (id: string, accept: boolean) =>
  request<{ recordId: string; accepted: boolean }>(`/invitations/${id}`, 'PATCH', { accept })
export const photoIndex = () =>
  request<{
    photos: Photo[]
    deleted: string[]
    receipts: {
      id: string
      assignmentId: string
      expiresAt: number
      state: string
    }[]
  }>('/photos')
export const photo = async (id:string):Promise<Photo>=>{
 if(protectionEnabled.value){if(!photoReadAllowed())throw new Error('crypto.locked');try{return encryptedPhotos.getMetadata(await encryptedPhotos.remote(id))}catch(error){if(!(error instanceof IdentityError&&error.status===404))throw error}}
 return (await request<{photo:Photo}>(`/photos/${id}`)).photo
}
export const discussion = (id: string) =>
  request<{ assignmentId: string; roomId: string | null; state: string }>(
    `/assignments/${id}/discussion`,
    'POST',
  )
export async function content(
  id: string,
  kind: 'original' | 'thumbnail',
  owner = account.value?.id,
) {
  if (!owner) throw new Error('workspace.no_account')
  const blob = await identityRequest<Blob>(`/workspace/photos/${id}/${kind}`, 'GET', undefined, owner, 'blob')
  if (owner !== account.value?.id) throw new Error('workspace.cancelled')
  return blob
}
export async function update(value: Photo, changes: PhotoChanges) {
  return (
    await request<{ photo: Photo }>(
      `/photos/${value.id}`,
      'PATCH',
      { ...changes, revision: value.remoteRevision },
      value.accountId,
    )
  ).photo
}
