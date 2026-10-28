import {identity,onIdentityCleanup,photoRequest,signPhotoSyncContract} from '../../identity'
import {openLocalPhotoVault} from '../../local-storage'
import type {SyncSnapshot,SyncReceipt,SyncState} from '../../local-storage'
import {watch} from 'vue'

export type SyncMessage={photoId:string;state:SyncState;error?:string}
const listeners=new Set<(event:SyncMessage)=>void>()
let running:Promise<void>|null=null
let stopping=false
function publish(value:SyncMessage):void{for(const fn of listeners)fn(value)}
export function onPhotoSync(fn:(event:SyncMessage)=>void):()=>void{listeners.add(fn);return()=>listeners.delete(fn)}
function bound(accountId:string,deviceId:string):void {
  if(stopping||identity.value?.accountId!==accountId||
      identity.value?.deviceId!==deviceId||identity.value.offline)
    throw new Error('sync.account_changed')
}
function httpError(response:Response):Error{
  return new Error('sync.http_'+response.status)
}
async function jsonResponse<T>(response:Response):Promise<T>{
  if(!response.ok)throw httpError(response)
  return await response.json() as T
}
export function signedContract(snapshot:SyncSnapshot):string{
  const assets=snapshot.assets.map(({assetId,kind,revision,bytes,sha256,manifest})=>({
    assetId,kind,revision,bytes,sha256,manifest,
  })).sort((a,b)=>a.assetId<b.assetId?-1:a.assetId>b.assetId?1:0)
  return JSON.stringify({version:1,photoId:snapshot.photoId,operationId:snapshot.operationId,
    expiresAt:snapshot.expiresAt,assets})
}
type Reserve={state:'pending';photoId:string;expiresAt:number}|
  {state:'active';receipt:SyncReceipt}
type ReceiptReply={state:'pending';photoId:string;expiresAt:number}|
  {state:'active';receipt:SyncReceipt}
async function getReceipt(photoId:string):Promise<SyncReceipt|null>{
  const r=await photoRequest('/'+photoId+'/receipt')
  if(r.status===404)return null
  const data=await jsonResponse<ReceiptReply>(r)
  return data.state==='active'?data.receipt:null
}
async function runOne(snapshot:SyncSnapshot,accountId:string,deviceId:string):Promise<void>{
  const vault=openLocalPhotoVault(),photoId=snapshot.photoId
  bound(accountId,deviceId)
  publish({photoId,state:'syncing'})
  try{
    // Lost finalize ACK: first reconcile server receipt before writing anything.
    let receipt=await getReceipt(photoId)
    bound(accountId,deviceId)
    if(!receipt){
      const contract=signedContract(snapshot)
      const signature=await signPhotoSyncContract(contract)
      bound(accountId,deviceId)
      const reserved=await jsonResponse<Reserve>(await photoRequest('/reserve','POST',
        JSON.stringify({contract,signature})))
      bound(accountId,deviceId)
      if(reserved.state==='active')receipt=reserved.receipt
      else {
        for(const asset of snapshot.assets){
          bound(accountId,deviceId)
          const result=await photoRequest('/'+photoId+'/objects/'+asset.assetId,'PUT',asset.ciphertext)
          if(!result.ok)throw httpError(result)
        }
        bound(accountId,deviceId)
        const finalized=await jsonResponse<{receipt:SyncReceipt}>(
          await photoRequest('/'+photoId+'/finalize','POST',JSON.stringify({operationId:snapshot.operationId})))
        receipt=finalized.receipt
      }
    }
    bound(accountId,deviceId)
    await vault.acknowledge(snapshot.operationId,receipt)
    publish({photoId,state:'synced'})
  }catch(e){
    const code=e instanceof Error?e.message:'sync.failed'
    if(code==='sync.account_changed')return
    if(code==='sync.http_410'){
      await vault.revokeFromServer(photoId)
      publish({photoId,state:'expired'})
      return
    }
    await vault.failDelivery(snapshot.operationId,code).catch(()=>{})
    publish({photoId,state:'retry',error:code})
  }
}
async function execute():Promise<void>{
  if(!identity.value||identity.value.offline||!navigator.onLine||document.hidden)return
  const {accountId,deviceId}=identity.value
  const vault=openLocalPhotoVault()
  try{
    if(!vault.time.status().trusted)await vault.time.restoreFromStorage()
    if(!vault.time.status().trusted)await vault.time.refreshFromServer()
    bound(accountId,deviceId)
    await vault.reconcile()
    const pending=await vault.pending()
    for(const row of pending.slice(0,8)){
      bound(accountId,deviceId)
      if(row.nextAttemptAt>vault.time.now())continue
      try{
        const snapshot=await vault.delivery(row.operationId)
        bound(accountId,deviceId)
        await runOne(snapshot,accountId,deviceId)
      }catch(e){
        if((e instanceof Error && e.message==='sync.account_changed')||!identity.value)return
        await vault.failDelivery(row.operationId,'sync.local_read_failed').catch(()=>{})
        publish({photoId:row.photoId,state:'retry',error:'sync.local_read_failed'})
      }
    }
  }catch{/* offline / untrusted time / locked: do not claim cloud delivery */}
}
/** One foreground worker per process. navigator.locks prevents duplicate tabs. */
export function flushPhotoSync():Promise<void>{
  if(running)return running
  stopping=false
  running=(async()=>{
    if(navigator.locks?.request)
      await navigator.locks.request('pb-photo-outbox-v1',{ifAvailable:true},async lock=>{if(lock)await execute()})
    else await execute() // server idempotency still protects Safari fallback races
  })().finally(()=>{running=null})
  return running
}
let unsubscribe:(()=>void)|null=null
export function startPhotoSync():()=>void{
  if(unsubscribe)return unsubscribe
  const wake=()=>{void flushPhotoSync()}
  const visible=()=>{if(!document.hidden)wake()}
  const cancel=()=>{stopping=true}
  const stopWatch=watch(identity,()=>wake())
  const removeCleanup=onIdentityCleanup(cancel)
  window.addEventListener('online',wake);window.addEventListener('focus',wake)
  window.addEventListener('photobunker-outbox',wake)
  document.addEventListener('visibilitychange',visible)
  const interval=setInterval(()=>{if(!document.hidden)wake()},30000)
  // defer network delivery until after shell; camera capture never waits on it
  queueMicrotask(wake)
  unsubscribe=()=>{
    stopping=true;stopWatch();removeCleanup();clearInterval(interval)
    window.removeEventListener('online',wake);window.removeEventListener('focus',wake)
    window.removeEventListener('photobunker-outbox',wake)
    document.removeEventListener('visibilitychange',visible)
    unsubscribe=null
  }
  return unsubscribe
}
/** Readback returns ciphertext only, SHA-256 verified against server receipt. */
export async function readCloudCiphertext(photoId:string,assetId:string,receipt:SyncReceipt):Promise<Blob>{
  if(receipt.photoId!==photoId)throw new Error('sync.receipt_mismatch')
  const asset=receipt.assets.find(x=>x.assetId===assetId)
  if(!asset)throw new Error('sync.asset_denied')
  const r=await photoRequest('/'+photoId+'/objects/'+assetId)
  if(!r.ok)throw httpError(r)
  const blob=await r.blob()
  if(blob.size!==asset.bytes)throw new Error('sync.readback_length')
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())))
    .map(n=>n.toString(16).padStart(2,'0')).join('')
  if(hash!==asset.sha256)throw new Error('sync.readback_corrupt')
  return blob
}
