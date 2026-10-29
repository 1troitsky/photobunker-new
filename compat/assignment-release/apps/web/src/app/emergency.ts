import { ref } from 'vue'
import { account,deviceId,hasConfirmedIdentity } from '../identity/store'
import { identityRequest } from '../identity/api'
import { appLocked,appLockReady,appPinEnabled,confirmAppPinForLocalDelete,matchesAppPinForLocalDelete } from './lock'
import { matchesLocalDeletePin,provePB1Locally } from './local-delete-pin'
import { generateEmergencyKey,openEmergencyKey,matchesEmergencyPin as matchesSealed,signEmergencyIntent,type SealedEmergencyKey,type EmergencyIntent } from './emergency-crypto'
import { readEmergency,changeEmergency,type EmergencyRow,type EmergencyPending } from './emergency-store'

export const emergencyReady=ref(false)
export const emergencyActive=ref(false)
export const emergencyFailure=ref('')
export const emergencyBusy=ref(false)
const uuid=()=>crypto.randomUUID()
const scope=()=>({owner:account.value?.id??'',device:deviceId.value})
let epoch=0
const assertScope=(s:ReturnType<typeof scope>,generation:number)=>{
  if(!s.owner||!s.device||s.owner!==account.value?.id||
     s.device!==deviceId.value||epoch!==generation||
     !hasConfirmedIdentity()||appLocked.value||!appLockReady.value)
    throw new Error('emergency.scope')
}
type ServerKey={keyId:string|null;revision:number;active:boolean;createdAt?:string|null}
async function onlineStatus(s:ReturnType<typeof scope>,generation:number) {
  assertScope(s,generation)
  const result=await identityRequest<ServerKey>('/emergency/key')
  assertScope(s,generation)
  if(!Number.isSafeInteger(result.revision)||result.revision<0||
    (result.active && !result.keyId))throw new Error('emergency.server')
  return result
}
function good(row:EmergencyRow|undefined,s:ReturnType<typeof scope>) {
  if(row&&(row.accountId!==s.owner||row.deviceId!==s.device||row.version!==1))
    throw new Error('emergency.storage')
  return row
}
/** Versioned separate PIN throttling, scoped to this emergency key/device.
 * A copied browser profile still permits OFFLINE guessing; not a hardware PIN.
 */
async function openWithThrottle(s:ReturnType<typeof scope>,generation:number,pin:string,
  sealed:SealedEmergencyKey) {
  assertScope(s,generation)
  const before=good(await readEmergency(s.owner,s.device),s)
  const attempts=before?.attempts
  const now=Date.now()
  if(attempts&&(now<attempts.lastWall||now<attempts.cooldownUntil))
    throw new Error('emergency.cooldown')
  let valid=false
  try{await openEmergencyKey(pin,sealed);valid=true}catch(error){
    if(!(error instanceof Error)||error.message!=='emergency.wrong')throw error
  }
  assertScope(s,generation)
  await changeEmergency(s.owner,s.device,row=>{
    if(!row)throw new Error('emergency.storage')
    if(!row.confirmed || row.confirmed.keyId!==sealed.keyId)
      throw new Error('emergency.scope')
    const old=row.attempts??{failures:0,cooldownUntil:0,lastWall:0},time=Date.now()
    if(time<old.lastWall||time<old.cooldownUntil)throw new Error('emergency.cooldown')
    const failures=valid?0:Math.min(100,old.failures+1)
    const delay=failures<3?0:Math.min(60000,2000*2**Math.min(5,failures-3))
    return {...row,attempts:{failures,cooldownUntil:valid?0:time+delay,lastWall:time}}
  })
  assertScope(s,generation)
  if(!valid)throw new Error('emergency.wrong')
}
function mutate(s:ReturnType<typeof scope>,pending:EmergencyPending,revision:number) {
  return changeEmergency(s.owner,s.device,prior=>{
    if(prior?.pending)throw new Error('emergency.pending')
    if(prior&&prior.revision!==revision)throw new Error('emergency.conflict')
    return {version:1,accountId:s.owner,deviceId:s.device,
      revision,confirmed:prior?.confirmed,pending}
  })
}
async function reconcilePending(s:ReturnType<typeof scope>,generation:number) {
  assertScope(s,generation)
  const row=good(await readEmergency(s.owner,s.device),s)
  assertScope(s,generation)
  const pending=row?.pending
  const remote=await onlineStatus(s,generation)
  if(!pending)return {row,remote}
  if(pending.action==='register') {
    const confirmed=remote.active&&remote.keyId===pending.keyId&&
      remote.revision===pending.expectedRevision+1
    if(!confirmed){
      if(remote.revision!==pending.expectedRevision ||
        remote.active&&remote.keyId===pending.keyId)throw new Error('emergency.conflict')
      const ack=await identityRequest<{keyId:string;revision:number;active:boolean}>(
        '/emergency/key','PUT',{operationId:pending.operationId,keyId:pending.keyId,
          publicKey:pending.sealed.publicKey,expectedRevision:pending.expectedRevision})
      assertScope(s,generation)
      if(ack.keyId!==pending.keyId||ack.revision!==pending.expectedRevision+1||!ack.active)
        throw new Error('emergency.server')
    }
    assertScope(s,generation)
    await changeEmergency(s.owner,s.device,previous=>{
      if(previous?.pending?.operationId!==pending.operationId)throw new Error('emergency.conflict')
      return {version:1,accountId:s.owner,deviceId:s.device,
        revision:pending.expectedRevision+1,
        confirmed:{keyId:pending.keyId,revision:pending.expectedRevision+1,sealed:pending.sealed}}
    })
  }else{
    const done=!remote.active&&remote.revision===pending.revision
    if(!done) {
      if(!remote.active||remote.keyId!==pending.keyId||remote.revision!==pending.revision)
        throw new Error('emergency.conflict')
      const ack=await identityRequest<{keyId:string;revision:number;active:boolean}>(
        '/emergency/key','DELETE',{operationId:pending.operationId,keyId:pending.keyId,
          revision:pending.revision})
      assertScope(s,generation)
      if(ack.active||ack.revision!==pending.revision)throw new Error('emergency.server')
    }
    assertScope(s,generation)
    await changeEmergency(s.owner,s.device,previous=>{
      if(previous?.pending?.operationId!==pending.operationId)throw new Error('emergency.conflict')
      return {version:1,accountId:s.owner,deviceId:s.device,revision:pending.revision}
    })
  }
  assertScope(s,generation)
  const final=good(await readEmergency(s.owner,s.device),s)
  return {row:final,remote:await onlineStatus(s,generation)}
}
export function clearEmergencyView() {
  epoch++
  emergencyReady.value=false;emergencyActive.value=false;emergencyFailure.value=''
}
export async function loadEmergencyRegistration() {
  const generation=++epoch,s=scope()
  emergencyReady.value=false;emergencyFailure.value=''
  if(!s.owner||!s.device||!hasConfirmedIdentity()||appLocked.value)return
  try{
    const {row,remote}=await reconcilePending(s,generation)
    assertScope(s,generation)
    // Server controls readiness; a locally confirmed record alone is NOT proof.
    emergencyActive.value=!!(remote.active&&row?.confirmed&&
      row.confirmed.keyId===remote.keyId&&row.confirmed.revision===remote.revision)
    emergencyReady.value=true
    if(remote.active&&!emergencyActive.value)emergencyFailure.value='emergency.unavailable'
  }catch(error){
    if(generation===epoch&&s.owner===account.value?.id&&s.device===deviceId.value){
      emergencyReady.value=false;emergencyActive.value=false
      emergencyFailure.value=error instanceof Error?error.message:'emergency.storage'
    }
  }
}
async function exclusive<T>(s:ReturnType<typeof scope>,run:()=>Promise<T>):Promise<T> {
  if(!navigator.locks?.request)throw new Error('emergency.storage')
  return navigator.locks.request('photobunker-emergency:'+s.owner+':'+s.device,run)
}
async function proveSettings(s:ReturnType<typeof scope>,generation:number,pb1:string,appPin:string) {
  assertScope(s,generation)
  if(appPinEnabled.value){
    if(!appPin)throw new Error('emergency.appPin')
    await confirmAppPinForLocalDelete(appPin)
  }
  assertScope(s,generation)
  await provePB1Locally(pb1,account.value?.rootKey??'')
  assertScope(s,generation)
}
export async function configureEmergencyPin(next:string,repeat:string,pb1:string,appPin:string,oldPin='') {
  const s=scope(),generation=epoch
  if(next!==repeat||!/^(?:\d{6}|\d{8})$/.test(next))throw new Error('emergency.pin')
  assertScope(s,generation)
  emergencyBusy.value=true
  try {await exclusive(s,async()=>{
    const remote=await onlineStatus(s,generation)
    let row=good(await readEmergency(s.owner,s.device),s)
    if(row?.pending)throw new Error('emergency.pending')
    if(row?.confirmed){
      if(!oldPin)throw new Error('emergency.oldPin')
      await openWithThrottle(s,generation,oldPin,row.confirmed.sealed)
    }
    await proveSettings(s,generation,pb1,appPin)
    if(await matchesAppPinForLocalDelete(next) || await matchesLocalDeletePin(next))
      throw new Error('emergency.samePin')
    assertScope(s,generation)
    if(row && row.revision!==remote.revision)throw new Error('emergency.conflict')
    const keyId=uuid(),operationId=uuid()
    const sealed=await generateEmergencyKey(next,keyId)
    assertScope(s,generation)
    await mutate(s,{action:'register',keyId,operationId,expectedRevision:remote.revision,sealed},remote.revision)
    // A durable local commit PRECEDES any remote mutation.
    await reconcilePending(s,generation)
    assertScope(s,generation)
    emergencyActive.value=true;emergencyReady.value=true;emergencyFailure.value=''
  })}finally{emergencyBusy.value=false}
}
export async function disableEmergencyPin(oldPin:string,pb1:string,appPin:string) {
  const s=scope(),generation=epoch
  assertScope(s,generation)
  emergencyBusy.value=true
  try {await exclusive(s,async()=>{
    const row=good(await readEmergency(s.owner,s.device),s)
    const current=row?.confirmed
    if(!current||row?.pending)throw new Error('emergency.unavailable')
    await openWithThrottle(s,generation,oldPin,current.sealed)
    await proveSettings(s,generation,pb1,appPin)
    const remote=await onlineStatus(s,generation)
    if(!remote.active||remote.keyId!==current.keyId||remote.revision!==current.revision)
      throw new Error('emergency.conflict')
    await mutate(s,{action:'disable',keyId:current.keyId,revision:current.revision,operationId:uuid()},row!.revision)
    await reconcilePending(s,generation)
    assertScope(s,generation)
    emergencyActive.value=false;emergencyReady.value=true;emergencyFailure.value=''
  })}finally{emergencyBusy.value=false}
}
/** Comparison only; no authentication against the deletion key, no unlock.
 * Used to prevent either app PIN or local-delete PIN being set to this PIN.
 */
export async function matchesConfiguredEmergencyPin(candidate:string) {
  const s=scope(),generation=epoch
  if(!s.owner||!s.device||!globalThis.indexedDB)return false
  const row=good(await readEmergency(s.owner,s.device),s)
  assertScope(s,generation)
  for(const sealed of [row?.confirmed?.sealed,row?.pending?.action==='register'?row.pending.sealed:undefined]){
    if(sealed&&await matchesSealed(candidate,sealed))return true
    assertScope(s,generation)
  }
  return false
}
/** R1-08A crypto primitive only. R1-08B alone will wire emergency trigger,
 * journal, offline delivery and local credential destruction.
 */
/** R1-08B: the ONLY signing route from the LOCKED app PIN screen.
 * Valid on known offline A/device but DOES NOT unlock PhotoBunker.
 * The caller must hold the same navigator.locks scope as setup/rotation
 * through signing AND durable command commit, to prevent key rotation races.
 */
export async function signFromLockedScreen(pin:string,operationId:string) {
  const s=scope()
  if(!s.owner||!s.device||!appLockReady.value||!appLocked.value)
    throw new Error('emergency.scope')
  const row=good(await readEmergency(s.owner,s.device),s)
  if(!row?.confirmed||row.pending)throw new Error('emergency.unavailable')
  const key=row.confirmed
  const now=Date.now(), before=row.attempts
  if(before&&(now<before.lastWall||now<before.cooldownUntil))
    throw new Error('emergency.cooldown')
  let matched=false
  try{await openEmergencyKey(pin,key.sealed);matched=true}
  catch(error){if(!(error instanceof Error)||error.message!=='emergency.wrong')throw error}
  if(s.owner!==account.value?.id||s.device!==deviceId.value||!appLocked.value)
    throw new Error('emergency.scope')
  await changeEmergency(s.owner,s.device,current=>{
    if(!current||current.pending||current.confirmed?.keyId!==key.keyId||
      current.confirmed.revision!==key.revision)throw new Error('emergency.scope')
    const state=current.attempts??{failures:0,cooldownUntil:0,lastWall:0},wall=Date.now()
    if(wall<state.lastWall||wall<state.cooldownUntil)throw new Error('emergency.cooldown')
    const failures=matched?0:Math.min(100,state.failures+1)
    return {...current,attempts:{failures,lastWall:wall,
      cooldownUntil:matched?0:wall+(failures<3?0:Math.min(60000,2000*2**Math.min(5,failures-3)))}}
  })
  if(!matched)throw new Error('emergency.wrong')
  if(s.owner!==account.value?.id||s.device!==deviceId.value||!appLocked.value)
    throw new Error('emergency.scope')
  const intent:EmergencyIntent={version:1,operationId,accountId:s.owner,
    keyId:key.keyId,revision:key.revision,action:'emergency-delete'}
  const signed=await signEmergencyIntent(pin,key.sealed,intent)
  if(s.owner!==account.value?.id||s.device!==deviceId.value||!appLocked.value)
    throw new Error('emergency.scope')
  return {signed,scope:s}
}
export async function makeSignedEmergencyIntent(pin:string,operationId:string) {
  const s=scope(),generation=epoch
  assertScope(s,generation)
  const row=good(await readEmergency(s.owner,s.device),s)
  if(!row?.confirmed||row.pending)throw new Error('emergency.unavailable')
  const intent:EmergencyIntent={
    version:1,operationId,accountId:s.owner,keyId:row.confirmed.keyId,
    revision:row.confirmed.revision,action:'emergency-delete',
  }
  await openWithThrottle(s,generation,pin,row.confirmed.sealed)
  const signed=await signEmergencyIntent(pin,row.confirmed.sealed,intent)
  assertScope(s,generation)
  return signed
}
