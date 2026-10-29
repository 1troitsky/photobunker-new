import {identity,assignmentRequest} from '../../identity'
import {openAssignments} from '../../assignments'
import {grantDb,scopedId,type OperationRow,type SecretRow} from '../infrastructure/database'
import {sealLocalGrantSecret,openLocalGrantSecret} from '../infrastructure/secret'
import {createPhotoGrantCode,photoGrantCodeHash,sealGrantSecret,openGrantSecret,
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
async function storeSecretAndOperation(c:GrantCommand,ctx:GrantInvitationContext,secret:string){
  const active=current(),g=acquireStorageKeys()
  const sealed=await sealLocalGrantSecret(g,ctx,secret)
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
  const sealedKey=await sealGrantSecret(code,secret,ctx)
  const codeHash=await photoGrantCodeHash(code)
  same(active.accountId,active.deviceId)
  const c:GrantCommand={v:1,opId:crypto.randomUUID(),kind:'invite',
    grantId,assignmentId,targetId:recipientId,role,expectedGeneration:0,
    expiresAt:Date.now()+86400000,codeHash,sealedKey}
  await storeSecretAndOperation(c,ctx,secret)
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
  const secret=await openGrantSecret(code,row.sealedKey,ctx)
  same(active.accountId,active.deviceId)
  await storeSecretAndOperation(command('accept',row),ctx,secret)
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
export async function getLocalGrantSecret(row:ServerGrant):Promise<string>{
  const active=current()
  if(row.ownerId!==active.accountId&&row.recipientId!==active.accountId)
    throw Error('grant.denied')
  const vault=await grantDb.secrets.get(scopedId(active.accountId,active.deviceId,row.grantId))
  same(active.accountId,active.deviceId)
  if(!vault||vault.assignmentId!==row.assignmentId||
    vault.ownerAccountId!==row.ownerId||vault.recipientAccountId!==row.recipientId)
    throw Error('grant.secret_missing')
  const grant=acquireStorageKeys()
  const secret=await openLocalGrantSecret(grant,context(row),vault.envelope)
  same(active.accountId,active.deviceId)
  return secret
}
