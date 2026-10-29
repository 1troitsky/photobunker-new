import {identity,assignmentRequest,photoRequest,signMetadataContract,withCurrentOwnerAssetDEK,currentAccountSpki,signOwnerDeviceProof} from '../../identity'
import {openAssignments} from '../../assignments'
import {openLocalPhotoVault,type CloudAsset} from '../../local-storage'
import {grantDb,scopedId,type OperationRow,type SecretRow,type ThumbnailShareRow} from '../infrastructure/database'
import {sealLocalGrantSecret,openLocalGrantIdentity} from '../infrastructure/secret'
import {createPhotoGrantCode,photoGrantCodeHash,sealGrantSecretPinned,openGrantSecretPinned,sealRecipientKey,
  type KeyContext,
  type GrantInvitationContext} from '../infrastructure/key-envelope'
import {acquireStorageKeys} from '../../identity'
import {command,validateServerGrant,type GrantCommand,type GrantRole,type ServerGrant,type GrantOperationKind} from '../domain/grants'

function current(){
  const active=identity.value
  if(!active)throw Error('grant.account_locked')
  return active
}
function online(){
  const active=current()
  if(active.offline||!navigator.onLine)throw Error('grant.online_required')
  return active
}
function same(account:string,device:string){
  const active=current()
  if(active.accountId!==account||active.deviceId!==device)
    throw Error('grant.identity_changed')
}
const wake=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('photobunker-grant-outbox'))}
function context(record:{grantId:string;assignmentId:string;ownerId:string;recipientId:string}):
  GrantInvitationContext{
  return {grantId:record.grantId,assignmentId:record.assignmentId,
    ownerAccountId:record.ownerId,recipientAccountId:record.recipientId}
}
function opRow(c:GrantCommand,account:string,device:string):OperationRow{
  return {id:scopedId(account,device,c.opId),accountId:account,deviceId:device,
    grantId:c.grantId,contract:c,state:'pending',attempts:0,retryAt:0,lastError:null}
}
async function storeSecretAndOperation(c:GrantCommand,ctx:GrantInvitationContext,secret:string,ownerAccountSpki:string|null){
  const active=current(),g=acquireStorageKeys()
  const sealed=await sealLocalGrantSecret(g,ctx,secret,ownerAccountSpki)
  same(active.accountId,active.deviceId);g.check()
  const vault:SecretRow={id:scopedId(active.accountId,active.deviceId,c.grantId),
    accountId:active.accountId,deviceId:active.deviceId,grantId:c.grantId,
    assignmentId:ctx.assignmentId,ownerAccountId:ctx.ownerAccountId,
    recipientAccountId:ctx.recipientAccountId,envelope:sealed}
  await grantDb.transaction('rw',[grantDb.secrets,grantDb.operations],async()=>{
    g.check()
    const exists=await grantDb.secrets.get(vault.id)
    if(exists)throw Error('grant.already_enrolled')
    await grantDb.secrets.add(vault)
    await grantDb.operations.add(opRow(c,active.accountId,active.deviceId))
    g.check()
  })
  wake()
}
export async function fetchAssignmentGrants():Promise<ServerGrant[]>{
  const active=online(),response=await assignmentRequest('/grants')
  same(active.accountId,active.deviceId)
  if(!response.ok)throw Error('grant.http_'+response.status)
  const data=await response.json() as {grants:ServerGrant[]}
  same(active.accountId,active.deviceId)
  if(!Array.isArray(data.grants))throw Error('grant.invalid_server_response')
  return data.grants.map(validateServerGrant)
}
/** Returns the out-of-band code only after ciphertext + durable outbox commit. */
export async function inviteToAssignment(assignmentId:string,recipientId:string,role:GrantRole):
  Promise<{grantId:string;code:string}>{
  const active=online()
  if(recipientId===active.accountId||!['curator','contributor','viewer'].includes(role))
    throw Error('grant.invalid_target')
  // A local unsynced assignment cannot be used as an authoritative grant target.
  const assignment=await openAssignments().get(assignmentId)
  same(active.accountId,active.deviceId)
  if(assignment.sync!=='synced'||assignment.status==='completed')
    throw Error('grant.assignment_not_ready')
  const grantId=crypto.randomUUID(),code=createPhotoGrantCode()
  const secret=createPhotoGrantCode()
  const ctx={grantId,assignmentId,ownerAccountId:active.accountId,recipientAccountId:recipientId}
  const ownerSpki=currentAccountSpki()
  const sealedKey=await sealGrantSecretPinned(code,secret,ctx,ownerSpki)
  const codeHash=await photoGrantCodeHash(code)
  same(active.accountId,active.deviceId)
  const c:GrantCommand={v:1,opId:crypto.randomUUID(),kind:'invite',
    grantId,assignmentId,targetId:recipientId,role,expectedGeneration:0,
    expiresAt:Date.now()+86400000,codeHash,sealedKey}
  await storeSecretAndOperation(c,ctx,secret,ownerSpki)
  same(active.accountId,active.deviceId)
  return {grantId,code}
}
/** Wrong code never queues acceptance; server must independently confirm grant. */
export async function acceptAssignmentGrant(grantId:string,code:string):Promise<void>{
  const active=online()
  const row=(await fetchAssignmentGrants()).find(x=>x.grantId===grantId)
  same(active.accountId,active.deviceId)
  if(!row||row.recipientId!==active.accountId||row.state!=='pending'||
    row.inviteExpiresAt<=Date.now()||!row.codeHash||!row.sealedKey)
    throw Error('grant.not_invited')
  if(await photoGrantCodeHash(code)!==row.codeHash)throw Error('grant.wrong_code')
  const ctx=context(row)
  const pinned=await openGrantSecretPinned(code,row.sealedKey,ctx)
  const secret=pinned.secret
  same(active.accountId,active.deviceId)
  await storeSecretAndOperation(command('accept',row),ctx,secret,pinned.ownerAccountSpki)
  same(active.accountId,active.deviceId)
}
export async function changeAssignmentGrant(row:ServerGrant,
  kind:'decline'|'revoke'|'leave'):Promise<void>{
  const active=online()
  if(kind==='revoke'&&row.ownerId!==active.accountId)throw Error('grant.denied')
  if(kind!=='revoke'&&row.recipientId!==active.accountId)throw Error('grant.denied')
  if(kind==='leave'&&row.state!=='accepted')throw Error('grant.invalid_state')
  if(kind==='decline'&&row.state!=='pending')throw Error('grant.invalid_state')
  const data=command(kind,row)
  await grantDb.operations.add(opRow(data,active.accountId,active.deviceId))
  same(active.accountId,active.deviceId)
  wake()
}
export type GrantOutboxState=Readonly<{
  opId:string;grantId:string;kind:GrantOperationKind;state:'pending'|'retry'|'conflict';
  error:string|null
}>
/** Technical status only; never return an invitation code or secret to UI. */
export async function grantOutboxStatus():Promise<GrantOutboxState[]>{
  const {accountId,deviceId}=current()
  const rows=await grantDb.operations.where('[accountId+deviceId]')
    .equals([accountId,deviceId]).toArray()
  same(accountId,deviceId)
  return rows.map(row=>({opId:row.contract.opId,grantId:row.grantId,
    kind:row.contract.kind,state:row.state,error:row.lastError}))
}

export async function pendingGrantOperations():Promise<OperationRow[]>{
  const {accountId,deviceId}=current()
  const operations=await grantDb.operations.where('[accountId+deviceId]')
    .equals([accountId,deviceId]).toArray()
  same(accountId,deviceId)
  return operations.filter(x=>x.state==='pending'||x.state==='retry')
    .sort((a,b)=>a.retryAt-b.retryAt)
}
export async function grantOperationResult(op:OperationRow,ok:boolean,reason=''){
  const active=current()
  if(active.accountId!==op.accountId||active.deviceId!==op.deviceId)
    throw Error('grant.identity_changed')
  await grantDb.transaction('rw',[grantDb.operations,grantDb.secrets],async()=>{
    const saved=await grantDb.operations.get(op.id)
    if(!saved||JSON.stringify(saved.contract)!==JSON.stringify(op.contract))
      throw Error('grant.operation_changed')
    if(ok){
      await grantDb.operations.delete(op.id)
      if(['revoke','leave','decline'].includes(op.contract.kind))
        await grantDb.secrets.delete(scopedId(op.accountId,op.deviceId,op.grantId))
    }else{
      const attempts=Math.min(24,saved.attempts+1)
      const conflict=/^grant\.http_4(00|03|04|09|10|22)$/.test(reason)
      await grantDb.operations.update(op.id,{state:conflict?'conflict':'retry',
        attempts,retryAt:Date.now()+Math.min(300000,1000*2**Math.min(attempts,8)),
        lastError:reason.slice(0,90)})
      // Permanent rejection must not leave an orphaned recipient grant key.
      if(conflict)await grantDb.secrets.delete(scopedId(op.accountId,op.deviceId,op.grantId))
    }
  })
  same(op.accountId,op.deviceId)
}

/**
 * Owner explicitly shares only an EXISTING, current encrypted thumbnail.
 * This never changes owner-only PhotoSync endpoints or exposes raw DEKs to Vue.
 * Upload is online-only and idempotent if the same signed operation is retried.
 */
export async function publishRecipientThumbnail(grantId:string,photoId:string):
  Promise<{assetId:string;operationId:string}>{
  const active=online()
  const row=(await fetchAssignmentGrants()).find(g=>g.grantId===grantId)
  same(active.accountId,active.deviceId)
  if(!row||row.ownerId!==active.accountId||row.state!=='accepted')
    throw Error('grant.not_accepted')
  const prior=await grantDb.thumbnailShares.where('[accountId+deviceId]')
    .equals([active.accountId,active.deviceId]).filter(x=>
      x.grantId===grantId&&x.photoId===photoId&&x.generation===row.generation).first()
  same(active.accountId,active.deviceId)
  if(prior){
    if(prior.state==='conflict')throw Error('grant.thumbnail_conflict')
    return {assetId:prior.assetId,operationId:prior.operationId}
  }
  const header=await openLocalPhotoVault().readHeader(photoId)
  same(active.accountId,active.deviceId)
  if(!header||header.accountId!==active.accountId||
    header.capture?.assignmentId!==row.assignmentId||header.expiresAt<=Date.now())
    throw Error('grant.photo_not_owned')
  const response=await photoRequest('/'+photoId+'/manifests')
  same(active.accountId,active.deviceId)
  if(!response.ok)throw Error('grant.photo_http_'+response.status)
  const data=await response.json() as {photoId:string;expiresAt:number;assets:CloudAsset[]}
  same(active.accountId,active.deviceId)
  if(data.photoId!==photoId||data.expiresAt!==header.expiresAt||!Array.isArray(data.assets))
    throw Error('grant.invalid_manifest')
  const thumbnail=data.assets.find(asset=>asset.kind==='thumbnail'&&
    asset.manifest.accountId===active.accountId&&asset.manifest.photoId===photoId&&
    asset.manifest.kind==='thumbnail'&&asset.manifest.expiresAt===header.expiresAt)
  if(!thumbnail||!/^[a-f0-9]{64}$/.test(thumbnail.manifest.cipherDigest)||
    !Number.isSafeInteger(thumbnail.revision)||thumbnail.revision<1)
    throw Error('grant.thumbnail_missing')
  const local=await getLocalGrantIdentity(row)
  if(!local.ownerAccountSpki||local.ownerAccountSpki!==currentAccountSpki())
    throw Error('grant.unpinned_owner')
  const secret=local.secret
  same(active.accountId,active.deviceId)
  const ctx:KeyContext={
    grantId:row.grantId,generation:row.generation,assignmentId:row.assignmentId,
    ownerAccountId:row.ownerId,recipientAccountId:row.recipientId,photoId,
    assetId:thumbnail.assetId,kind:'thumbnail',revision:thumbnail.revision,
    expiresAt:header.expiresAt,cipherDigest:thumbnail.manifest.cipherDigest,
  }
  const envelope=await withCurrentOwnerAssetDEK(thumbnail.assetId,
    header.expiresAt,thumbnail.manifest.wrappedDEK,async raw=>{
      same(active.accountId,active.deviceId)
      return sealRecipientKey(secret,ctx,raw)
    })
  same(active.accountId,active.deviceId)
  const statement={
    v:1,operationId:crypto.randomUUID(),grantId:row.grantId,
    generation:row.generation,assignmentId:row.assignmentId,
    ownerAccountId:row.ownerId,recipientAccountId:row.recipientId,
    photoId,assetId:thumbnail.assetId,kind:'thumbnail',assetRevision:thumbnail.revision,
    expiresAt:header.expiresAt,cipherDigest:thumbnail.manifest.cipherDigest,
    envelope,
  }
  const contract=JSON.stringify(statement)
  const signature=await signMetadataContract('photobunker.photo-recipient.v1\n'+contract)
  const proof=await signOwnerDeviceProof(contract)
  same(active.accountId,active.deviceId)
  const queued:ThumbnailShareRow={
    id:scopedId(active.accountId,active.deviceId,statement.operationId),
    accountId:active.accountId,deviceId:active.deviceId,grantId:row.grantId,
    photoId,assetId:thumbnail.assetId,generation:row.generation,
    operationId:statement.operationId,expiresAt:header.expiresAt,
    contract,signature,proof,state:'pending',attempts:0,retryAt:0,lastError:null,
  }
  // Only ciphertext-wrapped DEK + detached signed contract crosses durable storage.
  // If network dies immediately, subsequent flush sends these exact same bytes.
  await grantDb.thumbnailShares.add(queued)
  same(active.accountId,active.deviceId)
  wake()
  return {assetId:thumbnail.assetId,operationId:statement.operationId}
}

export type ThumbnailShareStatus=Readonly<{
  operationId:string;grantId:string;photoId:string;state:'pending'|'retry'|'conflict';
  lastError:string|null
}>
export async function pendingThumbnailShares():Promise<ThumbnailShareRow[]>{
  const {accountId,deviceId}=current()
  const rows=await grantDb.thumbnailShares.where('[accountId+deviceId]')
    .equals([accountId,deviceId]).toArray()
  same(accountId,deviceId)
  return rows.filter(x=>x.state==='pending'||x.state==='retry')
    .sort((a,b)=>a.retryAt-b.retryAt)
}
export async function thumbnailShareStatuses():Promise<ThumbnailShareStatus[]>{
  const {accountId,deviceId}=current()
  const rows=await grantDb.thumbnailShares.where('[accountId+deviceId]')
    .equals([accountId,deviceId]).toArray()
  same(accountId,deviceId)
  return rows.map(x=>({operationId:x.operationId,grantId:x.grantId,
    photoId:x.photoId,state:x.state,lastError:x.lastError}))
}
export async function thumbnailShareResult(row:ThumbnailShareRow,
  outcome:'ack'|'retry'|'conflict',reason=''):Promise<void>{
  same(row.accountId,row.deviceId)
  await grantDb.transaction('rw',grantDb.thumbnailShares,async()=>{
    const saved=await grantDb.thumbnailShares.get(row.id)
    if(!saved||saved.operationId!==row.operationId||
      saved.contract!==row.contract||saved.signature!==row.signature)
      throw Error('grant.share_changed')
    if(outcome==='ack'){await grantDb.thumbnailShares.delete(row.id);return}
    const attempts=Math.min(24,saved.attempts+1)
    await grantDb.thumbnailShares.update(row.id,{
      state:outcome,attempts,
      retryAt:Date.now()+Math.min(300000,1000*2**Math.min(8,attempts)),
      lastError:reason.slice(0,90),
    })
  })
  same(row.accountId,row.deviceId)
}

export async function getLocalGrantIdentity(row:ServerGrant):Promise<{secret:string;ownerAccountSpki:string|null}>{
  const active=current()
  if(row.ownerId!==active.accountId&&row.recipientId!==active.accountId)
    throw Error('grant.denied')
  const vault=await grantDb.secrets.get(scopedId(active.accountId,active.deviceId,row.grantId))
  same(active.accountId,active.deviceId)
  if(!vault||vault.assignmentId!==row.assignmentId||
    vault.ownerAccountId!==row.ownerId||vault.recipientAccountId!==row.recipientId)
    throw Error('grant.secret_missing')
  const grant=acquireStorageKeys()
  const value=await openLocalGrantIdentity(grant,context(row),vault.envelope)
  same(active.accountId,active.deviceId)
  return value
}

export async function getLocalGrantSecret(row:ServerGrant):Promise<string>{
  return (await getLocalGrantIdentity(row)).secret
}
