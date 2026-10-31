import { ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { account, deviceId, hasConfirmedIdentity, sessionState, offlineCaptureIdentity } from '../identity/store'
import { identityRequest, IdentityError } from '../identity/api'
import { appLocked } from '../app/lock'

export type PresenceVisibility = 'all'|'contacts'|'nobody'
export type PresenceState = 'online'|'recent'|'longAgo'|'hidden'|'unknown'
type ServerPrivacy = {visibility:PresenceVisibility;revision:number}
type Pending = {visibility:PresenceVisibility;expectedRevision:number;operationId:string}
type Queued = {visibility:PresenceVisibility;operationId:string}
type LocalRecord = {privacy:ServerPrivacy;pending?:Pending;queued?:Queued}
type Cipher = {scope:string;key:CryptoKey;iv:Uint8Array<ArrayBuffer>;data:ArrayBuffer}

export const visibility = ref<PresenceVisibility>('contacts')
export const privacyPending = ref(false)
export const privacyError = ref<'save'|'conflict'|'offline'|''>('')
const DATABASE='photobunker-private-presence-v1'
const textEncoder=new TextEncoder()
let activeScope='', changeGeneration=0, retryDelay=2000
let retryTimer:ReturnType<typeof setTimeout>|undefined
const flushing=new Map<string,Promise<void>>()
const initializing=new Map<string,Promise<void>>()
function scope() {
  if(!account.value?.id||!deviceId.value) throw new Error('presence.no_identity')
  return account.value.id+':'+deviceId.value
}
function check(s:string){if(s!==activeScope||s!==scope())throw new Error('presence.account_changed')}
async function store(mode:IDBTransactionMode,action:(object:IDBObjectStore)=>IDBRequest) {
  if(!indexedDB||!crypto.subtle) throw new Error('presence.no_storage')
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const r=indexedDB.open(DATABASE,1)
    r.onupgradeneeded=()=>r.result.createObjectStore('records')
    r.onerror=()=>reject(new Error('presence.no_storage'))
    r.onblocked=()=>reject(new Error('presence.storage_blocked'))
    r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)}
  })
  return new Promise<unknown>((resolve,reject)=>{
    const tx=db.transaction('records',mode,{durability:'strict'})
    const r=action(tx.objectStore('records'))
    tx.oncomplete=()=>{db.close();resolve(r.result)}
    tx.onabort=()=>{db.close();reject(new Error('presence.no_storage'))}
  })
}
async function read(s:string):Promise<LocalRecord|undefined>{
  const record=await store('readonly',o=>o.get(s)) as Cipher|undefined
  check(s)
  if(!record)return undefined
  if(record.scope!==s||record.key.extractable)throw new Error('presence.invalid_storage')
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',
    iv:record.iv,additionalData:textEncoder.encode(s)},record.key,record.data)
  check(s)
  const value=JSON.parse(new TextDecoder().decode(clear)) as LocalRecord
  if(!['all','contacts','nobody'].includes(value.privacy?.visibility)||
    !Number.isSafeInteger(value.privacy?.revision)) throw new Error('presence.invalid_storage')
  return value
}
async function write(s:string,value:LocalRecord){
  check(s)
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const clear=textEncoder.encode(JSON.stringify(value))
  try {
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,
      additionalData:textEncoder.encode(s)},key,clear)
    check(s)
    await store('readwrite',o=>o.put({scope:s,key,iv,data} satisfies Cipher,s))
    check(s)
  }finally{clear.fill(0)}
}
async function exclusive<T>(s:string,fn:()=>Promise<T>):Promise<T>{
  if(!navigator.locks?.request)throw new Error('presence.lock_unavailable')
  return navigator.locks.request('presence-preference:'+s,fn)
}
function canChangeLocally(){
  return !!account.value?.id && !!deviceId.value && !appLocked.value &&
    (hasConfirmedIdentity() ||
      (sessionState.value==='offline' && offlineCaptureIdentity.value))
}
function canSync() {
  return hasConfirmedIdentity()&&!appLocked.value&&navigator.onLine&&
    document.visibilityState==='visible'
}
function timer(){
  if(retryTimer)clearTimeout(retryTimer)
  if(!activeScope||!canSync())return
  retryTimer=setTimeout(()=>{void flushPresencePreference()},retryDelay)
  retryDelay=Math.min(retryDelay*2,60000)
}
export async function initializePresencePreference(){
  if(!account.value?.id||!deviceId.value)return
  const s=scope(),epoch=++changeGeneration
  activeScope=s
  privacyError.value=''
  visibility.value='contacts';privacyPending.value=false
  let shouldFlush=false
  const job=(async()=>{
    try{
      const local=await read(s)
      if(epoch!==changeGeneration)return
      if(local){
        visibility.value=local.queued?.visibility??local.pending?.visibility??local.privacy.visibility
        privacyPending.value=!!local.pending
      }
      if(canSync()){
        // If pending, resolve the exact durable operation, never overwrite it
        // with an unrelated network response.
        if(local?.pending)shouldFlush=true
        else {
          // This baseline request may overlap a new local selection. The
          // selection is committed immediately, but its send waits for this
          // job so it can use the fresh server revision instead of producing
          // a false conflict.
          const remote=await identityRequest<ServerPrivacy>('/presence/privacy')
          if(epoch!==changeGeneration)return
          await exclusive(s,async()=>{
            const latest=await read(s)
            if(latest?.pending){
              if(latest.pending.expectedRevision===latest.privacy.revision &&
                remote.revision>=latest.privacy.revision){
                await write(s,{...latest,privacy:remote,pending:{
                  ...latest.pending,
                  expectedRevision:remote.revision,
                }})
              }
              shouldFlush=true
              return
            }
            await write(s,{privacy:remote})
            if(epoch===changeGeneration){visibility.value=remote.visibility;privacyPending.value=false}
          })
        }
      }
    }catch {
      if(epoch===changeGeneration)privacyError.value='offline'
    }
  })()
  initializing.set(s,job)
  try{await job}
  finally{
    if(initializing.get(s)===job)initializing.delete(s)
  }
  if(shouldFlush&&epoch===changeGeneration)void flushPresencePreference()
}
export async function setPresenceVisibility(value:PresenceVisibility):Promise<void>{
  if(!['all','contacts','nobody'].includes(value)||!canChangeLocally())
    throw new Error('presence.locked')
  const s=scope(),epoch=changeGeneration
  await exclusive(s,async()=>{
    const previous=await read(s)??{privacy:{visibility:'contacts' as const,revision:0}}
    // A previous request may have reached the server while its ACK was lost.
    // Preserve that exact operation and durably queue the latest user choice;
    // changing the payload of an already-sent idempotency key is forbidden.
    const next:LocalRecord=previous.pending ? {
      ...previous,
      queued:value===previous.pending.visibility ? undefined : {
        visibility:value,
        operationId:previous.queued?.operationId??crypto.randomUUID(),
      },
    } : {privacy:previous.privacy,pending:{
      visibility:value,expectedRevision:previous.privacy.revision,
      operationId:crypto.randomUUID(),
    }}
    await write(s,next)
    if(epoch!==changeGeneration)return
    visibility.value=value;privacyPending.value=true;privacyError.value=''
  })
  // Visibility is updated optimistically only AFTER durable local commit.
  void flushPresencePreference()
}
export async function flushPresencePreference():Promise<void>{
  if(!activeScope||!canSync())return
  const s=activeScope,epoch=changeGeneration
  // Never send against a stale revision while the initial server baseline is
  // still loading. The user's choice is already visible and durable locally.
  const baseline=initializing.get(s)
  if(baseline)await baseline
  if(s!==activeScope||epoch!==changeGeneration||!canSync())return
  if(flushing.has(s))return flushing.get(s)
  const job=exclusive(s,async()=>{
    while(true){
      const local=await read(s)
      if(!local?.pending)return
      const op=local.pending
      try{
        const saved=await identityRequest<ServerPrivacy>('/presence/privacy','PUT',op)
        check(s)
        if(local.queued){
          await write(s,{privacy:saved,pending:{
            visibility:local.queued.visibility,
            expectedRevision:saved.revision,
            operationId:local.queued.operationId,
          }})
          if(epoch===changeGeneration){
            visibility.value=local.queued.visibility;privacyPending.value=true;privacyError.value=''
          }
          continue
        }
        await write(s,{privacy:saved})
        if(epoch===changeGeneration){
          visibility.value=saved.visibility;privacyPending.value=false;privacyError.value=''
        }
        retryDelay=2000
        return
      }catch(err){
        if(err instanceof IdentityError&&err.status===409){
          // Another device won the CAS: soft rollback to the current server
          // choice. Never silently overwrite its newer privacy decision.
          const remote=await identityRequest<ServerPrivacy>('/presence/privacy')
          check(s)
          await write(s,{privacy:remote})
          if(epoch===changeGeneration){
            visibility.value=remote.visibility;privacyPending.value=false;privacyError.value='conflict'
          }
        }else{
          if(epoch===changeGeneration)privacyError.value='offline'
          timer()
        }
        return
      }
    }
  })
  const tracked=job.catch(()=>{
    if(epoch===changeGeneration)privacyError.value='offline'
  }).finally(()=>{flushing.delete(s)})
  flushing.set(s,tracked)
  return tracked
}
export function stopPresencePreference(){
  changeGeneration++;activeScope='';visibility.value='contacts'
  privacyPending.value=false;privacyError.value=''
  if(retryTimer)clearTimeout(retryTimer)
}
export async function assertPresenceQueueEmptyForDelete(owner: string, device: string): Promise<void> {
  const s = owner + ':' + device
  if (s !== scope() || s !== activeScope || privacyPending.value || flushing.size)
    throw new Error('localDelete.unsynced')
  const record = await read(s)
  if (record?.pending || record?.queued) throw new Error('localDelete.unsynced')
  check(s)
}
export async function erasePresencePreferences(owner:string,device?:string){
  const scopes=await new Promise<string[]>((resolve,reject)=>{
    const r=indexedDB.open(DATABASE,1)
    r.onupgradeneeded=()=>r.result.createObjectStore('records')
    r.onerror=()=>reject(new Error('presence.no_storage'))
    r.onsuccess=()=>{
      const db=r.result,tx=db.transaction('records','readonly'),keys=tx.objectStore('records').getAllKeys()
      tx.oncomplete=()=>{db.close();resolve((keys.result as string[]).filter(k=>k.startsWith(owner+':')&&(!device||k===owner+':'+device)))}
      tx.onabort=()=>{db.close();reject(new Error('presence.no_storage'))}
    }
  })
  for(const s of scopes)await store('readwrite',o=>o.delete(s))
}
let instance='',sequence=0,pulseTimer:ReturnType<typeof setInterval>|undefined
let lastScope=''
function pulseGate(){
  return canSync()&&!!deviceId.value&&!!account.value
}
function endLease(){
  if(!instance)return
  const oldInstance=instance,owner=lastScope
  instance='';sequence++
  if(navigator.onLine&&hasConfirmedIdentity()&&owner===scope()){
    // send independently of the app request pool: pagehide may already have
    // invalidated it. keepalive is best-effort; server TTL is authoritative.
    void fetch('/api/v1/identity/presence/pulse',{
      method:'POST',credentials:'same-origin',keepalive:true,cache:'no-store',
      headers:{'Content-Type':'application/json','X-PhotoBunker':'identity-v1',
        'X-PhotoBunker-Account':account.value!.id},
      body:JSON.stringify({instanceId:oldInstance,sequence,active:false}),
    }).catch(()=>{})
  }
}
export function refreshPresenceHeartbeat(){
  if(!pulseGate()){
    endLease()
    if(pulseTimer){clearInterval(pulseTimer);pulseTimer=undefined}
    return
  }
  const s=scope()
  if(lastScope!==s){
    endLease()
    if(pulseTimer){clearInterval(pulseTimer);pulseTimer=undefined}
    lastScope=s
  }
  if(!instance){instance=crypto.randomUUID();sequence=0}
  async function send(){
    if(!pulseGate()||lastScope!==s||!instance)return
    const id=instance,n=++sequence
    try{await identityRequest('/presence/pulse','POST',{instanceId:id,sequence:n,active:true})}
    catch{/* Never infer online from a failed or unconfirmed heartbeat. */}
  }
  void send()
  if(!pulseTimer)pulseTimer=setInterval(()=>{void send()},25000)
  void flushPresencePreference()
}
export function stopPresenceHeartbeat(){
  endLease()
  if(pulseTimer){clearInterval(pulseTimer);pulseTimer=undefined}
  lastScope=''
}
export function usePeerPresence(handle:Ref<string>){
  const state=ref<PresenceState>('unknown')
  let generation=0
  async function refresh(){
    const value=handle.value,owner=account.value?.id,epoch=++generation
    if(!value||!hasConfirmedIdentity()||appLocked.value||!navigator.onLine){
      state.value='unknown';return
    }
    try{
      const response=await identityRequest<{state:PresenceState}>(
        '/presence/'+encodeURIComponent(value))
      if(epoch===generation&&owner===account.value?.id&&value===handle.value)
        state.value=response.state
    }catch{
      if(epoch===generation)state.value='unknown'
    }
  }
  watch([handle,()=>account.value?.id,appLocked],()=>{
    state.value='unknown';void refresh()
  },{immediate:true})
  function disconnected(){ generation++;state.value='unknown' }
  function visibilityChanged(){
    if(document.hidden) disconnected()
    else void refresh()
  }
  function connected(){void refresh()}
  window.addEventListener('offline',disconnected)
  window.addEventListener('online',connected)
  document.addEventListener('visibilitychange',visibilityChanged)
  const interval=setInterval(()=>{
    if(document.visibilityState==='visible')void refresh()
  },20000)
  onBeforeUnmount(()=>{
    generation++;clearInterval(interval)
    window.removeEventListener('offline',disconnected)
    window.removeEventListener('online',connected)
    document.removeEventListener('visibilitychange',visibilityChanged)
  })
  return state
}
