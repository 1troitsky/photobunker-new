import 'fake-indexeddb/auto'
import {beforeEach,describe,expect,it} from 'vitest'
import {db,removeRevokedDeviceClock} from './database'
import {scanLocalOwnership} from './ownership'
const account='g5-account',device='g5-device'
beforeEach(async()=>{await db.delete();await db.open()})
describe('G5 local ownership table inventory',()=>{
  it('holds acknowledged ciphertext and identifies orphan blob without reading payload',async()=>{
    await db.photos.add({key:account+'/photo-1',accountId:account,
      photoId:'photo-1',assetId:'asset-1',metadataAssetId:'metadata-1',
      state:'local',revision:1,operationId:'operation-1',expiresAt:9999999999999})
    await db.assets.add({key:account+'/photo-1/asset-1',
      version:1,algorithm:'AES-256-GCM',chunkBytes:65536,accountId:account,
      photoId:'photo-1',assetId:'asset-1',kind:'master',revision:1,
      expiresAt:9999999999999,plainBytes:1,cipherBytes:1,frames:[],
      cipherDigest:'checksum',wrappedDEK:{iv:'iv',ciphertext:'cipher'},
      backend:'idb-blob',storageKey:'asset-path'})
    await db.blobFallback.add({key:'asset-path',accountId:account,blob:new Blob(['encrypted'])})
    await db.blobFallback.add({key:'orphan-path',accountId:account,blob:new Blob(['orphan'])})
    await db.outbox.add({key:account+'/operation-1',accountId:account,
      photoId:'photo-1',operationId:'operation-1',state:'acknowledged',
      intent:'upload',attempts:0,nextAttemptAt:0,expiresAt:9999999999999})
    await db.clock.add({key:account+'/'+device,accountId:account,deviceId:device,
      iv:'iv',ciphertext:'cipher',wrappedDEK:{iv:'iv',ciphertext:'cipher'}})
    const result=await scanLocalOwnership(account,device)
    expect(result.counts.asset).toBe(1)
    expect(result.counts.blob).toBe(2)
    expect(result.orphanBlobRows).toBe(1)
    expect(result.unconfirmedPhotoOperations).toBe(0)
    expect(result.summary.postRevokeDerived).toBe(1)
    expect(result.summary.accountShared).toBeGreaterThanOrEqual(4)
    expect(result.disposition).toBe('hold_ciphertext')
    expect(result.blockingReasons).toContain('unattributed_local_artifacts')
  })
  it('clears only a revoked device clock and keeps another device clock',async()=>{
    await db.clock.add({key:account+'/'+device,accountId:account,deviceId:device,
      iv:'iv',ciphertext:'clock-a',wrappedDEK:{iv:'iv',ciphertext:'wrapped'}})
    await db.clock.add({key:account+'/other-device',accountId:account,
      deviceId:'other-device',iv:'iv',ciphertext:'clock-b',
      wrappedDEK:{iv:'iv',ciphertext:'wrapped'}})
    await removeRevokedDeviceClock(account,device)
    await removeRevokedDeviceClock(account,device)
    expect(await db.clock.get(account+'/'+device)).toBeUndefined()
    expect((await db.clock.get(account+'/other-device'))?.ciphertext).toBe('clock-b')
  })
  it('never ignores a device staging journal or unconfirmed operation',async()=>{
    await db.journal.add({key:'journal-1',operationId:'operation-2',
      accountId:account,deviceId:device,photoId:'photo-2',
      attemptId:'attempt-1',assetKeys:['unique-staging-path'],
      createdAt:1,state:'staging'})
    await db.outbox.add({key:account+'/operation-2',accountId:account,
      photoId:'photo-2',operationId:'operation-2',state:'retry',
      intent:'upload',attempts:2,nextAttemptAt:0,expiresAt:9999999999999})
    const result=await scanLocalOwnership(account,device)
    expect(result.unconfirmedPhotoOperations).toBe(1)
    expect(result.unresolvedJournalPaths).toBe(1)
    expect(result.summary.pending).toBeGreaterThan(0)
    expect(result.blockingReasons).toContain('pending_offline_operations')
  })
})
