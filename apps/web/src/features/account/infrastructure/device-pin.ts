import {identity} from '../../identity'
import {appLockState} from '../../identity'

export type DevicePinKind='local-delete'|'emergency'
type PinRow=Readonly<{
  scope:string;kind:DevicePinKind;version:1;salt:number[];digest:number[];
  failures:number;lastWall:number;until:number
}>
const NAME='pb2-destructive-pin-v1',ITERATIONS=350000
function key(account:string,device:string,kind:DevicePinKind){
  return account+':'+device+':'+kind
}
function scope(kind:DevicePinKind){
  const current=identity.value
  if(!current||!appLockState.value.ready||appLockState.value.locked)
    throw Error('pin.identity_locked')
  return key(current.accountId,current.deviceId,kind)
}
async function open():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(NAME,1)
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains('pins'))
        request.result.createObjectStore('pins',{keyPath:'scope'})
    }
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??Error('pin.storage_failed'))
    request.onblocked=()=>reject(Error('pin.storage_blocked'))
  })
}
async function load(id:string):Promise<PinRow|undefined>{
  const handle=await open()
  try{return await new Promise((resolve,reject)=>{
    const request=handle.transaction('pins','readonly').objectStore('pins').get(id)
    request.onsuccess=()=>resolve(request.result as PinRow|undefined)
    request.onerror=()=>reject(request.error)
  })}finally{handle.close()}
}
async function transact(id:string,modify:(value:PinRow|undefined)=>PinRow):Promise<void>{
  const handle=await open()
  try{await new Promise<void>((resolve,reject)=>{
    const tx=handle.transaction('pins','readwrite')
    const request=tx.objectStore('pins').get(id)
    request.onsuccess=()=>{
      try{tx.objectStore('pins').put(modify(request.result as PinRow|undefined))}
      catch{tx.abort()}
    }
    request.onerror=()=>tx.abort()
    tx.oncomplete=()=>resolve()
    tx.onabort=()=>reject(tx.error??Error('pin.conflict'))
  })}finally{handle.close()}
}
function valid(row:PinRow|undefined,id:string):row is PinRow{
  return !!row&&row.version===1&&row.scope===id&&
    (row.kind==='local-delete'||row.kind==='emergency')&&
    row.salt.length===16&&row.digest.length===32&&
    [...row.salt,...row.digest].every(x=>Number.isInteger(x)&&x>=0&&x<256)&&
    Number.isSafeInteger(row.failures)&&row.failures>=0&&row.failures<=100&&
    Number.isSafeInteger(row.until)&&row.until>=0&&
    Number.isSafeInteger(row.lastWall)&&row.lastWall>=0
}
function equal(a:readonly number[],b:readonly number[]):boolean{
  if(a.length!==b.length)return false
  let result=0
  for(let i=0;i<a.length;i++)result|=a[i]!^b[i]!
  return result===0
}
async function derive(pin:string,salt:readonly number[]):Promise<number[]>{
  const input=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits'])
  return [...new Uint8Array(await crypto.subtle.deriveBits({
    name:'PBKDF2',salt:new Uint8Array(salt),iterations:ITERATIONS,hash:'SHA-256',
  },input,256))]
}
/** Independent credential verifier. Verifying this PIN never deletes data. */
export async function devicePinConfigured(kind:DevicePinKind):Promise<boolean>{
  const id=scope(kind)
  const row=await load(id)
  if(id!==scope(kind))throw Error('pin.account_changed')
  if(row&&!valid(row,id))throw Error('pin.corrupt')
  return !!row
}
export async function configureDevicePin(kind:DevicePinKind,pin:string):Promise<void>{
  if(!/^[0-9]{8}$/.test(pin))throw Error('pin.length')
  const id=scope(kind),salt=[...crypto.getRandomValues(new Uint8Array(16))]
  const digest=await derive(pin,salt)
  if(id!==scope(kind))throw Error('pin.account_changed')
  await transact(id,previous=>{
    if(previous)throw Error('pin.already_configured')
    const now=Date.now()
    return{scope:id,kind,version:1,salt,digest,failures:0,lastWall:now,until:0}
  })
}
/** Verified only in memory, never returned as a durable authorization token.
 * A future destructive use case must require *fresh* verification and signed
 * server grant, not trust a boolean persisted in IndexedDB.
 */
export async function verifyDevicePin(kind:DevicePinKind,pin:string):Promise<void>{
  const id=scope(kind)
  if(!/^[0-9]{8}$/.test(pin))throw Error('pin.invalid')
  const previous=await load(id)
  if(!valid(previous,id))throw Error('pin.unavailable')
  const now=Date.now()
  if(now<previous.lastWall)throw Error('pin.clock_rollback')
  if(now<previous.until)throw Error('pin.cooldown')
  const candidate=await derive(pin,previous.salt)
  if(id!==scope(kind))throw Error('pin.account_changed')
  let correct=false
  await transact(id,current=>{
    if(!valid(current,id)||!equal(previous.salt,current.salt)||
      !equal(previous.digest,current.digest))throw Error('pin.changed')
    const clock=Date.now()
    if(clock<current.lastWall)throw Error('pin.clock_rollback')
    if(clock<current.until)throw Error('pin.cooldown')
    correct=equal(candidate,current.digest)
    const failures=correct?0:Math.min(100,current.failures+1)
    const delay=failures<3?0:Math.min(60000,2000*2**Math.min(5,failures-3))
    return{...current,failures,lastWall:clock,until:correct?0:clock+delay}
  })
  if(id!==scope(kind))throw Error('pin.account_changed')
  if(!correct)throw Error('pin.invalid')
}
