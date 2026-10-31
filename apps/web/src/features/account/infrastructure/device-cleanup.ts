import {identity,removeRevokedDeviceAppPin} from '../../identity'
import {inspectPhotoStoreCounts,scanLocalOwnership,type LocalOwnershipInventory} from '../../local-storage'
import {inspectAssignmentPending} from '../../assignments'
import {inspectCollaborationPending} from '../../collaboration'
import {inspectGrantStoreCounts} from '../../photo-grants'
import {removeRevokedDeviceActionPins} from './device-pin'

export type RetainedDataReport=Readonly<{
  photoCipherAssets:number;photoJournals:number;photoPending:number;
  assignmentPending:number;teamPending:number;sharePending:number;
  encryptedGrantSecrets:number;ownership:LocalOwnershipInventory
}>
/** Assess residual encrypted data without needing an active revoked identity.
 * Deliberately has no erase capability and makes no recoverability claim.
 */
export async function retainedEncryptedData(accountId:string,deviceId:string):Promise<RetainedDataReport>{
  const [photo,assignmentPending,teamPending,grant,ownership]=await Promise.all([
    inspectPhotoStoreCounts(accountId),inspectAssignmentPending(accountId),
    inspectCollaborationPending(accountId),inspectGrantStoreCounts(accountId,deviceId),
    scanLocalOwnership(accountId,deviceId),
  ])
  return{photoCipherAssets:photo.photoCipherAssets,photoJournals:photo.photoJournals,
    photoPending:photo.photoOutbox,assignmentPending,teamPending,
    sharePending:grant.grantPending,encryptedGrantSecrets:grant.encryptedGrants,
    ownership}
}
/** Cleanup is STRICTLY limited to the revoked device's local PIN verifiers.
 * No photo, identity signing/wrapping keys, encrypted queue, cloud or recovery
 * material is deleted. A crash between the two calls is safe to retry.
 */
export async function cleanupRevokedDeviceVerifiers(accountId:string,deviceId:string):Promise<void>{
  if(identity.value?.accountId===accountId&&identity.value.deviceId===deviceId)
    throw Error('cleanup.active_device')
  await removeRevokedDeviceAppPin(accountId,deviceId)
  await removeRevokedDeviceActionPins(accountId,deviceId)
}
