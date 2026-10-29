import type { DeleteScope } from './local-delete-preflight'

/** D5B destruction adapter is intentionally detached from reactive Identity:
 * after crash/reload an account MUST NOT be restored to run the cleanup.
 * Every operation is scoped by stored immutable account/device UUIDs.
 */
const databases = new Set([
  'photobunker-identity-devices-v1','photobunker-app-pin-v2',
  'photobunker-local-delete-v1','photobunker-local-prototype-v1',
  'photobunker-encrypted-queue-v1','photobunker-ui-workspace-v1',
  'photobunker-message-storage-v1','photobunker-message-outbox-v1',
  'photobunker-private-messenger-folders-v1','photobunker-team-cache-v1',
  'photobunker-private-presence-v1','photobunker-photo-browser-cache-v1',
  'photobunker-photo-names-v1','photobunker-card-share-intents-v1',
  'photobunker-emergency-v1','photobunker-emergency-outbox-v1',
])
type Entry = { key:IDBValidKey; value:unknown }
type Predicate = (store:string,row:Entry)=>boolean
const pair=(s:DeleteScope)=>s.owner+':'+s.device
const fail=()=>{throw new Error('emergency.wipe_storage')}
export function emergencyWipeMatchesScope(db:string,store:string,row:Entry,s:DeleteScope):boolean {
  const key=String(row.key),id=pair(s)
  switch(db) {
    case 'photobunker-app-pin-v2':return key==='app-pin:'+id
    case 'photobunker-local-delete-v1':return store==='pins'&&key==='local-delete:'+id
    case 'photobunker-emergency-v1':return store==='records'&&key===id
    case 'photobunker-identity-devices-v1':
      return store==='devices'&&key===s.device||
        store==='pending'&&!!row.value&&typeof row.value==='object'&&
        (row.value as {id?:string}).id===s.device
    case 'photobunker-message-outbox-v1':
      return key==='key:'+id||key.startsWith('msg:'+id+':')
    case 'photobunker-private-messenger-folders-v1':
      return key==='key:'+id||key==='data:'+id
    case 'photobunker-team-cache-v1':return key==='team:'+id
    case 'photobunker-private-presence-v1':return key===id
    case 'photobunker-photo-browser-cache-v1':return key.startsWith('browser:'+id+':')
    case 'photobunker-photo-names-v1':return key==='photo-names:'+id
    case 'photobunker-card-share-intents-v1':return key.startsWith(id+':')
    case 'photobunker-message-storage-v1':return key===id||key.startsWith(id+':')
    case 'photobunker-ui-workspace-v1':return key.startsWith('account:'+s.owner+':')
    case 'photobunker-encrypted-queue-v1':
      return key==='capture-current'
        ? (row.value as {accountId?:string;deviceId?:string}|undefined)?.accountId===s.owner &&
          (row.value as {accountId?:string;deviceId?:string}|undefined)?.deviceId===s.device
        : key.split(':').includes(s.owner)
    default:return false
  }
}
async function names():Promise<string[]> {
  if(!indexedDB.databases)fail()
  return (await indexedDB.databases!()).map(r=>r.name).filter((n):n is string=>!!n)
}
async function dbOpen(name:string) {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const req=indexedDB.open(name)
    req.onerror=()=>reject(new Error('emergency.wipe_storage'))
    req.onblocked=()=>reject(new Error('emergency.wipe_storage'))
    req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result)}
  })
}
async function inspect(name:string,fn:Predicate,deleteRows:boolean) {
  const db=await dbOpen(name)
  try{
    for(const storeName of Array.from(db.objectStoreNames)) {
      await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction(storeName,deleteRows?'readwrite':'readonly',
          deleteRows?{durability:'strict'}:undefined)
        const req=tx.objectStore(storeName).openCursor()
        let failure=false
        req.onsuccess=()=>{
          const cursor=req.result
          if(!cursor)return
          try{
            if(fn(storeName,{key:cursor.primaryKey,value:cursor.value})){
              if(deleteRows)cursor.delete()
              else {failure=true;tx.abort();return}
            }
            cursor.continue()
          }catch{failure=true;tx.abort()}
        }
        tx.oncomplete=()=>resolve()
        tx.onabort=()=>reject(new Error(failure?'emergency.wipe_remaining':'emergency.wipe_storage'))
        tx.onerror=()=>reject(new Error('emergency.wipe_storage'))
      })
    }
  }finally{db.close()}
}
async function photos(s:DeleteScope,erase:boolean) {
  const db=await dbOpen('photobunker-local-prototype-v1')
  try{
    if(!['photos','originals','thumbnails'].every(n=>db.objectStoreNames.contains(n)))fail()
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['photos','originals','thumbnails'],
        erase?'readwrite':'readonly',erase?{durability:'strict'}:undefined)
      let failed=false
      const ids=tx.objectStore('photos'), cursor=ids.openCursor()
      cursor.onsuccess=()=>{
        const item=cursor.result
        if(!item)return
        const photo=item.value as {accountId?:string}|undefined
        if(!photo?.accountId){failed=true;tx.abort();return} // ambiguous local-only ownership
        if(photo.accountId===s.owner) {
          if(!erase){failed=true;tx.abort();return}
          ids.delete(item.primaryKey)
          tx.objectStore('originals').delete(item.primaryKey)
          tx.objectStore('thumbnails').delete(item.primaryKey)
        }
        item.continue()
      }
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(new Error(failed?'emergency.wipe_remaining':'emergency.wipe_storage'))
      tx.onerror=()=>reject(new Error('emergency.wipe_storage'))
    })
  }finally{db.close()}
}
async function matrix(s:DeleteScope,all:string[],erase:boolean) {
  const prefix='photobunker-matrix-'+pair(s)+':'
  for(const name of all.filter(n=>n.startsWith(prefix))) {
    if(!erase)fail()
    await new Promise<void>((resolve,reject)=>{
      const req=indexedDB.deleteDatabase(name)
      req.onsuccess=()=>resolve()
      req.onerror=()=>reject(new Error('emergency.wipe_storage'))
      req.onblocked=()=>reject(new Error('emergency.close_tabs'))
    })
  }
}
async function localCaches(s:DeleteScope,erase:boolean) {
  if(!('caches' in window))return
  for(const name of await caches.keys()) {
    if(name.startsWith('photobunker-shell-'))continue // only static public PWA precache
    if(!/private|encrypted|photo|message/i.test(name.replace(/^photobunker-/,'')))continue
    const target=name.includes(pair(s))
    const scoped=/[0-9a-f]{8}-[0-9a-f-]{27,}:[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(name)
    if(!target&&!scoped)fail() // ambiguous shared cache: never delete B
    if(target){if(!erase || !await caches.delete(name))fail()}
  }
}
async function sweep(s:DeleteScope,erase:boolean) {
  const all=await names()
  const matrixName=/^photobunker-matrix-[0-9a-f-]{36}:[0-9a-f-]{36}:/i
  if(all.some(n=>n.startsWith('photobunker-')&&!databases.has(n)&&!matrixName.test(n)))fail()
  for(const name of all) {
    if(name==='photobunker-emergency-outbox-v1')continue // immutable command always survives
    if(name==='photobunker-local-prototype-v1') {
      await photos(s,erase)
    }else if(databases.has(name)) {
      await inspect(name,(store,row)=>emergencyWipeMatchesScope(name,store,row,s),erase)
    }
  }
  await matrix(s,all,erase)
  await localCaches(s,erase)
}
async function guardSiblingDevice(s:DeleteScope) {
  const known=await names()
  if(!known.includes('photobunker-identity-devices-v1'))return
  const db=await dbOpen('photobunker-identity-devices-v1')
  try{
    if(!db.objectStoreNames.contains('devices'))fail()
    const rows=await new Promise<Array<{id:string;publicId:string}>>((resolve,reject)=>{
      const tx=db.transaction('devices','readonly')
      const req=tx.objectStore('devices').getAll()
      tx.oncomplete=()=>resolve(req.result)
      tx.onabort=()=>reject(new Error('emergency.wipe_storage'))
    })
    const target=rows.find(row=>row.id===s.device)
    // Before the first wipe a target with two local device credentials must
    // fail closed: account-wide ciphertext entries cannot be safely partitioned.
    if(target && rows.some(row=>row.id!==s.device&&(!row.publicId||row.publicId===target.publicId)))
      fail()
  }finally{db.close()}
}
export async function purgeEmergencyDevice(s:DeleteScope) {
  if(!/^[a-f0-9-]{36}$/i.test(s.owner)||!/^[a-f0-9-]{36}$/i.test(s.device))fail()
  // Once a durable signature exists, remove the device's encrypted private
  // signing key FIRST. Other stores might be blocked by another tab/crash;
  // they must not leave a reusable emergency signer on this device.
  if((await names()).includes('photobunker-emergency-v1'))
    await inspect('photobunker-emergency-v1',
      (store,row)=>emergencyWipeMatchesScope('photobunker-emergency-v1',store,row,s),true)
  await guardSiblingDevice(s)
  await sweep(s,true)
  for(const key of Object.keys(localStorage)) {
    if(key.includes(s.owner)&&!key.startsWith('pb-emergency-'))
      localStorage.removeItem(key)
  }
  if(localStorage.getItem('pb-active-device')===s.device)
    localStorage.removeItem('pb-active-device')
  await sweep(s,false) // idempotent proof, no success with lingering A records
}
