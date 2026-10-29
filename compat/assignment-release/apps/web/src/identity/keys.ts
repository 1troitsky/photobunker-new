import { identityRequest } from './api'
export type DeviceCredential = {id:string; publicId:string; publicKey:string; privateKey:CryptoKey; name:string}
export const b64 = (bytes:ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
export function unb64(value:string):Uint8Array<ArrayBuffer> { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('identity.invalid_key'); return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4)), char=>char.charCodeAt(0)) }
const algorithm = {name:'ECDSA', namedCurve:'P-256'}
async function database() {
  // Identity credentials are encrypted/non-extractable browser state and are
  // required in production. Only the legacy plaintext photo prototype is
  // guarded by VITE_LOCAL_PROTOTYPE.
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw new Error('identity.storage_unavailable')
  return new Promise<IDBDatabase>((resolve,reject)=>{ const request=indexedDB.open('photobunker-identity-devices-v1',2); request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('devices'))request.result.createObjectStore('devices',{keyPath:'id'});if(!request.result.objectStoreNames.contains('pending'))request.result.createObjectStore('pending')}; request.onerror=()=>reject(request.error); request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)}; request.onblocked=()=>reject(new Error('identity.storage_blocked')) })
}
export async function saveCredential(value:DeviceCredential) {
  const db=await database()
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('devices','readwrite');tx.objectStore('devices').put(value);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)}})
}
export async function credentials():Promise<DeviceCredential[]> {
  const db=await database()
  return new Promise((resolve,reject)=>{const tx=db.transaction('devices');const request=tx.objectStore('devices').getAll();tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onabort=()=>{db.close();reject(tx.error)}})
}
// The label is informational and never required from the user.
export function automaticDeviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android device'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows device'
  if (/Linux/i.test(ua)) return 'Linux device'
  return 'PhotoBunker device'
}

export async function newDevice(name:string):Promise<DeviceCredential> {const pair=await crypto.subtle.generateKey(algorithm,false,['sign','verify']);return {id:crypto.randomUUID(), publicId:'', name:name.trim(), privateKey:pair.privateKey,publicKey:b64(await crypto.subtle.exportKey('spki',pair.publicKey))}}
export async function createRoot() {const pair=await crypto.subtle.generateKey(algorithm,true,['sign','verify']);const publicKey=b64(await crypto.subtle.exportKey('spki',pair.publicKey)), privateValue=b64(await crypto.subtle.exportKey('pkcs8',pair.privateKey));return {privateKey:pair.privateKey, publicKey, kit:`PB1.${publicKey}.${privateValue}`}}
export async function parseKit(value:string) {
  const parts = value.trim().split('.')
  if (parts.length !== 3 || parts[0] !== 'PB1' || value.length > 1000) throw new Error('identity.invalid_kit')
  try {
    unb64(parts[1]!)
    return { publicKey: parts[1]!, privateKey: await crypto.subtle.importKey('pkcs8', unb64(parts[2]!), algorithm, false, ['sign']) }
  } catch (failure) {
    if (failure instanceof DOMException && ['DataError', 'OperationError', 'InvalidCharacterError'].includes(failure.name))
      throw new Error('identity.invalid_kit')
    throw failure
  }
}
export async function prove<T>(payload:Record<string,string>, key:CryptoKey):Promise<T> {
  const challenge=await identityRequest<{id:string;nonce:string;message:string;expiresAt:number}>('/challenges','POST',payload)
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a],[b])=>a.localeCompare(b,'en'))))
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
  const expected=`photobunker.identity.v1\n${payload.purpose}\n${challenge.id}\n${challenge.nonce}\n${digest}`
  if(challenge.message!==expected || challenge.expiresAt<=Date.now())throw new Error('identity.challenge_mismatch')
  const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(expected)))
  return identityRequest<T>('/sessions','POST',{challengeId:challenge.id,signature})
}


/**
 * Persist the non-extractable device signing key before sending a proof.
 * A single IDB transaction reserves the same device for all retries of this
 * root key, including a lost HTTP response, a reload, or another tab.
 * No account recovery private key or plaintext recovery kit is stored here.
 */
export async function onboardingDevice(rootKey: string, name: string): Promise<DeviceCredential> {
  const candidate = await newDevice(name)
  const db = await database()
  return new Promise<DeviceCredential>((resolve, reject) => {
    const tx = db.transaction(['devices', 'pending'], 'readwrite')
    const pending = tx.objectStore('pending')
    const request = pending.get(rootKey)
    let selected = candidate
    request.onsuccess = () => {
      const saved = request.result as DeviceCredential | undefined
      if (saved) selected = saved
      else {
        pending.put(candidate, rootKey)
        tx.objectStore('devices').put(candidate)
      }
    }
    tx.oncomplete = () => { db.close(); resolve(selected) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('identity.storage_unavailable')) }
  })
}

/** Mark a server-confirmed device without changing its private key. */
export async function completeOnboardingDevice(rootKey: string, device: DeviceCredential, publicId: string) {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['devices', 'pending'], 'readwrite')
    const pending = tx.objectStore('pending')
    const request = pending.get(rootKey)
    request.onsuccess = () => {
      const saved = request.result as DeviceCredential | undefined
      if (saved && saved.id !== device.id) { tx.abort(); return }
      tx.objectStore('devices').put({ ...device, publicId })
      // Keep the root-public-key reservation after Identity succeeds. A later
      // key-storage failure/reload without a cookie must reuse this device too.
      pending.put({ ...device, publicId }, rootKey)
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('identity.storage_unavailable')) }
  })
}

/** Reconcile a lost /sessions response using the confirmed /me cookie. */
export async function reconcileOnboardingDevice(device: string, publicId: string) {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['devices', 'pending'], 'readwrite')
    const pending = tx.objectStore('pending')
    const cursor = pending.openCursor()
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return
      const saved = row.value as DeviceCredential
      if (saved.id === device) {
        tx.objectStore('devices').put({ ...saved, publicId })
        row.update({ ...saved, publicId })
      } else row.continue()
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('identity.storage_unavailable')) }
  })
}

export async function forgetCredentials() {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['devices', 'pending'], 'readwrite')
    tx.objectStore('devices').clear()
    tx.objectStore('pending').clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}
