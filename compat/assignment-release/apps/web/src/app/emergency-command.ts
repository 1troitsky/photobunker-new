import type { EmergencyIntent } from './emergency-crypto'

/** D5B: unscoped durable envelope intentionally OUTSIDE the account/device
 * databases being erased. Contains ONLY signed canonical public intent bytes.
 * Never persist PIN, PB1, local signing key, derived secret or private metadata.
 */
export type EmergencyCommand = {
  version: 1
  operationId: string
  accountId: string
  deviceId: string
  intent: string
  signature: string
  phase: 'prepared'|'locked'|'purging'|'purged'
  delivery: 'queued'|'accepted'|'processing'|'completed'
  createdAt: number
}
const NAME='photobunker-emergency-outbox-v1', STORE='commands'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAGES=['prepared','locked','purging','purged']
export function verifyEmergencyCommand(row: EmergencyCommand): boolean {
  if(row?.version!==1||!UUID.test(row.operationId)||!UUID.test(row.accountId)||
    !UUID.test(row.deviceId)||!STAGES.includes(row.phase)||
    !['queued','accepted','processing','completed'].includes(row.delivery)||
    !Number.isSafeInteger(row.createdAt)||row.createdAt<=0||
    typeof row.intent!=='string'||row.intent.length>1024||
    !/^[A-Za-z0-9_-]{86}$/.test(row.signature))return false
  try {
    const raw=JSON.parse(row.intent) as EmergencyIntent
    const exact=['accountId','action','keyId','operationId','revision','version'].join(',')
    return Object.keys(raw).sort().join(',')===exact &&
      raw.version===1&&raw.action==='emergency-delete'&&
      raw.operationId===row.operationId&&raw.accountId===row.accountId&&
      UUID.test(raw.keyId)&&Number.isSafeInteger(raw.revision)&&raw.revision>=1&&
      JSON.stringify(Object.fromEntries(Object.entries(raw).sort(([a],[b])=>a.localeCompare(b,'en'))))===row.intent
  }catch {return false}
}
async function database() {
  if(!globalThis.indexedDB)throw new Error('emergency.storage')
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const req=indexedDB.open(NAME,1)
    req.onupgradeneeded=()=>req.result.createObjectStore(STORE)
    req.onerror=()=>reject(new Error('emergency.storage'))
    req.onblocked=()=>reject(new Error('emergency.storage'))
    req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result)}
  })
}
export async function modifyEmergencyCommand(
  change?:(previous:EmergencyCommand|undefined)=>EmergencyCommand|undefined,
):Promise<EmergencyCommand|undefined> {
  const db=await database()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,change?'readwrite':'readonly',{durability:'strict'})
    const object=tx.objectStore(STORE),request=object.get('active')
    let result:EmergencyCommand|undefined,fail:unknown
    request.onsuccess=()=>{
      try{
        const previous=request.result as EmergencyCommand|undefined
        if(previous&&!verifyEmergencyCommand(previous))throw new Error('emergency.corrupt')
        result=change?change(previous):previous
        if(result&&!verifyEmergencyCommand(result))throw new Error('emergency.corrupt')
        if(change){
          if(!result||previous&&(
            previous.operationId!==result.operationId||
            previous.intent!==result.intent||previous.signature!==result.signature||
            previous.accountId!==result.accountId||previous.deviceId!==result.deviceId
          ))throw new Error('emergency.immutable')
          object.put(result,'active')
        }
      }catch(error){fail=error;tx.abort()}
    }
    tx.oncomplete=()=>{db.close();resolve(result)}
    tx.onabort=()=>{db.close();reject(fail??new Error('emergency.storage'))}
    tx.onerror=()=>{if(!fail)fail=new Error('emergency.storage')}
  })
}
export const readEmergencyCommand=()=>modifyEmergencyCommand()
export const commitEmergencyCommand=(value:EmergencyCommand)=>
  modifyEmergencyCommand(prior=>{
    if(prior)throw new Error('emergency.committed')
    return value
  })
export async function advanceEmergencyCommand(operationId:string,transform:(r:EmergencyCommand)=>EmergencyCommand) {
  return modifyEmergencyCommand(row=>{
    if(!row||row.operationId!==operationId)throw new Error('emergency.changed')
    return transform(row)
  })
}
