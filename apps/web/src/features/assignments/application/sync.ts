import {identity,assignmentRequest,signMetadataContract,onIdentityCleanup} from '../../identity'
import {openAssignments,type ServerAssignment} from './repository'
import type {Operation} from '../infrastructure/database'
import {watch} from 'vue'
let active:Promise<void>|null=null
let disposed=false,unbind:(()=>void)|null=null
const subscribers=new Set<()=>void>()
export function onAssignmentChange(fn:()=>void):()=>void{subscribers.add(fn);return()=>subscribers.delete(fn)}
function notify():void{for(const fn of subscribers)fn()}
function check(account:string,device:string):void{
  if(disposed||identity.value?.accountId!==account||
    identity.value?.deviceId!==device||identity.value.offline)throw Error('assignment.identity_changed')
}
async function remote<T>(path:string):Promise<T>{
  const response=await assignmentRequest(path)
  if(!response.ok)throw Error('assignment.http_'+response.status)
  return response.json() as Promise<T>
}
async function upload(op:Operation,account:string,device:string):Promise<void>{
  const vault=openAssignments()
  try{
    check(account,device)
    const contract=JSON.stringify(op.contract)
    const signature=await signMetadataContract('photobunker.assignment.v1\n'+contract)
    check(account,device)
    const response=await assignmentRequest('/'+op.assignmentId,'PUT',
      JSON.stringify({contract,signature}))
    check(account,device)
    if(response.status===409){
      await vault.fail(op,'assignment.conflict',true);notify()
      return
    }
    if(response.status===410){
      await vault.fail(op,'assignment.deleted_on_server',true);notify()
      return
    }
    if(!response.ok)throw Error('assignment.http_'+response.status)
    const receipt=await response.json() as {accepted:boolean;revision:number;acceptedAt?:string;deleted?:boolean}
    if(!receipt.accepted)throw Error('assignment.bad_receipt')
    check(account,device)
    await vault.acknowledge(op,receipt)
    notify()
  }catch(error){
    if(error instanceof Error&&error.message==='assignment.identity_changed')return
    await vault.fail(op,error instanceof Error?error.message:'assignment.network_failed').catch(()=>{})
    notify()
  }
}
async function execute():Promise<void>{
  const entry=identity.value
  if(!entry||entry.offline||!navigator.onLine||document.hidden)return
  const {accountId,deviceId}=entry,vault=openAssignments()
  const ops=await vault.pending()
  check(accountId,deviceId)
  const stopped=new Set<string>()
  for(const op of ops.slice(0,100)){
    check(accountId,deviceId)
    if(stopped.has(op.assignmentId)||op.nextAttemptAt>Date.now())continue
    await upload(op,accountId,deviceId)
    // After 409/503 block further revisions of the same aggregate.
    const next=await vault.pending()
    if(next.some(o=>o.assignmentId===op.assignmentId&&o.operationId===op.operationId))
      stopped.add(op.assignmentId)
  }
  check(accountId,deviceId)
  try{
    const server=await remote<{assignments:ServerAssignment[]}>('/list')
    check(accountId,deviceId)
    if(!Array.isArray(server.assignments))throw Error('assignment.bad_list')
    await vault.mergeServer(server.assignments)
    notify()
  }catch{/* encrypted local draft stays available on network failure */}
}
export function flushAssignments():Promise<void>{
  if(active)return active
  disposed=false
  active=(async()=>{
    if(navigator.locks?.request)
      await navigator.locks.request('pb-assignment-outbox-v1',{ifAvailable:true},
        async lock=>{if(lock)await execute()})
    else await execute() // server CAS + stable UUID protect Safari
  })().catch(()=>{}).finally(()=>{active=null})
  return active
}
export async function fetchServerAssignment(id:string):Promise<ServerAssignment>{
  const before=identity.value
  if(!before||before.offline)throw Error('assignment.offline')
  const result=await remote<ServerAssignment>('/'+id)
  check(before.accountId,before.deviceId)
  return result
}
export function startAssignmentSync():()=>void{
  if(unbind)return unbind
  const wake=()=>{void flushAssignments()}
  const visible=()=>{if(!document.hidden)wake()}
  const watchStop=watch(identity,wake)
  const clean=onIdentityCleanup(()=>{disposed=true;notify()})
  window.addEventListener('online',wake)
  window.addEventListener('focus',wake)
  window.addEventListener('photobunker-assignment-outbox',wake)
  document.addEventListener('visibilitychange',visible)
  const timer=setInterval(()=>{if(!document.hidden)wake()},30000)
  queueMicrotask(wake)
  unbind=()=>{
    disposed=true;watchStop();clean();clearInterval(timer)
    window.removeEventListener('online',wake)
    window.removeEventListener('focus',wake)
    window.removeEventListener('photobunker-assignment-outbox',wake)
    document.removeEventListener('visibilitychange',visible)
    unbind=null
  }
  return unbind
}
