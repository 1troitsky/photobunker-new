export type TeamRole='owner'|'curator'|'contributor'|'viewer'
export type InviteRole=Exclude<TeamRole,'owner'>
export type TeamProfile={name:string;description:string;avatar:string|null}
export type TeamMember={accountId:string;role:TeamRole}
export type TeamView={id:string;ownerId:string;role:TeamRole;revision:number;
  profile:TeamProfile;members:TeamMember[];linkedAssignments:string[];
  updatedAt:string|null;sync:'local'|'retry'|'conflict'|'synced'|'offline'|'locked'}
export type Contact={accountId:string;requesterId:string;state:'pending'|'accepted'}
export type Sealed={v:1;iv:string;ciphertext:string}
export type Invite={id:string;teamId:string;inviterId:string;role:InviteRole;expiresAt:string;sealedKey:Sealed;codeHash:string}
export type OutgoingInvite={id:string;teamId:string;targetId:string;role:InviteRole;expiresAt:string}
export type TeamCipher=Sealed
export type CollaborationKind='contact_request'|'contact_accept'|'contact_remove'|'block'|'unblock'|
  'team_create'|'team_edit'|'team_delete'|'invite_create'|'invite_accept'|'invite_decline'|
  'invite_revoke'|'member_role'|'member_revoke'|'team_leave'
export type CollaborationContract={v:1;opId:string;kind:CollaborationKind;teamId:string|null;
  targetId:string|null;role:InviteRole|null;expectedRevision:number|null;
  profile:TeamCipher|null;inviteId:string|null;codeHash:string|null;sealedKey:Sealed|null}
export function validateProfile(value:TeamProfile):TeamProfile {
  const name=value.name.trim(),description=value.description.trim(),avatar=value.avatar
  if(!name||[...name].length>80)throw Error('team.invalid_name')
  if([...description].length>1000)throw Error('team.invalid_description')
  if(avatar!==null&&(!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(avatar)||
    avatar.length>20000))throw Error('team.invalid_avatar')
  return{name,description,avatar}
}
export function mayInvite(role:TeamRole,target:InviteRole):boolean {
  return role==='owner'||role==='curator'&&target!=='curator'
}
export function mayManage(role:TeamRole):boolean {return role==='owner'||role==='curator'}
export function mayManageMember(role:TeamRole,other:TeamRole,next?:InviteRole):boolean {
  if(other==='owner')return false
  return role==='owner'||role==='curator'&&other!=='curator'&&next!=='curator'
}
export function emptyContract(kind:CollaborationKind):CollaborationContract {
  return{v:1,opId:crypto.randomUUID(),kind,teamId:null,targetId:null,role:null,
    expectedRevision:null,profile:null,inviteId:null,codeHash:null,sealedKey:null}
}
