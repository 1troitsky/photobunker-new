import { newDeviceEncryptionKey, newSigning, random, sign, b64 } from './crypto'
import type { DeviceEnvelope } from './crypto'

export type LocalDevice = {
  accountId: string
  deviceId: string
  deviceKey: CryptoKey
  deviceSpki: string
  encryptionKey: CryptoKey
  envelope: DeviceEnvelope
}
export type Pending = {
  operationId: string
  reservationProof: string
  kitLocator: string
  accountId?: string
  deviceId: string
  deviceKey: CryptoKey
  deviceSpki: string
  encryptionKey: CryptoKey
  envelope?: DeviceEnvelope
}
const NAME = 'photobunker-identity-v2'
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('identity.storage_error'))
  })
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve,reject) => {
    tx.oncomplete=()=>resolve()
    tx.onerror=()=>reject(tx.error ?? new Error('identity.storage_error'))
    tx.onabort=()=>reject(tx.error ?? new Error('identity.storage_aborted'))
  })
}
export async function openIdentityDB():Promise<IDBDatabase>{
  if (typeof indexedDB === 'undefined' || !crypto.subtle) throw new Error('identity.storage_unsupported')
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(NAME,1)
    req.onupgradeneeded=()=>{
      const h=req.result
      if (!h.objectStoreNames.contains('devices')) h.createObjectStore('devices',{keyPath:'deviceId'})
      if (!h.objectStoreNames.contains('pending')) h.createObjectStore('pending',{keyPath:'operationId'})
      if (!h.objectStoreNames.contains('probe')) h.createObjectStore('probe')
    }
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(req.error ?? new Error('identity.storage_denied'))
    req.onblocked=()=>reject(new Error('identity.storage_blocked'))
  })
}
async function transact<T>(store:'devices'|'pending'|'probe',mode:IDBTransactionMode,fn:(os:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const handle=await openIdentityDB()
  try {
    const tx=handle.transaction(store,mode)
    const done=completed(tx)
    const result=request(fn(tx.objectStore(store)))
    const value=await result
    await done
    return value
  } finally { handle.close() }
}
export async function probeCapabilities():Promise<void>{
  // Must be checked before any network POST /prepare. No marker in localStorage.
  const pair=await newSigning(false)
  const wrapping=await newDeviceEncryptionKey()
  const id=b64(random(12))
  try {
    await transact('probe','readwrite',os=>os.put({id,signer:pair.privateKey,wrapping},id))
    const saved=await transact<{id:string;signer:CryptoKey;wrapping:CryptoKey}>('probe','readonly',os=>os.get(id))
    if (!saved || saved.signer.extractable || saved.wrapping.extractable) throw new Error('identity.nonextractable_probe_failed')
    const proof=await sign(saved.signer,'photobunker.identity.storage.v2')
    if (proof.length!==86) throw new Error('identity.key_probe_failed')
    const iv=random(12),plaintext=random(32)
    const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv},saved.wrapping,plaintext)
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},saved.wrapping,sealed)
    if (b64(clear)!==b64(plaintext)) throw new Error('identity.storage_crypto_probe_failed')
  } finally { await transact('probe','readwrite',os=>os.delete(id)).catch(()=>{}) }
}
export async function putPending(value:Pending):Promise<void>{
  await transact('pending','readwrite',os=>os.put(value))
}
export async function getPending():Promise<Pending|undefined>{
  const handle=await openIdentityDB()
  try{
    const tx=handle.transaction('pending','readonly')
    const done=completed(tx)
    const rows=await request(tx.objectStore('pending').getAll()) as Pending[]
    await done
    return rows[0]
  } finally {handle.close()}
}
export async function dropPending(operationId:string):Promise<void>{
  await transact('pending','readwrite',os=>os.delete(operationId))
}
export async function saveDevice(value:LocalDevice):Promise<void>{
  await transact('devices','readwrite',os=>os.put(value))
}
export async function getDevice(accountId:string,deviceId:string):Promise<LocalDevice|undefined>{
  const value=await transact<LocalDevice|undefined>('devices','readonly',os=>os.get(deviceId))
  if(value?.accountId!==accountId)return undefined
  return value
}
export async function listDevices():Promise<LocalDevice[]>{
  const handle=await openIdentityDB()
  try {
    const tx=handle.transaction('devices','readonly')
    const done=completed(tx)
    const rows=await request(tx.objectStore('devices').getAll()) as LocalDevice[]
    await done
    return rows
  } finally {handle.close()}
}
export async function newLocalDevice(accountId:string):Promise<LocalDevice>{
  const pair=await newSigning(false)
  const deviceId=crypto.randomUUID()
  const deviceSpki=b64(await crypto.subtle.exportKey('spki',pair.publicKey))
  return {accountId,deviceId,deviceKey:pair.privateKey,deviceSpki,
    encryptionKey:await newDeviceEncryptionKey(),envelope:undefined as unknown as DeviceEnvelope}
}
