import 'fake-indexeddb/auto'
import {afterAll,beforeEach,describe,expect,it,vi} from 'vitest'
import type {Scope,TimeStatus} from '../domain/contracts'
const account='00000000-0000-4000-8000-000000000101'
const another='00000000-0000-4000-8000-000000000102'
const device='00000000-0000-4000-8000-000000000103'
const initial='00000000-0000-4000-8000-000000000104'
const photoId='00000000-0000-4000-8000-000000000105'
const upload='00000000-0000-4000-8000-000000000106'
const metadataId='00000000-0000-4000-8000-000000000107'
const now=1_800_000_000_000
let active:Scope={accountId:account,deviceId:device,generation:1}
const keys=new Map<string,CryptoKey>()
vi.mock('../../identity',()=>({
 acquireStorageKeys:()=>{
  const scope={...active}
  const check=()=>{if(scope.accountId!==active.accountId||scope.generation!==active.generation)
    throw Error('storage.account_changed')}
  return{scope,check,
   create:async()=>{
    check()
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    const token=crypto.randomUUID();keys.set(token,key)
    return{key,wrapped:{iv:'AAAAAAAAAAAAAAAA',ciphertext:token}}
   },
   open:async(_asset:string,_expiry:string,wrapped:{ciphertext:string})=>{
    check();const key=keys.get(wrapped.ciphertext)
    if(!key)throw Error('storage.key_missing')
    return key
   },
  }
 },
 onIdentityCleanup:()=>()=>{},
}))
vi.mock('./capabilities',()=>({
 probeStorageCapabilities:async()=>({
  secureContext:true,indexedDB:true,structuredCloneKey:true,opfs:false,fallbackBlob:true,
  backend:'idb-blob',quota:1_000_000,usage:100,persisted:'granted',
  persistRequest:'unsupported',warning:null,
 }),
}))
vi.mock('./time',()=>{
 class TestTime{
  restoreFromStorage():Promise<TimeStatus>{return Promise.resolve(this.status())}
  refreshFromServer():Promise<TimeStatus>{return Promise.resolve(this.status())}
  status():TimeStatus{return{trusted:true,now,reason:'restored'}}
  now(){return now}
  proveExpiry(expiry:number){return expiry<=now}
 }
 return{BrowserTimeAuthority:TestTime,clearLiveTime:()=>{}}
})
const source=(mode:2|3)=>({
 operationId:upload,photoId,assetId:initial,metadataAssetId:metadataId,
 kind:mode===2?'original' as const:'master' as const,revision:1 as const,
 capturedAt:now,expiresAt:now+86400000,pixels:new Blob(['origin-private-pixels']),
 metadata:{mode,policy:{policyVersion:1,source:'personal',assignmentId:null,mode,ttlDays:1},
  capturedAt:now,expiresAt:now+86400000,title:''},
})
const flattened=()=>new Blob([new Uint8Array([0xff,0xd8,0xff,0xda,0,2,0x11,0x22,0xff,0xd9]),'changed-secret-pixels'],
 {type:'image/jpeg'})
describe('R2-11 local encrypted crash-safe asset swaps',()=>{
 beforeEach(async()=>{
  const {db}=await import('./database')
  db.close();await db.delete();await db.open()
  keys.clear();active={accountId:account,deviceId:device,generation:1}
 })
 afterAll(async()=>{
  const {db}=await import('./database');db.close();await db.delete()
 })
 it('mode3 replaces master without a second durable old master or plaintext staging',async()=>{
  const {db}=await import('./database'),{openLocalPhotoVault}=await import('./vault')
  const vault=openLocalPhotoVault()
  await vault.commit(source(3))
  await db.outbox.update(account+'/'+upload,{state:'acknowledged'})
  const saved=await vault.saveEdit(photoId,flattened())
  const header=await vault.readHeader(photoId)
  expect(header?.assetId).toBe(saved.assetId)
  expect(header?.editRevision).toBe(1)
  expect(await db.assets.get(account+'/'+photoId+'/'+initial)).toBeUndefined()
  await expect(vault.read(photoId,initial)).rejects.toThrow('storage.asset_unavailable')
  const blobs=await db.blobFallback.toArray()
  const bytes=await Promise.all(blobs.map(x=>x.blob.text()))
  expect(bytes.join('')).not.toContain('changed-secret-pixels')
  expect(bytes.join('')).not.toContain('origin-private-pixels')
  expect((await vault.editDelivery(saved.operationId)).expectedRevision).toBe(0)
  expect((await vault.pending()).filter(x=>x.intent==='edit')).toHaveLength(1)
  await vault.acknowledgeEdit(saved.operationId,saved.assetId,1)
  await expect(vault.saveEdit(photoId,flattened())).resolves.toHaveProperty('revision',2)
 })
 it('mode2 retains the immutable compressed original and stores an independent edit',async()=>{
  const {db}=await import('./database'),{openLocalPhotoVault}=await import('./vault')
  const vault=openLocalPhotoVault()
  await vault.commit(source(2))
  await db.outbox.update(account+'/'+upload,{state:'acknowledged'})
  const result=await vault.saveEdit(photoId,flattened())
  const header=await vault.readHeader(photoId)
  expect(header?.sourceAssetId).toBe(initial)
  expect(header?.assetId).toBe(result.assetId)
  expect(await (await vault.read(photoId,initial)).text()).toBe('origin-private-pixels')
  expect(await db.assets.get(account+'/'+photoId+'/'+initial)).toBeTruthy()
  await expect(vault.saveEdit(photoId,flattened())).rejects.toThrow('editor.pending_edit')
 })
 it('queues one offline edit and pins the initial ciphertext through upload ACK, then rejects stale account',async()=>{
   const {openLocalPhotoVault}=await import('./vault'),{db}=await import('./database')
   const vault=openLocalPhotoVault()
   await vault.commit(source(3))
   const saved=await vault.saveEdit(photoId,flattened())
   const header=await vault.readHeader(photoId)
   expect(header?.assetId).toBe(saved.assetId)
   expect(header?.initialAssetId).toBe(initial)
   expect(await db.assets.get(account+'/'+photoId+'/'+initial)).toBeTruthy()
   expect((await db.outbox.get(account+'/'+upload))?.state).toBe('pending')
   await expect(vault.saveEdit(photoId,flattened())).rejects.toThrow('editor.pending_edit')
   active={accountId:another,deviceId:device,generation:2}
   await expect(vault.saveEdit(photoId,flattened())).rejects.toThrow('storage.account_changed')
  })
 it('does not persist edits with suspicious APP1 JPEG metadata',async()=>{
  const {db}=await import('./database'),{openLocalPhotoVault}=await import('./vault')
  const vault=openLocalPhotoVault()
  await vault.commit(source(3))
  await db.outbox.update(account+'/'+upload,{state:'acknowledged'})
  const fake=new Blob([new Uint8Array([0xff,0xd8,0xff,0xe1,0,2,0xff,0xda,0,2,1,2])],
    {type:'image/jpeg'})
  await expect(vault.saveEdit(photoId,fake)).rejects.toThrow('editor.metadata_in_jpeg')
  expect((await vault.readHeader(photoId))?.assetId).toBe(initial)
 })
})
