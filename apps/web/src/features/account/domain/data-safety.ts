import type {SyncState,OutboxEntry,PhotoHeader} from '../../local-storage'
import type {StoreRisk} from './store-risk'

export type LocalSafetyRow=Readonly<{
  photoId:string;expiresAt:number;state:SyncState
}>
export type SafetyDecision=Readonly<{
  permitted:false; // Never authorize destructive deletion from a summary.
  photoCount:number;unconfirmedCount:number;inFlightCount:number;
  outboxCount:number;storeRisk:StoreRisk|null;blockingReasons:readonly string[]
}>
/**
 * G5 readiness / risk inventory, deliberately not authorization.
 * A server ACK is not proof of recoverability on a newly paired device;
 * local photos must never be erased on the strength of this report.
 */
export function assessLocalDeletion(
  photos:readonly LocalSafetyRow[], pending:readonly Pick<OutboxEntry,'state'|'intent'>[],
  trustedTime:boolean,online:boolean,serverRecoveryVerified=false,
  storeRisk:StoreRisk|null=null,
):SafetyDecision{
  const active=photos.filter(photo=>photo.expiresAt>0&&photo.state!=='expired')
  const unconfirmedCount=active.filter(photo=>photo.state!=='synced').length
  const inFlightCount=active.filter(photo=>photo.state==='syncing'||photo.state==='retry').length
  const outboxCount=pending.filter(entry=>entry.state!=='acknowledged'&&entry.state!=='cancelled').length
  const blockingReasons:string[]=[]
  if(!trustedTime)blockingReasons.push('time_untrusted')
  if(!online)blockingReasons.push('offline')
  if(unconfirmedCount)blockingReasons.push('local_copies_unconfirmed')
  if(inFlightCount||outboxCount||storeRisk?.unconfirmedTotal)blockingReasons.push('operations_pending')
  if(storeRisk?.photoJournals)blockingReasons.push('photo_journal_incomplete')
  if(!storeRisk)blockingReasons.push('stores_not_inspected')
  if(storeRisk?.ownership?.accountShared)blockingReasons.push('account_shared_ciphertext')
  if(storeRisk?.ownership?.unattributed||storeRisk?.orphanArtifacts)
    blockingReasons.push('unattributed_local_artifacts')
  if(!serverRecoveryVerified)blockingReasons.push('remote_recovery_not_proven')
  blockingReasons.push('device_erase_not_implemented')
  return{permitted:false,photoCount:active.length,unconfirmedCount,
    inFlightCount,outboxCount,storeRisk,blockingReasons}
}
export function localSafetyRows(headers:readonly PhotoHeader[],state:ReadonlyMap<string,SyncState>):LocalSafetyRow[]{
  return headers.map(header=>({photoId:header.photoId,
    expiresAt:header.expiresAt,state:state.get(header.photoId)??'local'}))
}
