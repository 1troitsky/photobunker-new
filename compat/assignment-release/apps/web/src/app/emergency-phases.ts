import type { EmergencyCommand } from './emergency-command'

export type EmergencyReplayOps = {
  lock(): void
  signedOut(): void
  invalidate(accountId:string,deviceId:string): void
  advance(operationId:string,from:EmergencyCommand['phase'],to:EmergencyCommand['phase']):Promise<EmergencyCommand>
  purge(accountId:string,deviceId:string):Promise<void>
  deliver(row:EmergencyCommand):Promise<'accepted'|'processing'|'completed'>
  recordDelivery(operationId:string,state:'accepted'|'processing'|'completed'):Promise<void>
  online():boolean
}
/** Injectable actual phase driver for synthetic-only crash/reload/lost-ACK tests. */
export async function replayEmergencyPhases(initial:EmergencyCommand,ops:EmergencyReplayOps) {
  let row=initial
  ops.lock()
  if(row.phase==='prepared') {
    ops.signedOut()
    ops.invalidate(row.accountId,row.deviceId)
    row=await ops.advance(row.operationId,'prepared','locked')
  }else ops.signedOut()
  if(row.phase==='locked')row=await ops.advance(row.operationId,'locked','purging')
  let wipeFailed=false
  if(row.phase==='purging') {
    try{
      await ops.purge(row.accountId,row.deviceId)
    }catch{wipeFailed=true}
    // A failed durable phase commit is not a wipe failure. Let the caller
    // retry from the journal instead of swallowing a storage/transaction error.
    if(!wipeFailed)row=await ops.advance(row.operationId,'purging','purged')
  }
  // Local deletion must complete before any cloud-side destructive command.
  // A failed wipe preserves the signed intent in the crash-safe journal for retry.
  if(row.phase==='purged' && !wipeFailed && row.delivery!=='completed' && ops.online()){
    const state=await ops.deliver(row)
    await ops.recordDelivery(row.operationId,state)
  }
  return {wipeFailed}
}
