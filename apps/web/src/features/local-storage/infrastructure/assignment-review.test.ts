import 'fake-indexeddb/auto'
import {afterAll,beforeEach,describe,expect,it,vi} from 'vitest'
import type {Scope,TimeStatus} from '../domain/contracts'
const accountA='00000000-0000-4000-8000-000000000101'
const accountB='00000000-0000-4000-8000-000000000102'
const device='00000000-0000-4000-8000-000000000103'
const assignmentId='00000000-0000-4000-8000-000000000104'
const photoId='00000000-0000-4000-8000-000000000105'
const uploadId='00000000-0000-4000-8000-000000000106'
const capturedAt=1_800_000_000_000,expiresAt=capturedAt+86400000
let active:Scope={accountId:accountA,deviceId:device,generation:1}
const keys=new Map<string,CryptoKey>()
vi.mock('../../identity',()=>({
  acquireStorageKeys:()=>{
    const scope={...active}
    const check=()=>{if(active.accountId!==scope.accountId||active.generation!==scope.generation)
      throw Error('storage.account_changed')}
    return{scope,check,
      create:async()=>{
        check()
        const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
        const token=crypto.randomUUID()
        keys.set(token,key)
        return{key,wrapped:{iv:'AAAAAAAAAAAAAAAA',ciphertext:token}}
      },
      open:async(_id:string,_context:string,wrapped:{ciphertext:string})=>{
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
    backend:'idb-blob',quota:1_000_000,usage:1_000,persisted:'granted',persistRequest:'unsupported',warning:null,
  }),
}))
vi.mock('./time',()=>{
  class TestTime {
    restoreFromStorage():Promise<TimeStatus>{return Promise.resolve(this.status())}
    refreshFromServer():Promise<TimeStatus>{return Promise.resolve(this.status())}
    status():TimeStatus{return{trusted:true,now:capturedAt,reason:'restored'}}
    now(){return capturedAt}
    proveExpiry(v:number){return v<=capturedAt}
  }
  return{BrowserTimeAuthority:TestTime,clearLiveTime:()=>{}}
})
const photo=()=>({
  photoId,operationId:uploadId,
  assetId:'00000000-0000-4000-8000-000000000107',
  metadataAssetId:'00000000-0000-4000-8000-000000000108',
  kind:'master' as const,revision:1 as const,
  capturedAt,expiresAt,pixels:new Blob(['local encrypted pixels']),
  capture:{assignmentId,assignmentRevision:2,policyRevision:1,mode:3 as const,retentionDays:1,capturedAt},
  metadata:{policyVersion:1,policy:{
    policyVersion:1,source:'assignment',assignmentId,assignmentRevision:2,policyRevision:1,mode:3,ttlDays:1,
  },mode:3,capturedAt,expiresAt},
})
describe('R2-10 encrypted assignment review using original photo outbox',()=>{
  beforeEach(async()=>{
    const {db}=await import('./database')
    db.close();await db.delete();await db.open()
    keys.clear();active={accountId:accountA,deviceId:device,generation:1}
  })
  afterAll(async()=>{
    const {db}=await import('./database')
    db.close();await db.delete()
  })
  it('freezes assignment context and never stores review plaintext',async()=>{
    const {openLocalPhotoVault}=await import('./vault')
    const {db}=await import('./database')
    const vault=openLocalPhotoVault()
    await vault.commit(photo())
    const id=await vault.queueReview(photoId,'review','correction','private reviewer note')
    expect((await vault.readHeader(photoId))?.capture).toEqual(photo().capture)
    const rows=await db.outbox.toArray()
    expect(rows.filter(x=>x.intent==='review')).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('private reviewer note')
    expect((await vault.reviewDetails(photoId)).reviewComment).toBe('private reviewer note')
    await expect(vault.reviewDelivery(id)).rejects.toThrow('review.photo_not_synced')
    await db.outbox.update(accountA+'/'+uploadId,{state:'acknowledged'})
    const contract=await vault.reviewDelivery(id)
    expect(contract.expectedRevision).toBe(1)
    expect(contract.state).toBe('correction')
    await vault.acknowledgeReview(id,2)
    expect(await vault.reviewStatus(photoId)).toBe('synced')
  })
  it('prevents revision conflict overwrites and fails closed on account switch',async()=>{
    const {openLocalPhotoVault}=await import('./vault')
    const vault=openLocalPhotoVault()
    await vault.commit(photo())
    await vault.queueReview(photoId,'review','accepted','')
    await expect(vault.queueReview(photoId,'review','reshoot','new')).rejects.toThrow('review.pending_conflict')
    active={accountId:accountB,deviceId:device,generation:2}
    await expect(vault.reviewDetails(photoId)).rejects.toThrow('storage.account_changed')
  })
  it('denies metadata edits that rewrite frozen capture policy',async()=>{
    const {openLocalPhotoVault}=await import('./vault')
    const vault=openLocalPhotoVault();await vault.commit(photo())
    await expect(vault.editMetadata(photoId,{...photo().metadata,
      policy:{...photo().metadata.policy,ttlDays:2}})).rejects.toThrow('gallery.frozen_capture_changed')
  })
})
