import {db} from './database'
import {classifyLocalRecord,summarizeOwnership} from '../domain/ownership'
import type {LocalOwnershipRow,LocalRecordKind,OwnershipSummary} from '../domain/ownership'

export type LocalOwnershipInventory=Readonly<{
  accountId:string;deviceId:string;
  summary:OwnershipSummary;
  counts:Readonly<Record<LocalRecordKind,number>>;
  orphanAssetRows:number;orphanBlobRows:number;
  unresolvedJournalPaths:number;unconfirmedPhotoOperations:number;
  disposition:'hold_ciphertext';
  blockingReasons:readonly string[];
}>
/**
 * A read-only inventory of ALL known PB2 photo storage tables.
 * Reads only account-scoped metadata; never decrypts or edits ciphertext.
 * It must not infer that 'acknowledged' implies recoverable on another device.
 *
 * This is a snapshot, not a cross-tab atomic transaction. Any destructive
 * plan MUST recheck ownership under an exclusive lease before deletion.
 */
export async function scanLocalOwnership(accountId:string,deviceId:string):Promise<LocalOwnershipInventory>{
  if(!accountId||!deviceId)throw Error('ownership.identity_required')
  const [photos,assets,blobs,operations,journals,tombstones,
    leases,thumbnails,clocks]=await Promise.all([
    db.photos.where('accountId').equals(accountId).toArray(),
    db.assets.where('accountId').equals(accountId).toArray(),
    db.blobFallback.where('accountId').equals(accountId).primaryKeys(),
    db.outbox.where('accountId').equals(accountId).toArray(),
    db.journal.where('accountId').equals(accountId).toArray(),
    db.tombstones.where('accountId').equals(accountId).toArray(),
    db.nameLeases.where('accountId').equals(accountId).toArray(),
    db.thumbnailCache.where('accountId').equals(accountId).toArray(),
    db.clock.where('accountId').equals(accountId).toArray(),
  ])
  const livePhotoIds=new Set(photos.map(photo=>photo.photoId))
  const assetPaths=new Set(assets.map(asset=>asset.storageKey))
  const stagedPaths=new Set(journals.flatMap(row=>row.assetKeys))
  const rows:LocalOwnershipRow[]=[]
  function add(kind:LocalRecordKind,account:string,device:string|undefined,
    referenced:boolean,pending:boolean):void{
    rows.push({kind,accountId:account,deviceId:device,targetDeviceId:deviceId,referenced,pending})
  }
  for(const row of photos)add('photo',row.accountId,undefined,true,row.state==='delete_pending')
  for(const row of assets)add('asset',row.accountId,undefined,livePhotoIds.has(row.photoId),false)
  for(const key of blobs)add('blob',accountId,undefined,
    assetPaths.has(key)||stagedPaths.has(key),false)
  for(const row of operations)add('outbox',row.accountId,undefined,
    livePhotoIds.has(row.photoId),row.state!=='acknowledged'&&row.state!=='cancelled')
  for(const row of journals)add('journal',row.accountId,row.deviceId,
    livePhotoIds.has(row.photoId),true)
  for(const row of tombstones)add('tombstone',row.accountId,undefined,true,true)
  for(const row of leases)add('name-lease',row.accountId,row.deviceId,true,true)
  for(const row of thumbnails)add('thumbnail-cache',row.accountId,undefined,
    assetPaths.has(row.storageKey),false)
  for(const row of clocks)add('trusted-clock',row.accountId,row.deviceId,true,false)
  const kinds:LocalRecordKind[]=['photo','asset','blob','outbox','journal',
    'tombstone','name-lease','thumbnail-cache','trusted-clock']
  const counts=Object.fromEntries(kinds.map(kind=>[kind,rows.filter(row=>row.kind===kind).length]))
    as Record<LocalRecordKind,number>
  const orphanAssetRows=assets.filter(a=>!livePhotoIds.has(a.photoId)).length
  const orphanBlobRows=blobs.filter(key=>!assetPaths.has(key)&&!stagedPaths.has(key)).length
  const unresolvedJournalPaths=journals.reduce((n,journal)=>
    n+journal.assetKeys.filter(path=>!assetPaths.has(path)&&!blobs.includes(path)).length,0)
  const unconfirmedPhotoOperations=operations.filter(row=>
    row.state!=='acknowledged'&&row.state!=='cancelled').length
  const summary=summarizeOwnership(rows)
  // Every ciphertext-bearing row remains on hold, even when every upload
  // reports a server receipt: no second-device decrypt proof exists.
  const blockingReasons=['remote_decrypt_not_proven','account_shared_ciphertext',
    'cross_tab_snapshot_not_atomic','opfs_unindexed_paths_not_enumerated']
  if(orphanAssetRows||orphanBlobRows||unresolvedJournalPaths)
    blockingReasons.push('unattributed_local_artifacts')
  if(unconfirmedPhotoOperations||journals.length||leases.length)
    blockingReasons.push('pending_offline_operations')
  // classification is asserted here to keep the supposedly safe derived
  // rows from broadening in a future schema without explicit re-review.
  if(rows.some(row=>classifyLocalRecord(row).eligibility==='post-revoke-derived'&&
    row.kind!=='trusted-clock'))throw Error('ownership.policy_broadened')
  return{accountId,deviceId,summary,counts,orphanAssetRows,orphanBlobRows,
    unresolvedJournalPaths,unconfirmedPhotoOperations,
    disposition:'hold_ciphertext',blockingReasons}
}
