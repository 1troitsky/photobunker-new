import {shallowRef} from 'vue'

/**
 * PB2 device-local App PIN access gate.
 * Important: browser storage is not hardware-backed and a 6-digit PIN is not
 * a substitute for the Recovery Key. This gate denies app-issued grants;
 * it does not claim OS-level protection against device compromise.
 */
type RecordV1=Readonly<{scope:string;version:1;salt:number[];hash:number[];failures:number;until:number;lastWall:number}>
export type AppLockStatus=Readonly<{scope:string|null;configured:boolean;locked:boolean;ready:boolean}>
const state=shallowRef<AppLockStatus>({scope:null,configured:false,locked:true,ready:false})
export const appLockState=state
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('pb2-app-lock-v1')
const NAME='pb2-app-lock-v1',ITERATIONS=310000
let epoch=0
let revoke:()=>void=()=>{}
export function onAppLockInvalidate(fn:()=>void):void{revoke=fn}
function scopeKey(accountId:string,deviceId:string){return accountId+':'+deviceId}
function db():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined')return reject(Error('pin.storage_unavailable'))
    const request=indexedDB.open(NAME,1)
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('pins'))
      request.result.createObjectStore('pins',{keyPath:'scope'})}
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??Error('pin.storage_error'))
    request.onblocked=()=>reject(Error('pin.storage_blocked'))
  })
}
async function read(scope:string):Promise<RecordV1|undefined>{
  const connection=await db()
  try{
    return await new Promise((resolve,reject)=>{
      const tx=connection.transaction('pins','readonly')
      const req=tx.objectStore('pins').get(scope)
      req.onsuccess=()=>resolve(req.result as RecordV1|undefined)
      req.onerror=()=>reject(req.error)
    })
  }finally{connection.close()}
}
async function mutate(scope:string,update:(current:RecordV1|undefined)=>RecordV1):Promise<void>{
  const connection=await db()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=connection.transaction('pins','readwrite')
      const store=tx.objectStore('pins'),req=store.get(scope)
      req.onsuccess=()=>{
        try{store.put(update(req.result as RecordV1|undefined))}
        catch{tx.abort()}
      }
      req.onerror=()=>tx.abort()
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(tx.error??Error('pin.conflict_or_storage_error'))
      tx.onerror=()=>{ /* onabort reports failure */ }
    })
  }finally{connection.close()}
}
function valid(value:RecordV1|undefined,scope:string):boolean{
  return !!value&&value.version===1&&value.scope===scope&&
    Array.isArray(value.salt)&&value.salt.length===16&&
    value.salt.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&
    Array.isArray(value.hash)&&value.hash.length===32&&
    value.hash.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&
    Number.isSafeInteger(value.failures)&&value.failures>=0&&value.failures<=100&&
    Number.isSafeInteger(value.until)&&value.until>=0&&
    Number.isSafeInteger(value.lastWall)&&value.lastWall>=0
}
function keyReady(scope:string,token:number){
  if(token!==epoch||state.value.scope!==scope)throw Error('pin.account_changed')
}
async function hash(pin:string,salt:readonly number[]):Promise<number[]>{
  const input=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits'])
  const result=await crypto.subtle.deriveBits({
    name:'PBKDF2',salt:new Uint8Array(salt),iterations:ITERATIONS,hash:'SHA-256',
  },input,256)
  return [...new Uint8Array(result)]
}
function same(a:readonly number[],b:readonly number[]):boolean{
  if(a.length!==b.length)return false
  let mismatch=0
  for(let i=0;i<a.length;i++)mismatch|=a[i]!^b[i]!
  return mismatch===0
}
function sameRecord(a:RecordV1,b:RecordV1):boolean{
  return a.scope===b.scope&&same(a.salt,b.salt)&&same(a.hash,b.hash)
}
function broadcast(scope:string){channel?.postMessage({scope,event:'lock'})}
export function appLockAllowed():boolean{
  return state.value.ready&&!state.value.locked
}
/** Always call before making Identity, photo, collaboration or assignment grants. */
export function assertAppUnlocked():void{
  if(!appLockAllowed())throw Error('pin.locked')
}
export function resetAppLock():void{
  epoch++
  state.value={scope:null,configured:false,locked:true,ready:false}
}
export async function prepareAppLock(accountId:string,deviceId:string):Promise<void>{
  const scope=scopeKey(accountId,deviceId),token=++epoch
  state.value={scope,configured:false,locked:true,ready:false}
  try{
    const record=await read(scope)
    keyReady(scope,token)
    if(record&&!valid(record,scope))throw Error('pin.corrupt')
    state.value={scope,configured:!!record,locked:!!record,ready:true}
  }catch{
    if(token===epoch&&state.value.scope===scope)
      state.value={scope,configured:true,locked:true,ready:false}
    throw Error('pin.unavailable')
  }
}
export async function configureAppPin(pin:string):Promise<void>{
  if(!/^[0-9]{6,8}$/.test(pin))throw Error('pin.length')
  assertAppUnlocked()
  const scope=state.value.scope,token=epoch
  if(!scope||state.value.configured)throw Error('pin.already_configured')
  const salt=[...crypto.getRandomValues(new Uint8Array(16))]
  const verifier=await hash(pin,salt)
  keyReady(scope,token);assertAppUnlocked()
  await mutate(scope,previous=>{
    if(previous)throw Error('pin.already_configured')
    return {scope,version:1,salt,hash:verifier,failures:0,until:0,lastWall:Date.now()}
  })
  keyReady(scope,token)
  state.value={scope,configured:true,locked:false,ready:true}
  channel?.postMessage({scope,event:'configured'})
  if(typeof document!=='undefined'&&document.hidden)lockApp()
}
export function lockApp():void{
  const old=state.value
  if(!old.scope||!old.configured||old.locked)return
  epoch++
  state.value={...old,locked:true}
  revoke()
  broadcast(old.scope)
}
export async function unlockAppPin(pin:string):Promise<void>{
  const snapshot=state.value,scope=snapshot.scope,token=epoch
  if(!scope||!snapshot.ready||!snapshot.configured||!snapshot.locked)throw Error('pin.unavailable')
  if(!/^[0-9]{6,8}$/.test(pin))throw Error('pin.invalid')
  const record=await read(scope)
  keyReady(scope,token)
  if(!valid(record,scope))throw Error('pin.unavailable')
  const now=Date.now()
  if(now<record.lastWall)throw Error('pin.clock_rollback')
  if(now<record.until)throw Error('pin.cooldown')
  const digest=await hash(pin,record.salt)
  keyReady(scope,token)
  let verified=false
  await mutate(scope,previous=>{
    if(!valid(previous,scope)||!sameRecord(previous,record))throw Error('pin.changed')
    const current=Date.now()
    if(current<previous.lastWall)throw Error('pin.clock_rollback')
    if(current<previous.until)throw Error('pin.cooldown')
    verified=same(digest,previous.hash)
    const failures=verified?0:Math.min(100,previous.failures+1)
    const delay=failures<3?0:Math.min(60000,2000*2**Math.min(failures-3,5))
    return {...previous,failures,until:verified?0:current+delay,lastWall:current}
  })
  keyReady(scope,token)
  if(!verified)throw Error('pin.invalid')
  if(typeof document!=='undefined'&&document.hidden)throw Error('pin.background_locked')
  state.value={scope,configured:true,locked:false,ready:true}
  channel?.postMessage({scope,event:'unlocked'})
}
channel?.addEventListener('message',event=>{
  const value=event.data as {scope?:unknown;event?:unknown}|null
  if(!value||value.scope!==state.value.scope)return
  if(value.event==='lock'||value.event==='configured'){
    epoch++
    state.value={...state.value,configured:true,locked:true}
    revoke()
  }
  // Unlock never automatically unlocks another tab.
})

/** Mobile PWA backgrounding invalidates active PIN-gated grants. */
if(typeof document!=='undefined'){
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&state.value.configured&&!state.value.locked)lockApp()
  })
}

/** Post-server-ACK cleanup of *only* the revoked device's App PIN verifier.
 * Does not touch account/device keys, recovery envelope or photo ciphertext.
 * Idempotent: an absent record counts as already cleaned.
 */
export async function removeRevokedDeviceAppPin(accountId:string,deviceId:string):Promise<void>{
  const scope=scopeKey(accountId,deviceId)
  if(state.value.scope===scope&&!state.value.locked)
    throw Error('pin.active_device_cleanup_forbidden')
  const connection=await db()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=connection.transaction('pins','readwrite')
      tx.objectStore('pins').delete(scope)
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(tx.error??Error('pin.cleanup_failed'))
      tx.onerror=()=>{/* onabort reports failure */}
    })
  }finally{connection.close()}
}
