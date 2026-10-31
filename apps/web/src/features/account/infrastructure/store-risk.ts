import {db as photos} from '../../local-storage/infrastructure/database'
import {assignmentDb} from '../../assignments/infrastructure/database'
import {collaborationDb} from '../../collaboration/infrastructure/database'
import {grantDb} from '../../photo-grants/infrastructure/database'
import {identity} from '../../identity'

export type StoreRisk=Readonly<{
  photoJournals:number;photoCipherAssets:number;photoOutbox:number;
  assignmentPending:number;collaborationPending:number;grantPending:number;
  encryptedGrants:number;unconfirmedTotal:number
}>
/** Read only. Enumerates every currently known PB2 feature outbox, including
 * failed/conflicted ops, without touching ciphertext or changing a queue.
 * A clean count does not prove that cloud recovery is possible.
 */
export async function inspectStoreRisk():Promise<StoreRisk>{
  const current=identity.value
  if(!current)throw Error('safety.account_locked')
  const account=current.accountId,device=current.deviceId
  const assertScope=()=>{
    if(identity.value?.accountId!==account||identity.value?.deviceId!==device)
      throw Error('safety.identity_changed')
  }
  const [journals,assets,outbox,assignments,collaboration,grants,shares,secrets]=await Promise.all([
    photos.journal.where('accountId').equals(account).count(),
    photos.assets.where('accountId').equals(account).count(),
    photos.outbox.where('accountId').equals(account).toArray(),
    assignmentDb.operations.where('accountId').equals(account).toArray(),
    collaborationDb.operations.where('accountId').equals(account).toArray(),
    grantDb.operations.where('[accountId+deviceId]').equals([account,device]).toArray(),
    grantDb.thumbnailShares.where('[accountId+deviceId]').equals([account,device]).toArray(),
    grantDb.secrets.where('[accountId+deviceId]').equals([account,device]).count(),
  ])
  assertScope()
  const photoOutbox=outbox.filter(row=>!['acknowledged','cancelled'].includes(row.state)).length
  const assignmentPending=assignments.filter(row=>!['acknowledged','discarded'].includes(row.state)).length
  const collaborationPending=collaboration.filter(row=>row.state!=='acknowledged').length
  const grantPending=grants.length+shares.filter(row=>row.state!=='acknowledged').length
  return{photoJournals:journals,photoCipherAssets:assets,photoOutbox,
    assignmentPending,collaborationPending,grantPending,encryptedGrants:secrets,
    unconfirmedTotal:journals+photoOutbox+assignmentPending+collaborationPending+grantPending}
}
