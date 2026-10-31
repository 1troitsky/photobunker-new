import { protectionEnabled } from '../crypto/store'
import * as encryptedPhotos from '../crypto/photos'
import { account } from '../identity/store'
import { request as workspaceRequest } from '../workspace/api'
import { ensureAccess, prototypeRequest } from '../server/api'
import type { Profile } from '../profiles/model'
import type {
  Assignment,
  Invitation,
  Member,
  Role,
  Space,
  Submission,
  ReviewState,
} from './model'
async function json(path: string, method = 'GET', body?: unknown) {
  return (
    await prototypeRequest(path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    })
  ).json()
}
export const shareProfile = async (profile: Profile): Promise<Profile> =>
  (
    await json(`/profiles/${profile.id}/space`, 'POST', {
      version: profile.version,
    })
  ).profile
export const team = (
  id: string,
): Promise<{ space: Space; members: Member[]; invitations: Invitation[] }> =>
  json(`/spaces/${id}`)
export const invite = (
  id: string,
  role: Exclude<Role, 'owner'>,
  readOwnPhotos: boolean,
  manageProfiles: boolean,
  duration: number,
): Promise<{ id: string; code: string; expiresAt: number }> =>
  json(`/spaces/${id}/invitations`, 'POST', {
    role,
    readOwnPhotos,
    manageProfiles,
    duration,
  })
export async function accept(
  code: string,
  nickname: string,
): Promise<{ spaceId: string }> {
  await ensureAccess()
  return json('/invitations/accept', 'POST', {
    code: code.trim().toLowerCase(),
    nickname: nickname.trim(),
  })
}
export const revokeInvite = (id: string) => json(`/invitations/${id}`, 'DELETE')
export const updateMember = (space: string, member: Member) =>
  json(`/spaces/${space}/members/${member.id}`, 'PATCH', {
    active: member.active,
    readOwnPhotos: member.readOwnPhotos,
    manageProfiles: member.manageProfiles,
  })
export const listAssignments = async (): Promise<Assignment[]> =>
  (await json('/assignments')).assignments
export const listSubmissions = async (): Promise<Submission[]> =>
  (await json('/submissions')).submissions
export const assignmentDetails = (
  id: string,
): Promise<{ assignment: Assignment; submissions: Submission[] }> =>
  json(`/assignments/${id}`)
export const createAssignment = async (data: {
  profileId: string
  name: string
  instructions: string
  assignees: string[]
  shots: string[]
  dueAt: number | null
}): Promise<Assignment> => (await json('/assignments', 'POST', data)).assignment
export const closeAssignment = async (
  task: Assignment,
  closed: boolean,
): Promise<Assignment> =>
  (
    await json(`/assignments/${task.id}`, 'PATCH', {
      closed,
      revision: task.revision,
    })
  ).assignment
export const review = (
  id: string,
  state: Exclude<ReviewState, 'pending'>,
  comment: string,
  revision: number,
) =>
  account.value
    ? protectionEnabled.value ? encryptedPhotos.review(id,state,comment,revision) : workspaceRequest(`/photos/${id}/review`, 'POST', {
        state,
        comment,
        revision,
      })
    : json(`/photos/${id}/review`, 'POST', { state, comment, revision })
export const respond = (
  id: string,
  comment: string,
  note: string | undefined,
  revision: number,
) =>
  account.value
    ? protectionEnabled.value ? encryptedPhotos.respond(id,comment,revision) : workspaceRequest(`/photos/${id}/response`, 'POST', { comment, revision })
    : json(`/photos/${id}/response`, 'POST', { comment, note, revision })
