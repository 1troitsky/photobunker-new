import type { SealedEmergencyKey } from './emergency-crypto'
export type EmergencyRegistration = {
  keyId: string
  revision: number
  sealed: SealedEmergencyKey
}
export type EmergencyPending =
  | { action:'register'; operationId:string; keyId:string; expectedRevision:number; sealed:SealedEmergencyKey }
  | { action:'disable'; operationId:string; keyId:string; revision:number }
export type EmergencyRow = {
  attempts?: {failures:number;cooldownUntil:number;lastWall:number}
  version:1
  accountId:string
  deviceId:string
  revision:number
  confirmed?:EmergencyRegistration
  pending?:EmergencyPending
}
const DB='photobunker-emergency-v1',STORE='records'
async function open() {
  if(!globalThis.indexedDB||!globalThis.crypto?.subtle)throw new Error('emergency.storage')
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const r=indexedDB.open(DB,1)
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE)
    r.onerror=()=>reject(new Error('emergency.storage'))
    r.onblocked=()=>reject(new Error('emergency.storage'))
    r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)}
  })
}
const key=(owner:string,device:string)=>owner+':'+device
async function access<T>(owner:string,device:string,mode:IDBTransactionMode,
  mutate?: (row:EmergencyRow|undefined)=>EmergencyRow|undefined):Promise<T|undefined> {
  const db=await open()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode,{durability:'strict'}),s=tx.objectStore(STORE),req=s.get(key(owner,device))
    let current:EmergencyRow|undefined
    req.onsuccess=()=>{try{
      const before=req.result as EmergencyRow|undefined
      current=mutate?mutate(before):before
      if(mutate){if(current)s.put(current,key(owner,device));else s.delete(key(owner,device))}
    }catch{tx.abort()}}
    tx.oncomplete=()=>{db.close();resolve(current as T|undefined)}
    tx.onabort=()=>{db.close();reject(new Error('emergency.storage'))}
  })
}
export async function readEmergency(owner:string,device:string) {
  const row=await access<EmergencyRow>(owner,device,'readonly')
  if(row && (row.version!==1 || row.accountId!==owner || row.deviceId!==device ||
    !Number.isSafeInteger(row.revision)||row.revision<0))throw new Error('emergency.storage')
  return row
}
export const changeEmergency=(owner:string,device:string,mutate:(row:EmergencyRow|undefined)=>EmergencyRow|undefined)=>
  access<EmergencyRow>(owner,device,'readwrite',mutate)
