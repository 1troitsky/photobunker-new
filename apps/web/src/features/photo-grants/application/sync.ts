import {watch} from 'vue'
import {identity,assignmentRequest,signMetadataContract} from '../../identity'
import {pendingGrantOperations,grantOperationResult} from './grants'
let running:Promise<void>|null=null
let cleanup:(()=>void)|null=null
function check(account:string,device:string){
  if(identity.value?.accountId!==account||identity.value?.deviceId!==device||
    identity.value.offline)throw Error('grant.identity_changed')
}
async function perform(){
  const active=identity.value
  if(!active||active.offline||!navigator.onLine||document.hidden)return
  const {accountId,deviceId}=active,blocked=new Set<string>()
  for(const op of (await pendingGrantOperations()).slice(0,100)){
    check(accountId,deviceId)
    if(op.retryAt>Date.now()||blocked.has(op.grantId))continue
    const raw=JSON.stringify(op.contract)
    try{
      const signature=await signMetadataContract('photobunker.assignment-grant.v1\n'+raw)
      check(accountId,deviceId)
      const response=await assignmentRequest('/grants/operations/'+op.contract.opId,'PUT',
        JSON.stringify({contract:raw,signature}))
      check(accountId,deviceId)
      if(!response.ok)throw Error('grant.http_'+response.status)
      const receipt=await response.json() as {accepted:boolean;operationId:string}
      check(accountId,deviceId)
      if(!receipt.accepted||receipt.operationId!==op.contract.opId)
        throw Error('grant.invalid_receipt')
      await grantOperationResult(op,true)
      window.dispatchEvent(new Event('photobunker-grant-updated'))
    }catch(e){
      if(identity.value?.accountId!==accountId||identity.value?.deviceId!==deviceId)return
      await grantOperationResult(op,false,e instanceof Error?e.message:'grant.network')
        .catch(()=>{})
      blocked.add(op.grantId)
      window.dispatchEvent(new Event('photobunker-grant-updated'))
    }
  }
}
export function flushGrantOperations():Promise<void>{
  if(running)return running
  running=(async()=>{
    if(navigator.locks?.request)
      await navigator.locks.request('pb-grant-outbox-v1',{ifAvailable:true},
        async lock=>{if(lock)await perform()})
    else await perform()
  })().catch(()=>{}).finally(()=>{running=null})
  return running
}
export function startGrantSync():()=>void{
  if(cleanup)return cleanup
  const wake=()=>{void flushGrantOperations()}
  const visible=()=>{if(!document.hidden)wake()}
  const watcher=watch(identity,wake)
  const timer=window.setInterval(visible,30000)
  window.addEventListener('focus',wake)
  window.addEventListener('online',wake)
  window.addEventListener('photobunker-grant-outbox',wake)
  document.addEventListener('visibilitychange',visible)
  queueMicrotask(wake)
  cleanup=()=>{
    watcher();window.clearInterval(timer)
    window.removeEventListener('focus',wake)
    window.removeEventListener('online',wake)
    window.removeEventListener('photobunker-grant-outbox',wake)
    document.removeEventListener('visibilitychange',visible)
    cleanup=null
  }
  return cleanup
}
