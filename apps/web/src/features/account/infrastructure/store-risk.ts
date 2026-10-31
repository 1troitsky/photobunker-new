import {inspectPhotoStoreCounts} from '../../local-storage'
import {inspectAssignmentPending} from '../../assignments'
import {inspectCollaborationPending} from '../../collaboration'
import {inspectGrantStoreCounts} from '../../photo-grants'
import {identity} from '../../identity'
import type {StoreRisk} from '../domain/store-risk'

export type {StoreRisk} from '../domain/store-risk'

/** Read-only, public-boundary-only aggregate. Throws closed when one store
 * cannot be inspected; missing counts are never interpreted as zero.
 */
export async function inspectStoreRisk():Promise<StoreRisk>{
  const current=identity.value
  if(!current)throw Error('safety.account_locked')
  const account=current.accountId,device=current.deviceId
  const [photo,assignmentPending,collaborationPending,grant]=await Promise.all([
    inspectPhotoStoreCounts(account),inspectAssignmentPending(account),
    inspectCollaborationPending(account),inspectGrantStoreCounts(account,device),
  ])
  if(identity.value?.accountId!==account||identity.value?.deviceId!==device)
    throw Error('safety.identity_changed')
  return{...photo,assignmentPending,collaborationPending,...grant,
    unconfirmedTotal:photo.photoJournals+photo.photoOutbox+assignmentPending+
      collaborationPending+grant.grantPending}
}
