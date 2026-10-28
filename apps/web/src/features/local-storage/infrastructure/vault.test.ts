import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scope, TimeStatus } from '../domain/contracts'

const accountA='00000000-0000-4000-8000-000000000101'
const accountB='00000000-0000-4000-8000-000000000102'
const device='00000000-0000-4000-8000-000000000103'
const now=1_800_000_000_000
let activeScope:Scope={accountId:accountA,deviceId:device,generation:1}
const wrappedKeys=new Map<string,CryptoKey>()

vi.mock('../../identity',()=>({
  acquireStorageKeys:()=>{
    const scope={...activeScope}
    const check=()=>{
      if(scope.accountId!==activeScope.accountId || scope.generation!==activeScope.generation)
        throw new Error('storage.account_changed')
    }
    return{
      scope,check,
      create:async()=>{
        check()
        const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
        const token=crypto.randomUUID();wrappedKeys.set(token,key)
        return{key,wrapped:{iv:'AAAAAAAAAAAAAAAA',ciphertext:token}}
      },
      open:async(_assetId:string,_expiresAt:string,wrapped:{ciphertext:string})=>{
        check()
        const key=wrappedKeys.get(wrapped.ciphertext)
        if(!key)throw new Error('storage.key_missing')
        return key
      },
    }
  },
  onIdentityCleanup:()=>()=>{},
}))

vi.mock('./capabilities',()=>({
  probeStorageCapabilities:async()=>({
    secureContext:true,indexedDB:true,structuredCloneKey:true,opfs:false,fallbackBlob:true,
    backend:'idb-blob',quota:1_000_000,usage:0,persisted:'granted',persistRequest:'unsupported',warning:null,
  }),
}))

vi.mock('./time',()=>{
  class TestTimeAuthority {
    restoreFromStorage():Promise<TimeStatus>{return Promise.resolve({trusted:true,now,reason:'restored'})}
    refreshFromServer():Promise<TimeStatus>{return Promise.resolve({trusted:true,now,reason:'fresh'})}
    status():TimeStatus{return{trusted:true,now,reason:'restored'}}
    now():number{return now}
    proveExpiry(expiresAt:number):boolean{return expiresAt<=now}
  }
  return{BrowserTimeAuthority:TestTimeAuthority,clearLiveTime:()=>{}}
})

const ids={
  operationId:'00000000-0000-4000-8000-000000000111',
  photoId:'00000000-0000-4000-8000-000000000112',
  assetId:'00000000-0000-4000-8000-000000000113',
  metadataAssetId:'00000000-0000-4000-8000-000000000114',
}
const photo=(changes:Partial<typeof ids>={})=>({
  ...ids,...changes,kind:'master' as const,revision:1 as const,capturedAt:now,
  expiresAt:now+24*60*60*1000,pixels:new Blob(['private-pixels-marker']),
  metadata:{title:'private-metadata-marker'},
})

describe('R2-04 encrypted local vault integration',()=>{
  beforeEach(async()=>{
    const {db}=await import('./database')
    db.close();await db.delete();await db.open()
    wrappedKeys.clear()
    activeScope={accountId:accountA,deviceId:device,generation:1}
  })
  afterAll(async()=>{const {db}=await import('./database');db.close();await db.delete()})

  it('commits ciphertext, reads it back and retries the same operation exactly once',async()=>{
    const {openLocalPhotoVault}=await import('./vault')
    const {db}=await import('./database')
    const vault=openLocalPhotoVault()
    await expect(vault.commit(photo())).resolves.toMatchObject({photoId:ids.photoId,operationId:ids.operationId})
    expect(await (await vault.read(ids.photoId,ids.assetId)).text()).toBe('private-pixels-marker')
    expect(await vault.readMetadata(ids.photoId)).toEqual({title:'private-metadata-marker'})
    expect(await vault.pending()).toHaveLength(1)
    await expect(vault.commit(photo())).resolves.toMatchObject({photoId:ids.photoId})
    expect(await db.photos.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
    const ciphertext=await Promise.all((await db.blobFallback.toArray()).map(row=>row.blob.text()))
    expect(ciphertext.join('')).not.toContain('private-pixels-marker')
    expect(ciphertext.join('')).not.toContain('private-metadata-marker')
  })

  it('rejects conflicting retries but permits the same idempotency key in another account',async()=>{
    const {openLocalPhotoVault}=await import('./vault')
    const first=openLocalPhotoVault()
    await first.commit(photo())
    await expect(first.commit(photo({photoId:'00000000-0000-4000-8000-000000000115'})))
      .rejects.toThrow('storage.operation_conflict')

    activeScope={accountId:accountB,deviceId:device,generation:2}
    const second=openLocalPhotoVault()
    await expect(second.commit(photo({
      photoId:'00000000-0000-4000-8000-000000000121',
      assetId:'00000000-0000-4000-8000-000000000122',
      metadataAssetId:'00000000-0000-4000-8000-000000000123',
    }))).resolves.toMatchObject({accountId:accountB,operationId:ids.operationId})
    expect(await second.list()).toHaveLength(1)
  })

  it('fails closed on ciphertext damage',async()=>{
    const {openLocalPhotoVault}=await import('./vault')
    const {db}=await import('./database')
    const vault=openLocalPhotoVault();await vault.commit(photo())
    const manifest=await db.assets.get(accountA+'/'+ids.photoId+'/'+ids.assetId)
    expect(manifest).toBeTruthy()
    const stored=await db.blobFallback.get(manifest!.storageKey)
    const damaged=new Uint8Array(await stored!.blob.arrayBuffer());damaged[0]^=1
    await db.blobFallback.put({...stored!,blob:new Blob([damaged])})
    await expect(vault.read(ids.photoId,ids.assetId)).rejects.toThrow('storage.ciphertext_corrupt')
  })

  it('rejects a capture timestamp outside the trusted-time window',async()=>{
    const {openLocalPhotoVault}=await import('./vault')
    const capturedAt=now+300_001
    await expect(openLocalPhotoVault().commit({
      ...photo(),capturedAt,expiresAt:capturedAt+24*60*60*1000,
    })).rejects.toThrow('storage.invalid_ttl')
  })
})
