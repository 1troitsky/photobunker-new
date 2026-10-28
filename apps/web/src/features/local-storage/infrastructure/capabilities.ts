import { ensureBrowserSupport } from '../../identity'
import type { Capabilities, PersistenceStatus, StorageBackend } from '../domain/contracts'
import { db, probeEncryptedFallback, probeOpfs } from './database'

async function persistence(test:()=>Promise<boolean>|boolean):Promise<PersistenceStatus>{
  try{return await test()?'granted':'denied'}catch{return 'error'}
}
export async function probeStorageCapabilities(requestPersistence=false):Promise<Capabilities>{
  const secureContext=globalThis.isSecureContext===true
  let indexedDB=false,structuredCloneKey=false,opfs=false,fallbackBlob=false
  let usage:number|null=null,quota:number|null=null
  let persisted:PersistenceStatus='unsupported',persistRequest:PersistenceStatus='unsupported'
  if(secureContext && typeof globalThis.indexedDB!=='undefined' && !!globalThis.crypto?.subtle){
    try{
      await ensureBrowserSupport() // strict IDB transaction/readback/cleanup and CryptoKey clone
      await db.open()
      const nonce='capability-'+crypto.randomUUID()
      await db.journal.put({key:nonce,operationId:nonce,accountId:'probe',
        deviceId:'probe',photoId:'probe',attemptId:nonce,assetKeys:[],createdAt:Date.now(),state:'staging'})
      const result=await db.journal.get(nonce)
      await db.journal.delete(nonce)
      indexedDB=Boolean(result && !await db.journal.get(nonce))
      structuredCloneKey=indexedDB
    }catch{indexedDB=false;structuredCloneKey=false}
    if(indexedDB){
      opfs=await probeOpfs()
      fallbackBlob=await probeEncryptedFallback()
    }
  }
  const storage=navigator.storage
  if(storage?.estimate)try{
    const estimate=await storage.estimate()
    usage=Number.isSafeInteger(estimate.usage)?estimate.usage!:null
    quota=Number.isSafeInteger(estimate.quota)?estimate.quota!:null
  }catch{/* unknown, not 0 */}
  if(storage?.persisted)persisted=await persistence(()=>storage.persisted())
  if(requestPersistence && storage?.persist)persistRequest=await persistence(()=>storage.persist())
  const backend:StorageBackend|null=indexedDB?(opfs?'opfs':fallbackBlob?'idb-blob':null):null
  const warning=!secureContext?'storage.insecure_context'
    :!indexedDB?'storage.indexeddb_unavailable'
    :!backend?'storage.no_safe_ciphertext_backend'
    :persisted!=='granted' && persistRequest!=='granted'?'storage.eviction_possible':null
  return{secureContext,indexedDB,structuredCloneKey,opfs,fallbackBlob,backend,
    usage,quota,persisted,persistRequest,warning}
}
