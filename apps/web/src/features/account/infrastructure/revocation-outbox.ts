import {forgetRuntime,identity,signOwnRevocationIntent,submitSignedRevocationIntent} from '../../identity'
import {verifyDevicePin,type DevicePinKind} from './device-pin'

export type SignedDeviceRevocation=Readonly<{
  accountId:string;deviceId:string;operationId:string;
  intent:DevicePinKind;signature:string
}>
export type RevocationReceipt=Readonly<{
  accountId:string;deviceId:string;operationId:string;intent:DevicePinKind;
  payloadHash:string;state:'revoked';committedAt:string
}>
export type RevocationRow=Readonly<{
  operationId:string;accountId:string;deviceId:string;
  envelope:SignedDeviceRevocation;state:'pending'|'acknowledged';
  receipt:RevocationReceipt|null;createdAt:number
}>
const DB='pb2-revocation-outbox-v1'
async function database():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1)
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains('intents'))
        request.result.createObjectStore('intents',{keyPath:'operationId'})
    }
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??Error('revoke.storage_unavailable'))
    request.onblocked=()=>reject(Error('revoke.storage_blocked'))
  })
}
async function transaction<T>(mode:IDBTransactionMode,
  work:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(failure:unknown)=>void)=>void):Promise<T>{
  const connection=await database()
  try{return await new Promise<T>((resolve,reject)=>{
    const tx=connection.transaction('intents',mode)
    let output:T|undefined,hasOutput=false
    const success=(value:T)=>{output=value;hasOutput=true}
    work(tx.objectStore('intents'),success,reject)
    tx.oncomplete=()=>{if(hasOutput)resolve(output as T);else reject(Error('revoke.no_result'))}
    tx.onabort=()=>reject(tx.error??Error('revoke.storage_failed'))
    tx.onerror=()=>{/* onabort reports failure */}
  })}finally{connection.close()}
}
export async function pendingDeviceRevocations():Promise<RevocationRow[]>{
  return transaction('readonly',(store,done,reject)=>{
    const request=store.getAll()
    request.onsuccess=()=>done((request.result as RevocationRow[])
      .filter(row=>row.state==='pending'))
    request.onerror=()=>reject(request.error)
  })
}
async function save(row:RevocationRow):Promise<void>{
  await transaction<void>('readwrite',(store,done,reject)=>{
    const request=store.add(row)
    request.onsuccess=()=>done()
    request.onerror=()=>reject(request.error)
  })
}
async function acknowledge(input:RevocationRow,receipt:RevocationReceipt):Promise<void>{
  await transaction<void>('readwrite',(store,done,reject)=>{
    const request=store.get(input.operationId)
    request.onsuccess=()=>{
      const previous=request.result as RevocationRow|undefined
      if(!previous||previous.state!=='pending'||
        previous.envelope.signature!==input.envelope.signature ||
        previous.accountId!==input.accountId||previous.deviceId!==input.deviceId){
        reject(Error('revoke.intent_changed'));return
      }
      const update=store.put({...previous,state:'acknowledged',receipt})
      update.onsuccess=()=>done()
      update.onerror=()=>reject(update.error)
    }
    request.onerror=()=>reject(request.error)
  })
}
async function payloadHash(envelope:SignedDeviceRevocation):Promise<string>{
  const {accountId,deviceId,intent,operationId}=envelope
  const canonical=JSON.stringify({accountId,deviceId,intent,operationId})
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))
  return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')
}
/**
 * Caller must obtain explicit, informed confirmation of possible loss of
 * unsynced-only data. No UI calls this until a distinct device-loss review.
 * Durable journal commits BEFORE any server request is attempted.
 */
export async function stageRevocationIntent(kind:DevicePinKind,pin:string,
  acknowledgedUnsyncedLoss:boolean):Promise<RevocationRow>{
  if(!acknowledgedUnsyncedLoss)throw Error('revoke.explicit_consent_required')
  const current=identity.value
  if(!current)throw Error('revoke.identity_locked')
  await verifyDevicePin(kind,pin)
  if(identity.value?.accountId!==current.accountId||
    identity.value?.deviceId!==current.deviceId)throw Error('revoke.identity_changed')
  const operationId=crypto.randomUUID()
  const envelope=await signOwnRevocationIntent(operationId,kind)
  if(identity.value?.accountId!==current.accountId||
    identity.value?.deviceId!==current.deviceId)throw Error('revoke.identity_changed')
  const existing=await pendingDeviceRevocations()
  if(existing.some(row=>row.accountId===current.accountId&&
    row.deviceId===current.deviceId))throw Error('revoke.already_pending')
  const row:RevocationRow={operationId,accountId:current.accountId,
    deviceId:current.deviceId,envelope,state:'pending',receipt:null,createdAt:Date.now()}
  await save(row)
  // There is deliberately no network call during stage: the caller must first
  // leave protected UI, lock the device, then request delivery.
  return row
}
/** Idempotent replay. No claimed ACK on timeout/offline or corrupt receipt. */
export async function deliverPendingRevocations():Promise<{
  acknowledged:number;pending:number
}>{
  const rows=await pendingDeviceRevocations()
  let acknowledged=0
  for(const row of rows){
    if(!navigator.onLine)break
    try{
      const receipt=await submitSignedRevocationIntent(row.envelope)
      const expected=await payloadHash(row.envelope)
      if(receipt.operationId!==row.operationId||
        receipt.accountId!==row.accountId||receipt.deviceId!==row.deviceId||
        receipt.intent!==row.envelope.intent||receipt.state!=='revoked'||
        receipt.payloadHash!==expected||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.committedAt))
        throw Error('revoke.invalid_ack')
      await acknowledge(row,receipt)
      acknowledged++
      if(identity.value?.accountId===row.accountId&&
        identity.value.deviceId===row.deviceId)forgetRuntime()
    }catch{
      // Stable signed row survives a crash, network outage or lost first ACK.
      // Deliberately do not fabricate a successful remote revocation.
    }
  }
  return {acknowledged,pending:(await pendingDeviceRevocations()).length}
}
