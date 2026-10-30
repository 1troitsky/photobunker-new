/** Stable typed collaboration use-cases. UI imports only this boundary. */
export {openCollaboration,onCollaborationChange} from './infrastructure/repository'
export {flushCollaboration,startCollaborationSync} from './infrastructure/sync'
export {prepareTeamAvatar} from './infrastructure/crypto'
export {mayInvite,mayManage,mayManageMember} from './domain/model'
export type {TeamView,TeamProfile,TeamRole,InviteRole,Contact,Invite,OutgoingInvite} from './domain/model'
