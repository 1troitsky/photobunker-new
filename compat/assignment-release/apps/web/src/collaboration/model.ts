import type { Profile } from '../profiles/model'
export type Role = 'owner' | 'curator' | 'contributor' | 'viewer'
export type Access = { role: Role; readOwnPhotos: boolean; manageProfiles: boolean }
export type Space = Access & { id: string; name: string; ownerId?: string }
export type Member = Access & { id: string; nickname: string; active: boolean }
export type Invitation = { id: string; role: Exclude<Role, 'owner'>; readOwnPhotos: boolean; manageProfiles: boolean; expiresAt: number; accepted: boolean; revoked: boolean }
export type Assignment = { id: string; spaceId: string; profileId: string; profile: Profile; name: string; instructions: string; assignees: string[]; shots: string[]; dueAt: number | null; closed: boolean; revision: number; canManage: boolean; canCapture: boolean }
export type ReviewState = 'pending' | 'accepted' | 'correction' | 'reshoot' | 'rejected'
export type Submission = { id: string; profileId?: string; assignmentId?: string | null; shortId: string; shot: string; creatorId: string; createdAt: number; expiresAt: number | null; state: ReviewState; revision: number; comment: string; response: string; replacesId: string | null; canRead: boolean; canRespond: boolean }
