import {identity,collaborationRequest,signMetadataContract,onIdentityCleanup} from '../../identity'
import {openCollaboration,notifyCollaboration,type CollaborationSnapshot} from './repository'
import {watch} from 'vue'
let active:Promise<void>|null=null
let stopped=false
function check(account:string,device:string){
  if(stopped||identity.value?.accountId!==account||identity.value?.deviceId!==device||
    identity.value.offline)throw Error('team.identity_changed')
}
async function execute(){
  const actor=identity.value
  if(!actor||actor.offline||!navigator.onLine||document.hidden)return
  const {accountId,deviceId}=actor,vault=openCollaboration()
  const operations=await vault.pending()
  check(accountId,deviceId)
  // Serial dependency order, not UUID or client wall time.
  for(const op of operations.slice(0,100)){
    check(accountId,deviceId)
    if(op.nextAttemptAt>Date.now())break
    try{
      const contract=JSON.stringify(op.contract)
      const signature=await signMetadataContract('photobunker.collaboration.v1\n'+contract)
      check(accountId,deviceId)
      const response=await collaborationRequest('/operations/'+op.opId,'PUT',
        JSON.stringify({contract,signature}))
      check(accountId,deviceId)
      if([403,404,409,410,422].includes(response.status)){
        await vault.fail(op,'team.denied_or_conflict_'+response.status,true)
        notifyCollaboration();break
      }
      if(!response.ok)throw Error('team.http_'+response.status)
      const receipt=await response.json() as {accepted:boolean;operationId:string;revision?:number}
      check(accountId,deviceId)
      await vault.acknowledge(op,receipt);notifyCollaboration()
    }catch(e){
      if(e instanceof Error&&e.message==='team.identity_changed')return
      await vault.fail(op,e instanceof Error?e.message:'team.network').catch(()=>{})
      notifyCollaboration();break
    }
  }
  check(accountId,deviceId)
  try{
    const response=await collaborationRequest('/snapshot')
    check(accountId,deviceId)
    if(!response.ok)throw Error('team.http_'+response.status)
    const result=await response.json() as CollaborationSnapshot
    check(accountId,deviceId)
    if(!Array.isArray(result.teams)||!Array.isArray(result.contacts)||!Array.isArray(result.invitations)
       ||!Array.isArray(result.blocks))throw Error('team.invalid_snapshot')
    await vault.mergeServer(result)
  }catch{/* encrypted cached snapshot remains available; no false ACK */}
}
export function flushCollaboration():Promise<void>{
  if(active)return active
  stopped=false
  active=(async()=>{
    if(navigator.locks?.request)
      await navigator.locks.request('pb-collaboration-sync-v1',{ifAvailable:true},
        async lock=>{if(lock)await execute()})
    else await execute()
  })().catch(()=>{}).finally(()=>{active=null})
  return active
}
export function startCollaborationSync():()=>void{
  let closed=false
  const wake=()=>{if(!closed)void flushCollaboration()}
  const visible=()=>{if(!document.hidden)wake()}
  const unwatch=watch(identity,wake)
  const cleanup=onIdentityCleanup(()=>{stopped=true;notifyCollaboration()})
  window.addEventListener('online',wake)
  window.addEventListener('focus',wake)
  window.addEventListener('photobunker-collaboration-outbox',wake)
  document.addEventListener('visibilitychange',visible)
  const interval=setInterval(visible,30000)
  queueMicrotask(wake)
  return ()=>{
    closed=true;stopped=true;cleanup();unwatch();clearInterval(interval)
    window.removeEventListener('online',wake)
    window.removeEventListener('focus',wake)
    window.removeEventListener('photobunker-collaboration-outbox',wake)
    document.removeEventListener('visibilitychange',visible)
  }

}
