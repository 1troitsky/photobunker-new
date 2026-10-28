import { computed, shallowRef } from 'vue'
import { call, challenge, currentGeneration, envelopeHash, invalidateRequests, resetCsrf } from '../infrastructure/api'
import { b64, createPB2, digest, exportECDHPublic, freshPackage, hex, importSigner, newPairingKey,
  openDevice, openPairing, openRecovery, parsePB2, random, sealDevice, sealPairing,
  sealRecovery, sign, uuid, exchangeKey, wrapAssetDEK, unwrapAssetDEK } from '../infrastructure/crypto'
import type { PackageV2 } from '../infrastructure/crypto'
import { getPending, listDevices, newLocalDevice, openIdentityDB, probeCapabilities,
  putPending, reservePending, dropPending, saveDevice, getRecoveryPending, saveRecoveryPending,
  dropRecoveryPending, getPairingPending, savePairingPending, dropPairingPending,
  getRotationPending, saveRotationPending, dropRotationPending, markSignedOut,
  isSignedOut } from '../infrastructure/storage'
import type { LocalDevice, PairingPending } from '../infrastructure/storage'

type Active={accountId:string; deviceId:string; pkg:PackageV2; device:LocalDevice; offline:boolean}
const state=shallowRef<Active|null>(null)
export const identity=computed(()=>{const s=state.value;return s?{accountId:s.accountId,deviceId:s.deviceId,offline:s.offline}:null})
const disposers=new Set<()=>void>()
const identityChannel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('photobunker-identity-v2')
let pairing: PairingPending|undefined
const objectUrls=new Set<string>()
export function registerDecryptedObjectUrl(url:string):void{objectUrls.add(url)}
function assertEpoch(epoch:number):void{if(epoch!==currentGeneration())throw new DOMException('Account changed','AbortError')}
function dispose(){
  invalidateRequests()
  pairing=undefined
  state.value=null
  for(const url of objectUrls){URL.revokeObjectURL(url)}
  objectUrls.clear()
  for(const fn of disposers)try{fn()}catch{ /* cleanup must continue */ }
}
export function onIdentityCleanup(fn:()=>void):()=>void {disposers.add(fn);return()=>disposers.delete(fn)}
export async function logout():Promise<void>{
  const current=state.value
  if(current)await markSignedOut(current.accountId,current.deviceId,true)
  dispose()
  resetCsrf()
  identityChannel?.postMessage({event:'identity-session-changed'})
  // Local sign-out is already durable. A missing network acknowledgement must
  // not reopen the account or turn the successful local action into an error.
  await call('/session','DELETE').catch(()=>{})
}
export function forgetRuntime():void{dispose();resetCsrf()}
export async function availableDevices():Promise<LocalDevice[]> {return listDevices()}
export async function prepareCreate():Promise<string>{
  await probeCapabilities()
  const existing=await getPending()
  if(existing)throw new Error('identity.pending_account_requires_recovery_key')
  const kit=await createPB2()
  const operationId=uuid(),reservationProof=b64(random(32))
  const local=await newLocalDevice('')
  await reservePending({
    operationId,reservationProof,kitLocator:kit.locator,deviceId:local.deviceId,
    deviceKey:local.deviceKey,deviceSpki:local.deviceSpki,encryptionKey:local.encryptionKey,
  })
  // A raw key is returned to the UI only, never to storage, URL or server.
  return kit.encoded
}
export async function pendingCreate():Promise<boolean>{return Boolean(await getPending())}
export async function discardPending():Promise<void>{
  const p=await getPending()
  if(p)await dropPending(p.operationId)
}
async function prove(purpose:string,payload:Record<string,string>,
  signer:CryptoKey,deviceSigner:CryptoKey|null,envelope:unknown=null){
  const c=await challenge(purpose,payload)
  const reply=await call<{accountId:string;deviceId:string;expiresAt:string}>('/proof','POST',{
    challengeId:c.id,signature:await sign(signer,c.message),
    deviceSignature:deviceSigner?await sign(deviceSigner,c.message):'',envelope,
  })
  resetCsrf()
  return reply
}
async function activated(device:LocalDevice,pkg:PackageV2,offline=false):Promise<void>{
  dispose()
  state.value={accountId:device.accountId,deviceId:device.deviceId,pkg,device,offline}
  identityChannel?.postMessage({event:'identity-session-changed'})
}
export async function finishCreate(encoded:string):Promise<{accountId:string}>{
  const epoch=currentGeneration()
  const kit=await parsePB2(encoded)
  await probeCapabilities()
  const pending=await getPending()
  if(!pending)throw new Error('identity.no_pending_account')
  if(kit.locator!==pending.kitLocator)throw new Error('identity.pending_key_mismatch')
  const prepared=await call<{accountId:string;status:string}>('/prepare','POST',{
    operationId:pending.operationId,reservationProof:pending.reservationProof,
  })
  assertEpoch(epoch)
  let pkg:PackageV2
  if(pending.envelope){
    if(pending.accountId!==prepared.accountId)throw new Error('identity.reservation_mismatch')
    pkg=await openDevice(pending.envelope,pending.encryptionKey,prepared.accountId,pending.deviceId)
  }else{
    pkg=(await freshPackage(prepared.accountId)).pkg
    const envelope=await sealDevice(pkg,pending.deviceId,pending.encryptionKey)
    await openDevice(envelope,pending.encryptionKey,prepared.accountId,pending.deviceId)
    await putPending({...pending,accountId:prepared.accountId,envelope})
  }
  const device:LocalDevice={accountId:prepared.accountId,deviceId:pending.deviceId,deviceKey:pending.deviceKey,
    deviceSpki:pending.deviceSpki,encryptionKey:pending.encryptionKey,envelope:pending.envelope ?? await sealDevice(pkg,pending.deviceId,pending.encryptionKey)}
  assertEpoch(epoch)
  if(prepared.status==='ready'){
    // Lost registration ACK: same operation, same keys, login; never regenerate keys.
    await loginWithDevice(device)
  }else{
    const recovery=await sealRecovery(pkg,kit)
    const checked=await openRecovery(recovery,kit,prepared.accountId)
    if(checked.accountSpki!==pkg.accountSpki)throw new Error('identity.local_recovery_verify_failed')
    const payload={accountId:prepared.accountId,accountSpki:pkg.accountSpki,deviceId:device.deviceId,
      deviceSpki:device.deviceSpki,envelopeHash:await envelopeHash(recovery),locator:kit.locator,
      operationId:pending.operationId,purpose:'register'}
    await prove('register',payload,await importSigner(pkg.accountPkcs8),device.deviceKey,recovery)
    await saveDevice(device)
    assertEpoch(epoch)
    await activated(device,pkg)
  }
  await saveDevice(device)
  await dropPending(pending.operationId)
  return {accountId:prepared.accountId}
}
export async function loginWithDevice(device:LocalDevice):Promise<void>{
  const epoch=currentGeneration()
  const pkg=await openDevice(device.envelope,device.encryptionKey,device.accountId,device.deviceId)
  const payload={accountId:device.accountId,deviceId:device.deviceId,purpose:'login'}
  const result=await prove('login',payload,device.deviceKey,null)
  if(result.accountId!==device.accountId || result.deviceId!==device.deviceId)throw new Error('identity.session_mismatch')
  await markSignedOut(device.accountId,device.deviceId,false)
  assertEpoch(epoch)
  await activated(device,pkg)
}
export async function offlineUnlock(device:LocalDevice):Promise<void>{
  const epoch=currentGeneration()
  const pkg=await openDevice(device.envelope,device.encryptionKey,device.accountId,device.deviceId)
  await markSignedOut(device.accountId,device.deviceId,false)
  assertEpoch(epoch)
  await activated(device,pkg,true)
}
export async function restore(encoded:string):Promise<void>{
  const epoch=currentGeneration()
  await probeCapabilities()
  const kit=await parsePB2(encoded)
  const row=await call<{accountId:string;accountSpki:string;revision:number;envelope:unknown}>('/recovery/'+kit.locator)
  const pkg=await openRecovery(row.envelope,kit,row.accountId)
  if(pkg.accountSpki!==row.accountSpki || pkg.revision!==row.revision)throw new Error('identity.recovery_mismatch')
  const saved=await getRecoveryPending(kit.locator)
  if(saved && saved.device.accountId!==row.accountId)throw new Error('identity.recovery_state_conflict')
  const device=saved?.device ?? await newLocalDevice(row.accountId)
  if(!saved){
    device.envelope=await sealDevice(pkg,device.deviceId,device.encryptionKey)
    await saveRecoveryPending({locator:kit.locator,device})
  }else{
    const local=await openDevice(device.envelope,device.encryptionKey,row.accountId,device.deviceId)
    if(local.accountSpki!==pkg.accountSpki||local.revision!==pkg.revision)throw new Error('identity.recovery_state_conflict')
    let loggedIn=false
    try{await loginWithDevice(device);loggedIn=true}catch{ /* Enrollment was not committed. */ }
    if(loggedIn){
      await saveDevice(device)
      await dropRecoveryPending(kit.locator)
      return
    }
  }
  await openDevice(device.envelope,device.encryptionKey,row.accountId,device.deviceId)
  const payload={accountId:row.accountId,deviceId:device.deviceId,deviceSpki:device.deviceSpki,purpose:'recover',revision:String(row.revision)}
  await prove('recover',payload,await importSigner(pkg.accountPkcs8),device.deviceKey)
  await saveDevice(device)
  await dropRecoveryPending(kit.locator)
  assertEpoch(epoch)
  await activated(device,pkg)
}
export async function switchAccount(accountId:string,deviceId:string):Promise<void>{
  dispose()
  identityChannel?.postMessage({event:'identity-session-changed'})
  const epoch=currentGeneration()
  resetCsrf()
  const devices=await listDevices()
  const device=devices.find(x=>x.accountId===accountId && x.deviceId===deviceId)
  if(!device)throw new Error('identity.unknown_device')
  assertEpoch(epoch)
  await loginWithDevice(device)
}
export async function rotateRecoveryKey(encoded:string):Promise<void>{
  const epoch=currentGeneration()
  const current=state.value
  if(!current || current.offline)throw new Error('identity.requires_online')
  await probeCapabilities()
  const kit=await parsePB2(encoded)
  let pending=await getRotationPending(current.accountId)
  if(pending && pending.locator!==kit.locator)throw new Error('identity.rotation_key_mismatch')
  if(!pending){
    const updated:PackageV2={...current.pkg,revision:current.pkg.revision+1,wrappingKeyId:b64(random(16))}
    const recoveryEnvelope=await sealRecovery(updated,kit)
    await openRecovery(recoveryEnvelope,kit,updated.accountId)
    pending={
      accountId:current.accountId,deviceId:current.deviceId,operationId:uuid(),
      envelopeHash:await envelopeHash(recoveryEnvelope),expectedRevision:current.pkg.revision,
      locator:kit.locator,recoveryEnvelope,
      deviceEnvelope:await sealDevice(updated,current.deviceId,current.device.encryptionKey),
    }
    await saveRotationPending(pending)
  }
  const updated=await openDevice(pending.deviceEnvelope,current.device.encryptionKey,current.accountId,current.deviceId)
  const payload={accountId:current.accountId,deviceId:current.deviceId,
    envelopeHash:pending.envelopeHash,expectedRevision:String(pending.expectedRevision),
    locator:pending.locator,operationId:pending.operationId,purpose:'rotate'}
  let status=await call<{committed:boolean;revision:number}>('/rotations/status','POST',{
    operationId:pending.operationId,envelopeHash:pending.envelopeHash,
  })
  if(!status.committed){
    try {
      await prove('rotate',payload,await importSigner(current.pkg.accountPkcs8),current.device.deviceKey,pending.recoveryEnvelope)
      status={committed:true,revision:updated.revision}
    } catch(error) {
      // Lost response: verify the immutable operation before claiming completion.
      try {
        status=await call<{committed:boolean;revision:number}>('/rotations/status','POST',{
          operationId:pending.operationId,envelopeHash:pending.envelopeHash,
        })
        if (!status.committed || status.revision!==updated.revision) throw error
      }catch{ throw new Error('identity.rotation_unconfirmed') }
    }
  }
  if(status.revision!==updated.revision)throw new Error('identity.rotation_state_conflict')
  assertEpoch(epoch)
  const device={...current.device,envelope:pending.deviceEnvelope}
  await saveDevice(device)
  await dropRotationPending(current.accountId)
  assertEpoch(epoch)
  await activated(device,updated)
}
function pairSalt(id:string,fingerprint:string):Promise<Uint8Array<ArrayBuffer>>{
  return digest(new TextEncoder().encode('photobunker/pairing/v2:'+id+':'+fingerprint))
}
export async function beginPairing(accountId:string):Promise<{id:string;fingerprint:string}>{
  await probeCapabilities()
  pairing=pairing ?? await getPairingPending()
  if(pairing && pairing.accountId!==accountId)throw new Error('identity.pairing_state_conflict')
  if(!pairing){
    const device=await newLocalDevice(accountId),key=await newPairingKey(),token=b64(random(32))
    const ecdhSpki=await exportECDHPublic(key.publicKey)
    const fingerprint=hex(await digest(new TextEncoder().encode(
      'photobunker/pairing/fingerprint/v2:'+accountId+':'+device.deviceId+':'+device.deviceSpki+':'+ecdhSpki)))
    pairing={accountId,device,key,token,id:uuid(),fingerprint,ecdhSpki}
    await savePairingPending(pairing)
  }
  if(pairing.device.envelope)return {id:pairing.id,fingerprint:pairing.fingerprint}
  const result=await call<{pairingId:string}>('/pairings','POST',{
    pairingId:pairing.id,accountId,deviceId:pairing.device.deviceId,deviceSpki:pairing.device.deviceSpki,
    ecdhSpki:pairing.ecdhSpki,fingerprint:pairing.fingerprint,requestToken:pairing.token,
  })
  if(result.pairingId!==pairing.id)throw new Error('identity.pairing_mismatch')
  return {id:pairing.id,fingerprint:pairing.fingerprint}
}
export async function pairingRequests():Promise<{id:string;device_id:string;device_spki:string;ecdh_spki:string;fingerprint:string}[]>{
  return (await call<{pairings:{id:string;device_id:string;device_spki:string;ecdh_spki:string;fingerprint:string}[]}>('/pairings')).pairings
}
export async function approvePairing(request:{id:string;device_id:string;device_spki:string;ecdh_spki:string;fingerprint:string},confirm:string):Promise<void>{
  const current=state.value
  if(!current || current.offline || current.deviceId===request.device_id)throw new Error('identity.not_trusted_approver')
  const calculated=hex(await digest(new TextEncoder().encode(
    'photobunker/pairing/fingerprint/v2:'+current.accountId+':'+request.device_id+':'+request.device_spki+':'+request.ecdh_spki)))
  if(calculated!==request.fingerprint || confirm!==calculated.slice(0,12))throw new Error('identity.fingerprint_not_confirmed')
  const eph=await newPairingKey()
  const shared=await exchangeKey(eph.privateKey,request.ecdh_spki,
    'photobunker/pairing/envelope/v2:'+current.accountId+':'+request.id+':'+request.device_id,
    (await pairSalt(request.id,request.fingerprint)).slice(0,16))
  const envelope=await sealPairing(current.pkg,shared,request.id,request.device_id)
  await call('/pairings/'+request.id+'/approve','POST',{envelope,approverEcdhSpki:await exportECDHPublic(eph.publicKey),fingerprint:request.fingerprint})
}
export async function finishPairing():Promise<void>{
  const epoch=currentGeneration()
  const p=pairing
  if(!p)throw new Error('identity.no_pairing')
  if(p.device.envelope){
    let loggedIn=false
    try{await loginWithDevice(p.device);loggedIn=true}catch{ /* Enrollment did not commit. */ }
    if(loggedIn){
      await saveDevice(p.device)
      await dropPairingPending(p.id)
      return
    }
  }
  const result=await call<{status:'pending'|'approved';accountId:string;envelope?:{envelope:{iv:string;ciphertext:string};approverEcdhSpki:string}}>('/pairings/'+p.id+'/poll','POST',{requestToken:p.token})
  if(result.status!=='approved'||!result.envelope)throw new Error('identity.pairing_pending')
  if(result.accountId!==p.accountId)throw new Error('identity.pairing_mismatch')
  const shared=await exchangeKey(p.key.privateKey,result.envelope.approverEcdhSpki,
    'photobunker/pairing/envelope/v2:'+p.accountId+':'+p.id+':'+p.device.deviceId,
    (await pairSalt(p.id,p.fingerprint)).slice(0,16))
  const pkg=await openPairing(result.envelope.envelope,shared,p.accountId,p.id,p.device.deviceId)
  p.device.envelope=await sealDevice(pkg,p.device.deviceId,p.device.encryptionKey)
  await savePairingPending(p)
  const payload={accountId:p.accountId,deviceId:p.device.deviceId,deviceSpki:p.device.deviceSpki,pairingId:p.id,purpose:'pair-enroll',revision:String(pkg.revision)}
  await prove('pair-enroll',payload,await importSigner(pkg.accountPkcs8),p.device.deviceKey)
  await saveDevice(p.device)
  await dropPairingPending(p.id)
  assertEpoch(epoch)
  await activated(p.device,pkg)
}
export async function revokeDevice(id:string):Promise<void>{
  const current=state.value
  if(!current||current.offline)throw new Error('identity.requires_online')
  await call('/devices/'+id,'DELETE')
  if(id===current.deviceId){dispose();identityChannel?.postMessage({event:'identity-session-changed'})}
}
export async function sessionStatus():Promise<{accountId:string;deviceId:string;revision:number}>{
  return call('/session')
}
export async function hasPendingRotation():Promise<boolean>{
  const current=state.value
  return Boolean(current&&await getRotationPending(current.accountId))
}
/** Asynchronous, never in Vue route guards; shell always opens immediately. */
export async function backgroundSessionCheck():Promise<void>{
  const epoch=currentGeneration()
  try{
    const server=await sessionStatus()
    if(epoch!==currentGeneration())return
    const devices=await listDevices()
    const found=devices.find(d=>d.accountId===server.accountId&&d.deviceId===server.deviceId)
    if(found&&!await isSignedOut(found.accountId,found.deviceId)){
      const pkg=await openDevice(found.envelope,found.encryptionKey,found.accountId,found.deviceId)
      if(epoch===currentGeneration()) await activated(found,pkg)
    }
  }catch{ /* No blocking UI or fake authentication */ }
}

/** Narrow PB2 crypto capability for the encrypted-photo module. Never exposes AKEK/package. */
export function acquireStorageKeys() {
  const active=state.value, epoch=currentGeneration()
  if(!active)throw new Error('storage.account_locked')
  const scope={accountId:active.accountId,deviceId:active.deviceId,generation:epoch}
  const check=()=>{assertEpoch(epoch);if(state.value!==active)throw new Error('storage.account_changed')}
  const create=async (assetId:string,expiresAt:string)=>{
    check()
    const wrapped=await wrapAssetDEK(active.pkg,assetId,expiresAt)
    check()
    const key=await unwrapAssetDEK(active.pkg,assetId,expiresAt,wrapped)
    check()
    return {key,wrapped}
  }
  const open=async(assetId:string,expiresAt:string,wrapped:{iv:string;ciphertext:string})=>{
    check()
    const key=await unwrapAssetDEK(active.pkg,assetId,expiresAt,wrapped)
    check()
    return key
  }
  return {scope,check,create,open}
}
/** An authenticated HTTPS server clock sample, never a caller-supplied wall time. */
export async function fetchAuthenticatedServerTime():Promise<number>{
  const active=state.value,epoch=currentGeneration()
  if(!active || active.offline)throw new Error('time.not_authenticated')
  const result=await call<{serverUtc:string}>('/time')
  assertEpoch(epoch)
  if(state.value!==active || typeof result.serverUtc!=='string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(result.serverUtc))
    throw new Error('time.invalid_server_sample')
  const ms=Date.parse(result.serverUtc)
  if(!Number.isSafeInteger(ms)||ms<=0)throw new Error('time.invalid_server_sample')
  return ms
}

export async function ensureBrowserSupport():Promise<void>{await openIdentityDB();await probeCapabilities()}
identityChannel?.addEventListener('message',event=>{if(event.data?.event==='identity-session-changed')dispose()})
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>dispose())
