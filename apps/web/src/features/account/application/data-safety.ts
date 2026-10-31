import {identity} from '../../identity'
import {openLocalPhotoVault} from '../../local-storage'
import {assessLocalDeletion,localSafetyRows,type SafetyDecision} from '../domain/data-safety'
import {inspectStoreRisk} from '../index'

/**
 * Read-only, scoped assessment. No local erase, revoke, key invalidation or
 * remote delete can be performed by this use-case.
 */
export async function inspectDeviceDataSafety():Promise<SafetyDecision>{
  const active=identity.value
  if(!active)throw Error('safety.account_locked')
  const check=()=>{
    if(identity.value?.accountId!==active.accountId||
      identity.value?.deviceId!==active.deviceId)
      throw Error('safety.identity_changed')
  }
  const vault=openLocalPhotoVault()
  if(!vault.time.status().trusted)await vault.time.restoreFromStorage()
  check()
  // Do not reconcile/write/delete while gathering read-only safety evidence.
  const headers=await vault.list()
  check()
  const states=new Map<string,Awaited<ReturnType<typeof vault.syncState>>>()
  for(const header of headers){
    states.set(header.photoId,await vault.syncState(header.photoId))
    check()
  }
  const pending=await vault.pending()
  check()
  const storeRisk=await inspectStoreRisk()
  check()
  const status=vault.time.status()
  return assessLocalDeletion(localSafetyRows(headers,states),pending,
    status.trusted,!active.offline&&navigator.onLine,false,storeRisk)
}
