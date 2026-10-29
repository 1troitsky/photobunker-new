import {acquireStorageKeys,identity} from '../../identity'
import {validateProfile,emptyContract,mayInvite,mayManage,mayManageMember,
  type TeamProfile,type TeamView,type TeamRole,type InviteRole,type Contact,type Invite,
  type CollaborationContract,type OutgoingInvite} from '../domain/model'
import {collaborationDb,k,type CachedTeam,type PendingOperation} from '../infrastructure/database'
import {profileOpen,profileSeal,wrapTeamKey,unwrapTeamKey,encryptSnapshot,decryptSnapshot,
  inviteSeal,inviteOpen} from '../infrastructure/crypto'
type Grant=ReturnType<typeof acquireStorageKeys>
export type ServerTeam={id:string;ownerId:string;role:TeamRole;revision:number;
  profile:CachedTeam['profile'];members:CachedTeam['members'];linkedAssignments:string[];updatedAt:string}
export type CollaborationSnapshot={accountId:string;contacts:Contact[];blocks:string[];
  teams:ServerTeam[];invitations:Invite[];outgoingInvitations:OutgoingInvite[];serverTime:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const assertId=(s:string)=>{if(!uuid.test(s))throw Error('team.invalid_id')}
const listeners=new Set<()=>void>()
export function onCollaborationChange(fn:()=>void):()=>void{listeners.add(fn);return()=>listeners.delete(fn)}
export function notifyCollaboration():void{for(const l of listeners)l()}
function wake(){if(typeof window!=='undefined')window.dispatchEvent(new Event('photobunker-collaboration-outbox'));notifyCollaboration()}
export class CollaborationRepository{
  private grant:Grant=acquireStorageKeys()
  private account=this.grant.scope.accountId
  check(){this.grant.check()}
  private async rawSnapshot():Promise<CollaborationSnapshot>{
    this.check()
    const row=await collaborationDb.snapshots.get(this.account)
    if(!row)return{accountId:this.account,contacts:[],blocks:[],teams:[],invitations:[],outgoingInvitations:[],serverTime:''}
    const data=await decryptSnapshot<CollaborationSnapshot>(this.grant,row)
    this.check()
    if(data.accountId!==this.account)throw Error('team.snapshot_scope')
    return data
  }
  async state(){
    const snapshot=await this.rawSnapshot()
    return{...snapshot,teams:await this.list()}
  }
  private async secret(teamId:string):Promise<Uint8Array>{
    this.check()
    const record=await collaborationDb.keys.get(k(this.account,teamId))
    if(!record)throw Error('team.key_missing')
    const raw=await unwrapTeamKey(this.grant,record)
    this.check()
    return raw
  }
  private async view(row:CachedTeam):Promise<TeamView>{
    const operations=await collaborationDb.operations.where('accountId').equals(this.account).toArray()
    const active=operations.filter(o=>o.contract.teamId===row.teamId&&o.state!=='acknowledged')
    let profile:TeamProfile={name:'',description:'',avatar:null}
    let locked=false
    try{profile=await profileOpen(row.teamId,row.revision,await this.secret(row.teamId),row.profile)}
    catch(e){if(e instanceof Error&&e.message==='team.key_missing')locked=true;else throw e}
    this.check()
    return{id:row.teamId,ownerId:row.ownerId,role:row.role,revision:row.revision,
      profile,members:row.members,linkedAssignments:[],updatedAt:row.updatedAt,
      sync:locked?'locked':row.sync==='conflict'?'conflict':active.some(o=>o.state==='retry')?'retry':
        active.length?'local':identity.value?.offline?'offline':'synced'}
  }
  async list():Promise<TeamView[]>{
    this.check()
    const all=await collaborationDb.teams.where('accountId').equals(this.account).toArray()
    const out:TeamView[]=[]
    for(const row of all)if(!row.deleted)out.push(await this.view(row))
    out.sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??'')||a.id.localeCompare(b.id))
    return out
  }
  async get(teamId:string):Promise<TeamView>{
    this.check()
    const row=await collaborationDb.teams.get(k(this.account,teamId))
    if(!row||row.deleted)throw Error('team.not_found')
    return this.view(row)
  }
  private async storeSnapshot(data:CollaborationSnapshot):Promise<void>{
    const sealed=await encryptSnapshot(this.grant,data)
    await collaborationDb.snapshots.put({accountId:this.account,...sealed})
    this.check()
  }
  private async nextOperation(c:CollaborationContract,modify?:()=>Promise<void>):Promise<void>{
    this.check()
    const op:PendingOperation={key:k(this.account,c.opId),accountId:this.account,opId:c.opId,
      contract:c,state:'pending',attempts:0,nextAttemptAt:0,sequence:0}
    await collaborationDb.transaction('rw',[collaborationDb.operations,collaborationDb.teams,collaborationDb.keys],async()=>{
      this.check()
      op.sequence=(await collaborationDb.operations.count())+1
      if(modify)await modify()
      await collaborationDb.operations.add(op)
    })
    wake()
  }
  async create(profile:TeamProfile):Promise<TeamView>{
    this.check()
    const clean=validateProfile(profile),teamId=crypto.randomUUID()
    const secret=crypto.getRandomValues(new Uint8Array(32))
    try{
      const vault=await wrapTeamKey(this.grant,teamId,secret)
      const cipher=await profileSeal(teamId,1,secret,clean)
      const contract={...emptyContract('team_create'),teamId,expectedRevision:0,profile:cipher}
      const row:CachedTeam={key:k(this.account,teamId),accountId:this.account,teamId,
        ownerId:this.account,role:'owner',revision:1,profile:cipher,members:[{accountId:this.account,role:'owner'}],
        updatedAt:null,deleted:false,sync:'local'}
      await this.nextOperation(contract,async()=>{
        await collaborationDb.keys.add({...vault,key:row.key})
        await collaborationDb.teams.add(row)
      })
      return this.view(row)
    }finally{secret.fill(0)}
  }
  async edit(teamId:string,profile:TeamProfile):Promise<TeamView>{
    this.check()
    const before=await this.get(teamId)
    if(!mayManage(before.role)||before.sync==='locked')throw Error('team.denied')
    const secret=await this.secret(teamId)
    let cipher:CachedTeam['profile']
    try{cipher=await profileSeal(teamId,before.revision+1,secret,validateProfile(profile))}
    finally{secret.fill(0)}
    const contract={...emptyContract('team_edit'),teamId,expectedRevision:before.revision,profile:cipher}
    const row=await collaborationDb.teams.get(k(this.account,teamId))
    if(!row||row.revision!==before.revision)throw Error('team.local_conflict')
    const next:CachedTeam={...row,profile:cipher,revision:row.revision+1,sync:'local'}
    await this.nextOperation(contract,async()=>{
      const actual=await collaborationDb.teams.get(next.key)
      if(!actual||actual.revision!==row.revision)throw Error('team.local_conflict')
      await collaborationDb.teams.put(next)
    })
    return this.view(next)
  }
  async removeTeam(teamId:string){
    const row=await this.get(teamId)
    if(row.role!=='owner')throw Error('team.denied')
    await this.nextOperation({...emptyContract('team_delete'),teamId},async()=>{
      await collaborationDb.teams.update(k(this.account,teamId),{deleted:true,sync:'local'})
    })
  }
  async leave(teamId:string){
    const row=await this.get(teamId)
    if(row.role==='owner')throw Error('team.denied')
    await this.nextOperation({...emptyContract('team_leave'),teamId},async()=>{
      await collaborationDb.teams.update(k(this.account,teamId),{deleted:true,sync:'local'})
    })
  }
  async contact(kind:'contact_request'|'contact_accept'|'contact_remove'|'block'|'unblock',targetId:string){
    assertId(targetId)
    if(targetId===this.account)throw Error('team.self_contact')
    await this.nextOperation({...emptyContract(kind),targetId})
  }
  async invite(teamId:string,targetId:string,role:InviteRole){
    assertId(targetId)
    const team=await this.get(teamId)
    if(!mayInvite(team.role,role))throw Error('team.denied')
    const s=await this.rawSnapshot()
    if(!s.contacts.some(c=>c.accountId===targetId&&c.state==='accepted')||
      s.blocks.includes(targetId))throw Error('team.contact_required')
    const inviteId=crypto.randomUUID(),raw=await this.secret(teamId)
    try{
      const {code,codeHash,sealedKey}=await inviteSeal(raw,teamId,inviteId,targetId)
      await this.nextOperation({...emptyContract('invite_create'),
        teamId,targetId,role,inviteId,codeHash,sealedKey})
      // Secret is shown once; never persisted, logged, added to URL, or submitted to server.
      return{code,inviteId}
    }finally{raw.fill(0)}
  }
  async accept(invite:Invite,code:string):Promise<void>{
    if(!identity.value||identity.value.offline)throw Error('team.accept_requires_online')
    const secret=await inviteOpen(code,invite.teamId,invite.id,this.account,invite.codeHash,invite.sealedKey)
    try{
      const vault=await wrapTeamKey(this.grant,invite.teamId,secret)
      await this.nextOperation({...emptyContract('invite_accept'),inviteId:invite.id},async()=>{
        await collaborationDb.keys.put({...vault,key:k(this.account,invite.teamId)})
      })
    }finally{secret.fill(0)}
  }
  async decline(inviteId:string){
    assertId(inviteId);await this.nextOperation({...emptyContract('invite_decline'),inviteId})
  }
  async revokeInvite(inviteId:string){
    assertId(inviteId);await this.nextOperation({...emptyContract('invite_revoke'),inviteId})
  }
  async member(teamId:string,targetId:string,role:InviteRole|null){
    const row=await this.get(teamId)
    const prior=row.members.find(m=>m.accountId===targetId)
    if(!prior||!mayManageMember(row.role,prior.role,role??undefined))throw Error('team.denied')
    await this.nextOperation({...emptyContract(role?'member_role':'member_revoke'),teamId,targetId,role})
  }
  async pending():Promise<PendingOperation[]>{
    this.check()
    return(await collaborationDb.operations.where('accountId').equals(this.account).toArray())
      .filter(o=>o.state==='pending'||o.state==='retry')
      .sort((a,b)=>a.sequence-b.sequence)
  }
  async acknowledge(op:PendingOperation,receipt:{accepted:boolean;operationId:string;revision?:number}){
    this.check()
    if(!receipt.accepted||receipt.operationId!==op.opId)throw Error('team.bad_receipt')
    await collaborationDb.transaction('rw',[collaborationDb.operations,collaborationDb.teams],async()=>{
      this.check()
      const saved=await collaborationDb.operations.get(op.key)
      if(!saved||JSON.stringify(saved.contract)!==JSON.stringify(op.contract))throw Error('team.op_changed')
      await collaborationDb.operations.update(op.key,{state:'acknowledged',error:undefined})
      if(op.contract.teamId && ['team_create','team_edit'].includes(op.contract.kind))
        await collaborationDb.teams.update(k(this.account,op.contract.teamId),{sync:'synced'})
    })
  }
  async fail(op:PendingOperation,code:string,conflict=false){
    this.check()
    const current=await collaborationDb.operations.get(op.key)
    if(!current||current.state==='acknowledged')return
    const attempts=Math.min(20,current.attempts+1)
    await collaborationDb.operations.update(op.key,{
      state:conflict?'conflict':'retry',attempts,
      nextAttemptAt:conflict?0:Date.now()+Math.min(300000,1000*2**Math.min(attempts,8)),
      error:code.slice(0,100),
    })
    if(conflict && op.contract.teamId)
      await collaborationDb.teams.update(k(this.account,op.contract.teamId),{sync:'conflict'})
  }
  async mergeServer(remote:CollaborationSnapshot):Promise<void>{
    this.check()
    if(remote.accountId!==this.account)throw Error('team.cross_account')
    const pending=await collaborationDb.operations.where('accountId').equals(this.account)
      .filter(o=>o.state!=='acknowledged').toArray()
    const dirty=new Set(pending.map(o=>o.contract.teamId).filter(Boolean))
    const returned=new Set<string>()
    for(const server of remote.teams){
      this.check();returned.add(server.id)
      if(dirty.has(server.id))continue
      const key=k(this.account,server.id)
      const prior=await collaborationDb.teams.get(key)
      if(prior?.deleted)continue
      const stored=await collaborationDb.keys.get(key)
      if(stored){
        const secret=await unwrapTeamKey(this.grant,stored)
        try{await profileOpen(server.id,server.revision,secret,server.profile)}
        finally{secret.fill(0)}
      }
      await collaborationDb.teams.put({key,accountId:this.account,teamId:server.id,
        ownerId:server.ownerId,role:server.role,revision:server.revision,profile:server.profile,
        members:server.members,updatedAt:server.updatedAt,deleted:false,sync:'synced'})
    }
    const old=await collaborationDb.teams.where('accountId').equals(this.account).toArray()
    for(const row of old)if(!returned.has(row.teamId)&&!dirty.has(row.teamId)){
      await collaborationDb.transaction('rw',[collaborationDb.teams,collaborationDb.keys],async()=>{
        await collaborationDb.teams.delete(row.key)
        await collaborationDb.keys.delete(row.key)
      })
    }
    await this.storeSnapshot(remote)
    wake()
  }
}
export const openCollaboration=()=>new CollaborationRepository()
